using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading.Channels;

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

    public EngineProcess(string nodeExe, string serverJs, string? home, string shellVersion, Action<string>? log = null)
    {
        _nodeExe = nodeExe;
        _serverJs = serverJs;
        _home = home;
        _shellVersion = shellVersion;
        _log = log;
        EngineFilePath = Path.Combine(home ?? DefaultHome(), "state", "casca.json");
    }

    /// <summary>
    /// O casca.json que este motor vai gravar: <c>&lt;home&gt;/state/casca.json</c>, com o home
    /// padrão do motor (<c>~/.farol</c>) quando nenhum foi dado.
    /// </summary>
    public string EngineFilePath { get; }

    /// <summary>O código de saída de cada término do filho, na ordem em que acontecem.</summary>
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

            var info = new ProcessStartInfo(_nodeExe)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
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
                // Um FAROL_HOME herdado do ambiente da casca faria os dois discordarem.
                info.Environment.Remove("FAROL_HOME");
            }

            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, _) => { };
            process.ErrorDataReceived += (_, e) => KeepStderr(e.Data);
            process.Exited += (_, _) => _exitCodes.Writer.TryWrite(SafeExitCode(process));
            process.Start();
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
            // taskkill /T leva a árvore toda (o motor abre gh, git e sessões de IA). Sem /F primeiro;
            // se em 5 s o motor ainda vive, /F.
            await RunTaskkillAsync($"/T /PID {pid}").ConfigureAwait(false);
            if (!await WaitForExitAsync(process, StopWait).ConfigureAwait(false))
            {
                await RunTaskkillAsync($"/T /F /PID {pid}").ConfigureAwait(false);
            }
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

    public void Dispose()
    {
        lock (_gate)
        {
            _process?.Dispose();
            _process = null;
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
        var info = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "taskkill.exe"), arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
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

    private static string DefaultHome()
    {
        // O mesmo home do motor (os.homedir() mais .farol): %USERPROFILE% no Windows, $HOME fora.
        var profile = OperatingSystem.IsWindows()
            ? Environment.GetEnvironmentVariable("USERPROFILE")
            : Environment.GetEnvironmentVariable("HOME");
        if (string.IsNullOrEmpty(profile))
        {
            profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }
        return Path.Combine(profile, ".farol");
    }
}
