import Foundation

/// Onde moram o `node` e o `server.js` que a casca sobe.
public struct EngineLocator {
    /// Os caminhos dentro do bundle do app: `Contents/Resources/engine/node/bin/node` e
    /// `Contents/Resources/engine/app/server.js`. Usa o `resourceURL` do bundle, então vale
    /// para qualquer bundle (o do app ou um falso nos testes).
    public static func bundled(in bundle: Bundle = .main) -> (node: URL, serverJS: URL) {
        let resources =
            bundle.resourceURL
            ?? bundle.bundleURL.appendingPathComponent("Contents/Resources", isDirectory: true)
        let engine = resources.appendingPathComponent("engine", isDirectory: true)
        return (
            node: engine.appendingPathComponent("node/bin/node"),
            serverJS: engine.appendingPathComponent("app/server.js")
        )
    }

    /// Os caminhos de desenvolvimento quando `FAROL_NODE` e `FAROL_SERVER_JS` estão os dois
    /// no ambiente e não vazios (o bundle local ainda não carrega o motor; quem empacota é o
    /// plano de release). Com só um deles, ou nenhum, vale o bundle.
    public static func resolve(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        bundle: Bundle = .main
    ) -> (node: URL, serverJS: URL) {
        if let node = environment["FAROL_NODE"], !node.isEmpty,
            let serverJS = environment["FAROL_SERVER_JS"], !serverJS.isEmpty
        {
            return (node: URL(fileURLWithPath: node), serverJS: URL(fileURLWithPath: serverJS))
        }
        return bundled(in: bundle)
    }
}
