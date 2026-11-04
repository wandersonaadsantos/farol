using System.Text;
using Farol.Contrato;

namespace Farol.Tests;

public class SseParserTests
{
    private static byte[] Bytes(string text) => Encoding.UTF8.GetBytes(text);

    private static string Text(byte[] data) => Encoding.UTF8.GetString(data);

    [Fact]
    public void EventSplitAcrossChunksInsideAMultiByteChar()
    {
        var parser = new SseParser();
        var whole = Bytes("event: aviso-nativo\ndata: {\"corpo\":\"revisão\"}\n\n");
        // corta no meio do "ã" (dois bytes em UTF-8), que está no meio da linha data
        var cut = Array.IndexOf(whole, (byte)0xC3) + 1;

        var first = parser.Feed(whole.AsSpan(0, cut));
        var second = parser.Feed(whole.AsSpan(cut));

        Assert.Empty(first);
        var evt = Assert.Single(second);
        Assert.Equal("aviso-nativo", evt.Name);
        Assert.Equal("{\"corpo\":\"revisão\"}", Text(evt.Data));
    }

    [Fact]
    public void PingWithoutDataYieldsNothing()
    {
        Assert.Empty(new SseParser().Feed(Bytes("event: ping\n\n")));
    }

    [Fact]
    public void CommentYieldsNothing()
    {
        Assert.Empty(new SseParser().Feed(Bytes(": keep-alive\n\n")));
    }

    [Fact]
    public void TwoEventsInOneChunk()
    {
        var events = new SseParser().Feed(Bytes("event: casca\ndata: {}\n\nevent: casca-saida\ndata: {\"motivo\":\"update\"}\n\n"));

        Assert.Equal(2, events.Count);
        Assert.Equal("casca", events[0].Name);
        Assert.Equal("{}", Text(events[0].Data));
        Assert.Equal("casca-saida", events[1].Name);
        Assert.Equal("{\"motivo\":\"update\"}", Text(events[1].Data));
    }

    [Fact]
    public void CrLfEndings()
    {
        var evt = Assert.Single(new SseParser().Feed(Bytes("event: casca\r\ndata: {}\r\n\r\n")));

        Assert.Equal("casca", evt.Name);
        Assert.Equal("{}", Text(evt.Data));
    }

    [Fact]
    public void CrLfSplitBetweenChunks()
    {
        var parser = new SseParser();

        Assert.Empty(parser.Feed(Bytes("event: casca\r\ndata: {}\r")));
        var evt = Assert.Single(parser.Feed(Bytes("\n\r\n")));
        Assert.Equal("{}", Text(evt.Data));
    }

    [Fact]
    public void MultiLineDataIsJoinedWithNewLine()
    {
        var evt = Assert.Single(new SseParser().Feed(Bytes("event: x\ndata: a\ndata: b\n\n")));

        Assert.Equal("a\nb", Text(evt.Data));
    }

    [Fact]
    public void EventWithoutNameIsMessage()
    {
        var evt = Assert.Single(new SseParser().Feed(Bytes("data: oi\n\n")));

        Assert.Equal("message", evt.Name);
    }

    [Fact]
    public void IdRetryAndUnknownFieldsAreIgnored()
    {
        var evt = Assert.Single(new SseParser().Feed(Bytes("id: 7\nretry: 1000\nfoo: bar\nevent: x\ndata:sem-espaco\n\n")));

        Assert.Equal("x", evt.Name);
        Assert.Equal("sem-espaco", Text(evt.Data));
    }

    [Fact]
    public void NameDoesNotLeakIntoNextEvent()
    {
        var events = new SseParser().Feed(Bytes("event: x\ndata: 1\n\ndata: 2\n\n"));

        Assert.Equal(2, events.Count);
        Assert.Equal("message", events[1].Name);
    }
}
