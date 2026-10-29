using Farol.Sidecar;

namespace Farol.Tests;

/// <summary>O token da A4 no PasswordVault, num recurso de teste apagado no fim.</summary>
public sealed class TokenStoreTests
{
    private const string TestResource = "com.biud.farol.test";

    [WindowsFact]
    public void SaveLoadDeleteRoundTrip()
    {
        var store = new TokenStore(TestResource);
        try
        {
            store.Delete();
            Assert.Null(store.Load());

            store.Save("token-de-teste-1");
            Assert.Equal("token-de-teste-1", store.Load());

            // gravar de novo troca o valor, não acumula
            store.Save("token-de-teste-2");
            Assert.Equal("token-de-teste-2", store.Load());

            store.Delete();
            Assert.Null(store.Load());

            // apagar o que não existe não lança
            store.Delete();
        }
        finally
        {
            store.Delete();
        }
    }

    [NonWindowsFact]
    public void OutsideWindowsIsNotSupported()
    {
        var store = new TokenStore(TestResource);

        Assert.Throws<PlatformNotSupportedException>(() => store.Load());
        Assert.Throws<PlatformNotSupportedException>(() => store.Save("x"));
        Assert.Throws<PlatformNotSupportedException>(() => store.Delete());
    }
}
