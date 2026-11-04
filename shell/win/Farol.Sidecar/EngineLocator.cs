namespace Farol.Sidecar;

/// <summary>
/// Onde mora o motor embutido no pacote da casca: o Node em <c>engine\node\node.exe</c> e o
/// <c>server.js</c> em <c>engine\app\</c>, ambos relativos à pasta do executável. Só monta
/// caminhos; quem precisa saber se existem chama <see cref="Found"/>.
/// </summary>
public static class EngineLocator
{
    public static (string NodeExe, string ServerJs) Bundled()
    {
        var root = Path.Combine(AppContext.BaseDirectory, "engine");
        return (Path.Combine(root, "node", "node.exe"), Path.Combine(root, "app", "server.js"));
    }

    /// <summary>Os dois arquivos do motor embutido existem no disco.</summary>
    public static bool Found()
    {
        var (node, server) = Bundled();
        return File.Exists(node) && File.Exists(server);
    }
}
