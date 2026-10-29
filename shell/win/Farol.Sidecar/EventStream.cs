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

    /// <summary>Abre o fluxo. Já aberto, não faz nada; depois de um <see cref="Stop"/>, abre de novo.</summary>
    public void Start()
    {
        lock (_gate)
        {
            if (_cts is not null)
            {
                return;
            }
            if (_channel.Reader.Completion.IsCompleted)
            {
                _channel = NewChannel();
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
        while (!ct.IsCancellationRequested)
        {
            ConnectionResult result;
            try
            {
                result = await ConnectAsync(client, writer, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e) when (e is HttpRequestException or IOException or OperationCanceledException)
            {
                // A mensagem dessas exceções traz no máximo o endereço, que não leva o token.
                _log?.Invoke($"WARN eventos: conexão caiu ({e.GetType().Name}: {e.Message})");
                result = ConnectionResult.Failed;
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

    private async Task<ConnectionResult> ConnectAsync(HttpClient client, ChannelWriter<ShellEvent> writer, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{_port}/api/events");
        request.Headers.Host = $"127.0.0.1:{_port}";
        request.Headers.Add("x-farol", "1");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _token);
        request.Headers.Accept.ParseAdd("text/event-stream");

        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            return ConnectionResult.Unauthorized;
        }
        if (!response.IsSuccessStatusCode)
        {
            _log?.Invoke($"WARN eventos: o motor respondeu {(int)response.StatusCode}");
            return ConnectionResult.Failed;
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
        _log?.Invoke("WARN eventos: o motor fechou o fluxo");
        return delivered ? ConnectionResult.Delivered : ConnectionResult.Failed;
    }
}
