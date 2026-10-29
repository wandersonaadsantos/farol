using System.Runtime.Versioning;
using Windows.Security.Credentials;

namespace Farol.Sidecar;

/// <summary>
/// O token da A4 no PasswordVault do Windows (cofre do usuário, nunca em arquivo nem em log).
/// Fora do Windows todo método lança <see cref="PlatformNotSupportedException"/>.
/// </summary>
public sealed class TokenStore
{
    public const string DefaultResource = "com.biud.farol";
    public const string UserName = "local-auth-token";

    private readonly string _resource;

    public TokenStore(string resource = DefaultResource)
    {
        _resource = resource;
    }

    /// <summary>O token guardado, ou <c>null</c> quando não há nenhum (ou o cofre não o devolve).</summary>
    public string? Load()
    {
        EnsureWindows();
        return LoadCore();
    }

    /// <summary>Guarda o token, trocando o anterior se houver.</summary>
    public void Save(string token)
    {
        ArgumentException.ThrowIfNullOrEmpty(token);
        EnsureWindows();
        SaveCore(token);
    }

    /// <summary>Apaga o token; sem token guardado, não faz nada.</summary>
    public void Delete()
    {
        EnsureWindows();
        DeleteCore();
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("O cofre de senhas só existe no Windows.");
        }
    }

    [SupportedOSPlatform("windows10.0.17763.0")]
    private PasswordCredential? Find(PasswordVault vault)
    {
        try
        {
            return vault.Retrieve(_resource, UserName);
        }
        catch (Exception)
        {
            // O Retrieve lança (COMException, "elemento não encontrado") quando não há
            // credencial: ausência, não falha.
            return null;
        }
    }

    [SupportedOSPlatform("windows10.0.17763.0")]
    private string? LoadCore()
    {
        var credential = Find(new PasswordVault());
        if (credential is null)
        {
            return null;
        }
        try
        {
            // Sem o RetrievePassword o Password vem vazio.
            credential.RetrievePassword();
            return string.IsNullOrEmpty(credential.Password) ? null : credential.Password;
        }
        catch (Exception)
        {
            return null;
        }
    }

    [SupportedOSPlatform("windows10.0.17763.0")]
    private void SaveCore(string token)
    {
        var vault = new PasswordVault();
        // O cofre guarda uma credencial por par recurso e usuário; a antiga sai antes, para
        // nunca restarem duas.
        if (Find(vault) is { } old)
        {
            vault.Remove(old);
        }
        vault.Add(new PasswordCredential(_resource, UserName, token));
    }

    [SupportedOSPlatform("windows10.0.17763.0")]
    private void DeleteCore()
    {
        var vault = new PasswordVault();
        if (Find(vault) is not { } credential)
        {
            return;
        }
        try
        {
            vault.Remove(credential);
        }
        catch (Exception)
        {
            // Outro processo apagou entre o Retrieve e o Remove: o resultado é o mesmo.
        }
    }
}
