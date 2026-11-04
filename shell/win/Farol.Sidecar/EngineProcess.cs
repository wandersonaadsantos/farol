using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading.Channels;
using Farol.Contrato;

namespace Farol.Sidecar;

/// <summary>
/// O motor Node como processo filho da casca. Sobe <c>node server.js</c> com o ambiente do modo
/// casca, devolve o código de saída a cada vez que o filho termina e o encerra junto com a
/// árvore. Não sabe a intenção de quem para: o código sai em <see cref="ExitCodes"/> do mesmo
/// jeito, e quem compõe a casca deixa de ouvir antes de chamar <see cref="StopAsync"/>.
/// </summary>
public sealed class EngineProcess : IDisposable
{
    private const int StderrLinesKept = 50;
    private static readonly TimeSpan StopWait = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan ExitPoll = TimeSpan.FromMilliseconds(50);

    private readonly string _nodeExe;
    private readonly string _serverJs;
    private readonly string? _home;
    private readonly string _shellVersion;
    private readonly Action<string>? _log;
    private readonly Channel<int> _exitCodes = Channel.CreateUnbounded<int>();
    private readonly ConcurrentQueue<string> _stderr = new();
    private readonly object _gate = new();
    private Process? _process;
    private JobObject? _job;
    private bool _jobFailed;

    public EngineProcess(string nodeExe, string serverJs, string? home, string shellVersion, Action<string>? log = null)
    {
        _nodeExe = nodeExe;
        _serverJs = serverJs;
        _home = home;
        _shellVersion = shellVersion;
        _log = log;
        EngineFilePath = Path.Combine(home ?? FarolPaths.DefaultHome(), "state", "casca.json");
    }

    /// <summary>
    /// O casca.json que este motor vai gravar: <c>&lt;home&gt;/state/casca.json</c>, com o home
    /// padrão do motor (<c>~/.farol</c>) quando nenhum foi dado.
    /// </summary>
    public string EngineFilePath { get; }

    /// <summary>
    /// O código de saída de cada término do filho, na ordem em que acontecem. O canal tem um
    /// consumidor só: duas enumerações ao mesmo tempo dividiriam os códigos entre si. Termina
    /// no <see cref="Dispose"/>.
    /// </summary>
    public IAsyncEnumerable<int> ExitCodes => _exitCodes.Reader.ReadAllAsync();

    /// <summary>O pid do filho mais recente, ou <c>null</c> se nunca subiu.</summary>
    public int? Pid
    {
        get
        {
            lock (_gate)
            {
                return _process?.Id;
            }
        }
    }

    public bool IsRunning
    {
        get
        {
            lock (_gate)
            {
                return _process is { } p && !HasExited(p);
            }
        }
    }

    /// <summary>
    /// As últimas linhas de stderr do motor, só em memória, para diagnóstico. Nunca vão para log:
    /// a casca não sabe o que o motor escreveu ali.
    /// </summary>
    public IReadOnlyList<string> RecentStderr => _stderr.ToArray();

