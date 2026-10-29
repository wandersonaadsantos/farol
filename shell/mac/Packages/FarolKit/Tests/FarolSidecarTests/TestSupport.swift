import Foundation
import os

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

/// Consome um fluxo numa tarefa própria e guarda tudo o que chega, para o teste conferir.
///
/// Uma tarefa só lê do começo ao fim: cancelar quem itera um `AsyncStream` encerra o fluxo,
/// então ler em pedaços com tarefas canceladas perderia o que vem depois.
final class Collector<Value: Sendable>: Sendable {
    private let received = OSAllocatedUnfairLock(initialState: [Value]())
    private let task: Task<Void, Never>

    init(_ stream: AsyncStream<Value>) {
        task = Task { [received] in
            for await value in stream {
                received.withLock { $0.append(value) }
            }
        }
    }

    var values: [Value] { received.withLock { $0 } }

    func cancel() { task.cancel() }
}

/// Espera até a condição valer, conferindo a cada 10 ms; devolve se valeu dentro do prazo.
func waitUntil(within seconds: Double, _ condition: @Sendable () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + .seconds(seconds)
    while ContinuousClock.now < deadline {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return condition()
}
