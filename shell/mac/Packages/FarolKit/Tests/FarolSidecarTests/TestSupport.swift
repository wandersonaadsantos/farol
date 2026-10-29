import Foundation

/// Pasta temporária própria de um teste, apagada por quem chama.
func makeTemporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("farol-sidecar-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// Grava um script de shell executável em `directory` e devolve o caminho dele.
func writeScript(_ body: String, named name: String, in directory: URL) throws -> URL {
    let url = directory.appendingPathComponent(name)
    try ("#!/bin/sh\n" + body).write(to: url, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    return url
}

/// O primeiro valor do fluxo dentro do prazo, ou `nil` quando nada chega a tempo.
func firstValue(of stream: AsyncStream<Int32>, within seconds: Double) async -> Int32? {
    await withTaskGroup(of: Int32?.self) { group in
        group.addTask {
            for await value in stream {
                return value
            }
            return nil
        }
        group.addTask {
            try? await Task.sleep(for: .seconds(seconds))
            return nil
        }
        let first = await group.next() ?? nil
        group.cancelAll()
        return first
    }
}
