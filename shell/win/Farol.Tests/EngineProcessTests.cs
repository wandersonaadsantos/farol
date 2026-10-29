using System.Diagnostics;
using Farol.Sidecar;

namespace Farol.Tests;

/// <summary>
/// O processo do motor com um node falso: um script (.cmd no Windows, sh nos outros) que
/// grava o ambiente recebido, escreve um casca.json e dorme. O script ignora o argv, então
/// o server.js aqui é um caminho qualquer.
/// </summary>
public sealed class EngineProcessTests : IDisposable
{
    private readonly string _dir;
    private readonly string _home;

    public EngineProcessTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "farol-engine-" + Guid.NewGuid().ToString("N"));
        _home = Path.Combine(_dir, "home");
        Directory.CreateDirectory(_home);
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(_dir, recursive: true);
        }
        catch (IOException)
        {
            // Um filho que ainda segura arquivo não pode derrubar o teste.
        }
    }

    private enum Fake { WritesAndSleeps, OnlySleeps, ExitsWith3 }

    private string WriteFake(Fake kind)
    {
        if (OperatingSystem.IsWindows())
        {
            var body = kind switch
            {
                Fake.ExitsWith3 => "exit /b 3\r\n",
                Fake.OnlySleeps => "ping -n 31 127.0.0.1 > nul\r\n",
                _ =>
                    "> \"%FAROL_HOME%\\env.txt\" (\r\n"
                    + "echo FAROL_SHELL=%FAROL_SHELL%\r\n"
                    + "echo FAROL_SHELL_VERSION=%FAROL_SHELL_VERSION%\r\n"
                    + "echo FAROL_HOME=%FAROL_HOME%\r\n"
                    + ")\r\n"
                    + "if not exist \"%FAROL_HOME%\\state\" mkdir \"%FAROL_HOME%\\state\"\r\n"
                    + "> \"%FAROL_HOME%\\state\\casca.json\" echo {\"porta\":47170,\"pid\":1,\"versao\":\"9.9.9\",\"codigoPareamento\":\"NOVO\",\"iniciadoEm\":0}\r\n"
                    + "ping -n 31 127.0.0.1 > nul\r\n",
            };
            var cmd = Path.Combine(_dir, "node.cmd");
            File.WriteAllText(cmd, "@echo off\r\n" + body);
            return cmd;
        }

        var sh = kind switch
        {
            Fake.ExitsWith3 => "exit 3\n",
            Fake.OnlySleeps => "exec sleep 30\n",
            _ =>
                "printf 'FAROL_SHELL=%s\\nFAROL_SHELL_VERSION=%s\\nFAROL_HOME=%s\\n' \"$FAROL_SHELL\" \"$FAROL_SHELL_VERSION\" \"$FAROL_HOME\" > \"$FAROL_HOME/env.txt\"\n"
                + "mkdir -p \"$FAROL_HOME/state\"\n"
                + "printf '{\"porta\":47170,\"pid\":%s,\"versao\":\"9.9.9\",\"codigoPareamento\":\"NOVO\",\"iniciadoEm\":0}' \"$$\" > \"$FAROL_HOME/state/casca.json\"\n"
                + "exec sleep 30\n",
        };
        var path = Path.Combine(_dir, "node.sh");
        File.WriteAllText(path, "#!/bin/sh\n" + sh);
        File.SetUnixFileMode(path,
            UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            | UnixFileMode.GroupRead | UnixFileMode.GroupExecute
            | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        return path;
    }

    private EngineProcess NewProcess(Fake kind) =>
        new(WriteFake(kind), Path.Combine(_dir, "server.js"), _home, "3.1.4");

    private static async Task<int> NextExitCode(EngineProcess engine, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        await foreach (var code in engine.ExitCodes.WithCancellation(cts.Token))
        {
            return code;
        }
        throw new InvalidOperationException("O canal de códigos de saída fechou sem código.");
    }

    [Fact]
    public async Task PassesShellEnvironmentToTheChild()
    {
        using var engine = NewProcess(Fake.WritesAndSleeps);
        try
        {
            await engine.StartAsync();
            await EngineProbe.WaitForEngineFileAsync(engine.EngineFilePath, TimeSpan.FromSeconds(5));
            var env = (await File.ReadAllLinesAsync(Path.Combine(_home, "env.txt"))).Select(l => l.Trim()).ToList();

            Assert.Contains("FAROL_SHELL=win", env);
            Assert.Contains("FAROL_SHELL_VERSION=3.1.4", env);
            Assert.Contains("FAROL_HOME=" + _home, env);
        }
        finally
        {
            await engine.StopAsync();
        }
    }

    [Fact]
    public void EngineFilePathLivesUnderHomeState()
    {
        using var engine = NewProcess(Fake.OnlySleeps);

        Assert.Equal(Path.Combine(_home, "state", "casca.json"), engine.EngineFilePath);
    }

    [Fact]
    public void EngineFilePathDefaultsToUserProfileFarol()
    {
        using var engine = new EngineProcess("node", "server.js", null, "3.1.4");
        var profile = OperatingSystem.IsWindows()
            ? Environment.GetEnvironmentVariable("USERPROFILE")
            : Environment.GetEnvironmentVariable("HOME");

        Assert.Equal(Path.Combine(profile!, ".farol", "state", "casca.json"), engine.EngineFilePath);
    }

    [Fact]
    public async Task DeletesStaleEngineFileBeforeSpawning()
    {
        using var engine = NewProcess(Fake.OnlySleeps);
        Directory.CreateDirectory(Path.GetDirectoryName(engine.EngineFilePath)!);
        await File.WriteAllTextAsync(engine.EngineFilePath, """{"porta":1,"pid":1,"codigoPareamento":"VELHO"}""");
        try
        {
            await engine.StartAsync();

            // Este falso não escreve casca.json: se o arquivo ainda existe, ninguém o apagou.
            Assert.False(File.Exists(engine.EngineFilePath));
            Assert.True(engine.IsRunning);
            Assert.NotNull(engine.Pid);
        }
        finally
        {
            await engine.StopAsync();
        }
    }

    [Fact]
    public async Task NewEngineFileReplacesTheStaleOne()
    {
        using var engine = NewProcess(Fake.WritesAndSleeps);
        Directory.CreateDirectory(Path.GetDirectoryName(engine.EngineFilePath)!);
        await File.WriteAllTextAsync(engine.EngineFilePath, """{"porta":1,"pid":1,"codigoPareamento":"VELHO"}""");
        File.SetLastWriteTimeUtc(engine.EngineFilePath, DateTime.UtcNow.AddMinutes(-10));
        try
        {
            var spawn = DateTimeOffset.UtcNow;
            await engine.StartAsync();
            var file = await EngineProbe.WaitForEngineFileAsync(engine.EngineFilePath, TimeSpan.FromSeconds(5), spawn);

            Assert.Equal("NOVO", file.PairingCode);
            Assert.Equal(47170, file.Port);
        }
        finally
        {
            await engine.StopAsync();
        }
    }

    [Fact]
    public async Task StopEndsTheProcessAndYieldsAnExitCode()
    {
        using var engine = NewProcess(Fake.OnlySleeps);
        await engine.StartAsync();
        Assert.True(engine.IsRunning);

        var watch = Stopwatch.StartNew();
        await engine.StopAsync();
        var code = await NextExitCode(engine, TimeSpan.FromSeconds(6));

        Assert.False(engine.IsRunning);
        // taskkill /F no Windows e Kill fora dele: os dois são imediatos, a folga é para máquina lenta.
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(6));
        Assert.NotEqual(0, code);
    }

    [Fact]
    public async Task ChildExitingYieldsItsCode()
    {
        using var engine = NewProcess(Fake.ExitsWith3);
        await engine.StartAsync();

        Assert.Equal(3, await NextExitCode(engine, TimeSpan.FromSeconds(5)));
        Assert.False(engine.IsRunning);
    }

    [Fact]
    public async Task CanStartAgainAfterTheChildExited()
    {
        using var engine = NewProcess(Fake.ExitsWith3);
        await engine.StartAsync();
        Assert.Equal(3, await NextExitCode(engine, TimeSpan.FromSeconds(5)));

        await engine.StartAsync();

        Assert.Equal(3, await NextExitCode(engine, TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public async Task StopWithoutStartDoesNothing()
    {
        using var engine = NewProcess(Fake.OnlySleeps);

        await engine.StopAsync();

        Assert.False(engine.IsRunning);
        Assert.Null(engine.Pid);
    }
}
