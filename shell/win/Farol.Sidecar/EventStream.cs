using System.Net;
using System.Threading.Channels;
using Farol.Contrato;

namespace Farol.Sidecar;

/// <summary>
/// O cliente SSE da casca: <c>GET /api/events</c> autenticado, e só <see cref="ShellEvent.Notice"/>,
/// <see cref="ShellEvent.Shell"/> e <see cref="ShellEvent.Exit"/> chegam ao consumidor. O corpo de
/// <c>state</c> e <c>state-patch</c> nunca é decodificado. Queda ou fim do fluxo religa com recuo;
/// o 401 vira um único <see cref="ShellEvent.Unauthorized"/> e o cliente para de religar.
/// </summary>
public sealed class EventStream
{
    /// <summary>O recuo entre uma conexão e a próxima: começa em 3 s e dobra até 30 s.</summary>
    public static class Reconnect
    {
        public static readonly TimeSpan InitialBackoff = TimeSpan.FromSeconds(3);
        public static readonly TimeSpan MaxBackoff = TimeSpan.FromSeconds(30);
    }

    private const int BufferSize = 16 * 1024;

    private readonly int _port;
    private readonly string _token;
    private readonly Action<string>? _log;
    private readonly TimeSpan _initialBackoff;
    private readonly object _gate = new();

    private Channel<ShellEvent> _channel = NewChannel();
    // O canal atual já foi completado por um Stop. Não dá para ler isso do Reader.Completion,
    // que só termina quando o último item enfileirado for lido.
    private bool _channelStopped;
    private CancellationTokenSource? _cts;
    private Task? _loop;

    /// <param name="port">A porta do motor (a do casca.json).</param>
    /// <param name="token">O token da A4; nunca vai para o log.</param>
    /// <param name="log">Recebe as linhas de WARN, sem token e sem corpo de evento.</param>
    /// <param name="initialBackoff">Só os testes trocam: o padrão é <see cref="Reconnect.InitialBackoff"/>.</param>
    public EventStream(int port, string token, Action<string>? log = null, TimeSpan? initialBackoff = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(token);
        _port = port;
        _token = token;
        _log = log;
        _initialBackoff = initialBackoff ?? Reconnect.InitialBackoff;
    }

    /// <summary>
    /// Os eventos do <see cref="Start"/> em curso (um consumidor só). Termina no
    /// <see cref="Stop"/>; depois de um novo <see cref="Start"/>, leia a propriedade de novo.
    /// </summary>
    public IAsyncEnumerable<ShellEvent> Events
    {
        get
        {
            lock (_gate)
            {
                return _channel.Reader.ReadAllAsync();
            }
        }
    }

    /// <summary>
    /// O laço de conexão está vivo: falso logo depois do <see cref="Stop"/> (mesmo com o laço
    /// antigo ainda saindo) e depois do 401.
    /// </summary>
    public bool IsRunning
    {
        get
        {
            lock (_gate)
            {
                return _cts is not null && _loop is { IsCompleted: false };
            }
        }
    }

    /// <summary>O recuo seguinte: o dobro do atual, no máximo <see cref="Reconnect.MaxBackoff"/>.</summary>
    public static TimeSpan NextBackoff(TimeSpan current)
    {
        var doubled = current + current;
        return doubled > Reconnect.MaxBackoff ? Reconnect.MaxBackoff : doubled;
    }

    /// <summary>
    /// Abre o fluxo. Já aberto, não faz nada; depois de um <see cref="Stop"/>, abre de novo num
    /// canal novo (leia <see cref="Events"/> outra vez). Depois de um
    /// <see cref="ShellEvent.Unauthorized"/> o laço já terminou: chame <see cref="Stop"/> antes de
    /// abrir de novo, ou crie outra instância com o token novo.
    /// </summary>
    public void Start()
    {
        lock (_gate)
        {
            if (_cts is not null)
            {
                return;
            }
            if (_channelStopped)
            {
                _channel = NewChannel();
                _channelStopped = false;
            }
            _cts = new CancellationTokenSource();
            _loop = RunAsync(_channel.Writer, _cts.Token);
        }
    }

