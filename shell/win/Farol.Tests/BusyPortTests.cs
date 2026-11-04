using Farol.Contrato;

namespace Farol.Tests;

/// <summary>A porta que o motor não conseguiu abrir, lida do stderr dele.</summary>
public class BusyPortTests
{
    [Fact]
    public void ReadsTheEngineMessage()
    {
        // O que o server.js imprime quando o listen falha (err.message do Node).
        string[] stderr = ["[farol] erro ao subir o servidor: listen EADDRINUSE: address already in use 127.0.0.1:47170"];

        Assert.Equal(47170, BusyPort.FromStderr(stderr));
    }

    [Theory]
    [InlineData("Error: listen EADDRINUSE: address already in use 127.0.0.1:47170", 47170)]
    [InlineData("Error: listen EADDRINUSE: address already in use :::47180", 47180)]
    [InlineData("Error: listen EADDRINUSE: address already in use localhost:8080  ", 8080)]
    [InlineData("Error: listen EADDRINUSE: address already in use [::1]:47170", 47170)]
    public void ReadsNodeMessages(string line, int port)
    {
        Assert.Equal(port, BusyPort.FromStderr([line]));
    }

    [Fact]
    public void ReadsTheLineAmongOthers()
    {
        string[] stderr =
        [
            "(node:1234) ExperimentalWarning: qualquer coisa",
            "Error: listen EADDRINUSE: address already in use 127.0.0.1:47170",
            "    at Server.setupListenHandle [as _listen2] (node:net:1872:16)",
        ];

        Assert.Equal(47170, BusyPort.FromStderr(stderr));
    }

    [Fact]
    public void ReadsTheNodeErrorObject()
    {
        string[] stderr = ["  code: 'EADDRINUSE',", "  errno: -4091,", "  syscall: 'listen',", "  address: '127.0.0.1',", "  port: 47170"];

        Assert.Equal(47170, BusyPort.FromStderr(stderr));
    }

    [Theory]
    [InlineData("Error: listen EACCES: permission denied 127.0.0.1:80")]
    [InlineData("TypeError: x is not a function")]
    [InlineData("listen EADDRINUSE sem porta")]
    [InlineData("Error: listen EADDRINUSE: address already in use 127.0.0.1:99999")]
    [InlineData("")]
    public void NoMatchIsNull(string line)
    {
        Assert.Null(BusyPort.FromStderr([line]));
    }

    [Fact]
    public void PortLineWithoutEaddrinuseIsNull()
    {
        Assert.Null(BusyPort.FromStderr(["  port: 47170"]));
    }

    [Fact]
    public void EmptyOrNullLinesAreNull()
    {
        Assert.Null(BusyPort.FromStderr([]));
        Assert.Null(BusyPort.FromStderr([null!]));
    }

    [Fact]
    public void DefaultPortIsTheEngineOne()
    {
        // DEFAULT_PORT de lib/constants.js.
        Assert.Equal(47170, EngineDefaults.Port);
    }
}