    /// <summary>
    /// Apaga o casca.json que sobrou de um motor anterior e sobe o filho. O arquivo velho tem que
    /// sair ANTES do spawn: um motor que caiu deixa o arquivo para trás, e parear com o código já
    /// gasto dele prenderia a casca numa porta morta.
    /// </summary>
    public Task StartAsync()
    {
        lock (_gate)
        {
            if (_process is { } running && !HasExited(running))
            {
                throw new InvalidOperationException("O motor já está rodando.");
            }
            _process?.Dispose();
            _process = null;

            DeleteStaleEngineFile();
            // O stderr guardado é deste filho: a porta ocupada que a casca procura nele não pode
            // vir de um motor anterior.
            _stderr.Clear();

            var info = new ProcessStartInfo(_nodeExe)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                // Um pipe que a casca segura e nunca escreve: o motor em modo casca sai quando o
                // stdin chega ao fim (lib/engine/casca-stdin.js). Herdado, o stdin de um app sem
                // console chegaria ao fim na largada e o motor sairia sozinho. O Job Object
                // continua sendo quem leva o motor junto quando a casca cai.
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            info.ArgumentList.Add(_serverJs);
            var appDir = Path.GetDirectoryName(_serverJs);
            if (!string.IsNullOrEmpty(appDir) && Directory.Exists(appDir))
            {
                info.WorkingDirectory = appDir;
            }
            info.Environment["FAROL_SHELL"] = "win";
            info.Environment["FAROL_SHELL_VERSION"] = _shellVersion;
            if (_home is not null)
            {
                info.Environment["FAROL_HOME"] = _home;
            }
            else
            {
                // Sem home dado, o motor tem que usar o padrão, que é onde EngineFilePath aponta.
                // Um FAROL_HOME herdado do ambiente da casca (de quem abriu o Farol.exe num shell
                // de teste, por exemplo) faria o motor gravar o casca.json em outra pasta e a casca
                // esperar para sempre no caminho padrão; por isso ele sai do ambiente do filho.
                info.Environment.Remove("FAROL_HOME");
            }

            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, _) => { };
            process.ErrorDataReceived += (_, e) => KeepStderr(e.Data);
            process.Exited += (_, _) => _exitCodes.Writer.TryWrite(SafeExitCode(process));
            try
            {
                process.Start();
            }
            catch
            {
                process.Dispose();
                throw;
            }
            if (OperatingSystem.IsWindows())
            {
                AssignToJob(process);
            }
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            _process = process;
        }
        return Task.CompletedTask;
    }

    /// <summary>
    /// Encerra o filho com a árvore dele e espera até 5 s. Ainda vivo depois disso vira uma
    /// linha de aviso no log injetado.
    /// </summary>
    public async Task StopAsync()
    {
        Process? process;
        lock (_gate)
        {
            process = _process;
        }
        if (process is null || HasExited(process))
        {
            return;
        }
        var pid = process.Id;

        if (OperatingSystem.IsWindows())
        {
            // Direto com /F: um filho console com CreateNoWindow não tem janela para receber o
            // WM_CLOSE do taskkill sem /F, e a tentativa graciosa só custaria 5 s. /T leva a árvore
            // (o motor abre gh, git e sessões de IA); o killTree do próprio motor e o Job Object
            // cobrem o resto. Sem a saída ordenada o casca.json fica para trás, o que é inofensivo:
            // o StartAsync seguinte o apaga antes de subir.
            await RunTaskkillAsync($"/T /F /PID {pid}").ConfigureAwait(false);
        }
        else
        {
            // Fora do Windows este ramo existe para os testes rodarem no Mac e no Linux; a casca
            // Windows de produção sempre passa pelo taskkill acima.
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception
                or NotSupportedException)
            {
                // O processo saiu entre a conferência e o kill.
            }
        }

        if (!await WaitForExitAsync(process, StopWait).ConfigureAwait(false))
        {
            _log?.Invoke($"WARN motor (pid {pid}) ainda vivo depois de pedir o encerramento");
        }
    }

    /// <summary>
    /// Solta o handle do filho. No Windows fecha também o Job Object, e com o
    /// KILL_ON_JOB_CLOSE o motor que ainda estiver rodando morre junto.
    /// </summary>
    public void Dispose()
    {
        lock (_gate)
        {
            _process?.Dispose();
            _process = null;
            _job?.Dispose();
            _job = null;
        }
        _exitCodes.Writer.TryComplete();
    }

    // Um job por EngineProcess, criado no primeiro spawn e reaproveitado nos seguintes. O handle
    // é deste processo da casca: se a casca cai, o sistema o fecha e o motor morre com ela.
    // Falhar ao criar ou ao atribuir é aviso, nunca impede o motor de subir.
    private void AssignToJob(Process process)
    {
        if (_jobFailed)
        {
            return;
        }
        try
        {
            _job ??= JobObject.Create();
            _job.Assign(process.SafeHandle);
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException
            or PlatformNotSupportedException)
        {
            if (_job is null)
            {
                _jobFailed = true;
            }
            if (_job is not null && HasExited(process))
            {
                // O filho saiu antes da atribuição: não há o que pôr no job, e o código de saída
                // já segue pelo canal.
                return;
            }
            _log?.Invoke("WARN não consegui pôr o motor num Job Object: " + e.Message);
        }
    }

    private void DeleteStaleEngineFile()
    {
        try
        {
            File.Delete(EngineFilePath);
        }
        catch (DirectoryNotFoundException)
        {
            // Sem a pasta state ainda: nada a apagar.
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Não apagou: a espera pelo arquivo novo ainda filtra pela hora de gravação.
            _log?.Invoke("WARN não consegui apagar o casca.json anterior: " + e.GetType().Name);
        }
    }

    private void KeepStderr(string? line)
    {
        if (line is null)
        {
            return;
        }
        _stderr.Enqueue(line);
        while (_stderr.Count > StderrLinesKept && _stderr.TryDequeue(out _))
        {
        }
    }

    // Conferência por enquete, e não WaitForExitAsync: este espera também o fim da saída
    // redirecionada, e um neto que herdou o pipe seguraria a espera depois de o motor morrer.
    private static async Task<bool> WaitForExitAsync(Process process, TimeSpan timeout)
    {
        var watch = Stopwatch.StartNew();
        while (!HasExited(process))
        {
            if (watch.Elapsed >= timeout)
            {
                return false;
            }
            await Task.Delay(ExitPoll).ConfigureAwait(false);
        }
        return true;
    }

    private static async Task RunTaskkillAsync(string arguments)
    {
        // Sem redirecionar a saída: o taskkill imprime uma linha por processo morto, e um pipe que
        // ninguém lê enche com uma árvore grande e o trava no meio. CreateNoWindow já esconde a janela.
        var info = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "taskkill.exe"), arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        try
        {
            using var taskkill = Process.Start(info);
            if (taskkill is null)
            {
                return;
            }
            using var cts = new CancellationTokenSource(StopWait);
            await taskkill.WaitForExitAsync(cts.Token).ConfigureAwait(false);
        }
        catch (Exception e) when (e is OperationCanceledException or System.ComponentModel.Win32Exception
            or InvalidOperationException)
        {
            // O taskkill que não roda ou não volta cai na conferência de vida logo depois.
        }
    }

    private static bool HasExited(Process process)
    {
        try
        {
            return process.HasExited;
        }
        catch (InvalidOperationException)
        {
            return true;
        }
    }

    private static int SafeExitCode(Process process)
    {
        try
        {
            return process.ExitCode;
        }
        catch (InvalidOperationException)
        {
            return -1;
        }
    }
}