    /// <summary>Fecha a conexão e termina <see cref="Events"/>.</summary>
    public void Stop()
    {
        lock (_gate)
        {
            if (_cts is { } cts)
            {
                cts.Cancel();
                var loop = _loop ?? Task.CompletedTask;
                // a fonte só é descartada quando o laço, que ainda usa o token, terminar
                _ = loop.ContinueWith(_ => cts.Dispose(), CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
            }
            _cts = null;
            _channel.Writer.TryComplete();
            _channelStopped = true;
        }
    }

    private static Channel<ShellEvent> NewChannel() =>
        Channel.CreateUnbounded<ShellEvent>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });

    private async Task RunAsync(ChannelWriter<ShellEvent> writer, CancellationToken ct)
    {
        // Sai da thread de quem chamou o Start antes do primeiro await de rede.
        await Task.Yield();
        using var client = new HttpClient(new HttpClientHandler { UseProxy = false })
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
        var backoff = _initialBackoff;
        // Só falha vai ao log: uma linha quando a reconexão continua falhando depois da primeira
        // tentativa, e outra só se voltar a falhar depois de uma conexão sã.
        var failures = 0;
        while (!ct.IsCancellationRequested)
        {
            ConnectionResult result;
            string? reason = null;
            try
            {
                (result, reason) = await ConnectAsync(client, writer, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e)
            {
                // Só o tipo: a mensagem pode trazer pedaço de corpo. Qualquer exceção religa com
                // recuo, para o laço nunca morrer calado.
                result = ConnectionResult.Failed;
                reason = e.GetType().Name;
            }

            if (result == ConnectionResult.Unauthorized)
            {
                _log?.Invoke("WARN eventos: o motor recusou o token (401), sem religar");
                writer.TryWrite(new ShellEvent.Unauthorized());
                return;
            }
            if (result == ConnectionResult.Delivered)
            {
                backoff = _initialBackoff;
                failures = 0;
            }
            else if (++failures == 2)
            {
                _log?.Invoke($"WARN eventos: sem fluxo do motor depois de {failures} tentativas ({reason ?? "fluxo vazio"})");
            }
            try
            {
                await Task.Delay(backoff, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            backoff = NextBackoff(backoff);
        }
    }

    private enum ConnectionResult
    {
        Failed,
        Delivered,
        Unauthorized,
    }

    private async Task<(ConnectionResult Result, string? Reason)> ConnectAsync(HttpClient client, ChannelWriter<ShellEvent> writer, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{_port}/api/events");
        request.Headers.Host = $"127.0.0.1:{_port}";
        request.Headers.Add("x-farol", "1");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _token);
        request.Headers.Accept.ParseAdd("text/event-stream");

        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            return (ConnectionResult.Unauthorized, null);
        }
        if (!response.IsSuccessStatusCode)
        {
            return (ConnectionResult.Failed, $"HTTP {(int)response.StatusCode}");
        }

        await using var body = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        var parser = new SseParser();
        var buffer = new byte[BufferSize];
        // Qualquer evento completo, inclusive ping e state, prova que a conexão estava sã.
        var delivered = false;
        int read;
        while ((read = await body.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
        {
            foreach (var (name, data) in parser.Feed(buffer.AsSpan(0, read)))
            {
                delivered = true;
                // Other (state, state-patch, ping) e corpo malformado (null) ficam aqui.
                if (ShellEvent.Decode(name, data) is { } e and (ShellEvent.Notice or ShellEvent.Shell or ShellEvent.Exit))
                {
                    writer.TryWrite(e);
                }
            }
        }
        // Fim limpo do fluxo não é falha e não vai ao log; fluxo que fechou sem evento nenhum conta
        // como tentativa que falhou.
        return delivered ? (ConnectionResult.Delivered, null) : (ConnectionResult.Failed, "fluxo vazio");
    }
}
