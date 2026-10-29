import Darwin
import FarolContrato
import Foundation

/// Perguntas sobre um motor que talvez já esteja rodando (o `casca.json` de uma subida
/// anterior, por exemplo): o processo existe e quem escuta na porta é mesmo o Farol.
public struct EngineProbe {
    /// `true` só quando `GET /api/auth/status` em `127.0.0.1:<porta>` responde 200 com um
    /// objeto JSON que tem a chave `exigida`. Erro, prazo estourado ou outra resposta: `false`.
    public static func isFarol(port: Int, timeout: Double = 2) async -> Bool {
        guard (1...65535).contains(port),
            let url = URL(string: "http://127.0.0.1:\(port)/api/auth/status")
        else { return false }
        var request = URLRequest(
            url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        // O URLSession trata `Host` como reservado e o preenche pela URL (o teste confere o valor).
        request.setValue("127.0.0.1:\(port)", forHTTPHeaderField: "Host")
        request.setValue("1", forHTTPHeaderField: "x-farol")

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.connectionProxyDictionary = [:]
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }

        guard let (data, response) = try? await session.data(for: request),
            (response as? HTTPURLResponse)?.statusCode == 200,
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        return object["exigida"] != nil
    }

    /// O processo `pid` existe, pelo `kill(pid, 0)`: sucesso ou `EPERM` (existe e é de
    /// outro usuário) contam como vivo; `ESRCH` e pid menor ou igual a zero, não.
    public static func isProcessAlive(pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        if kill(pid, 0) == 0 { return true }
        return errno == EPERM
    }

    /// O motor do arquivo está de pé: o processo existe e a porta responde como Farol.
    /// Só o pid não basta (o número pode ter sido reaproveitado depois de uma queda).
    public static func isEngineAlive(_ file: EngineFile) async -> Bool {
        guard isProcessAlive(pid: file.pid) else { return false }
        return await isFarol(port: file.port)
    }
}
