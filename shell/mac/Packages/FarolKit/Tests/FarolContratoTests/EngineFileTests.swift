import Foundation
import Testing

@testable import FarolContrato

/// Grava um conteúdo num arquivo temporário e devolve o caminho.
private func temporaryFile(_ contents: String) throws -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("casca-\(UUID().uuidString).json")
    try Data(contents.utf8).write(to: url)
    return url
}

@Test func readsTheEngineFileWithAllFields() throws {
    let url = try temporaryFile(
        """
        { "porta": 47170, "pid": 12345, "versao": "2.79.0", "codigoPareamento": "K7QMZP2XWD",
          "iniciadoEm": 1761600000000, "proximaVersao": null }
        """
    )
    defer { try? FileManager.default.removeItem(at: url) }

    let file = try #require(try EngineFile.read(at: url))
    #expect(file.port == 47170)
    #expect(file.pid == 12345)
    #expect(file.version == "2.79.0")
    #expect(file.pairingCode == "K7QMZP2XWD")
    #expect(file.startedAt == Date(timeIntervalSince1970: 1_761_600_000))
    #expect(file.nextVersion == nil)
}

@Test func readsTheNextVersionWhenPresent() throws {
    let url = try temporaryFile(
        """
        { "porta": 1, "pid": 2, "versao": "2.79.0", "codigoPareamento": "X",
          "iniciadoEm": 0, "proximaVersao": "2.80.0" }
        """
    )
    defer { try? FileManager.default.removeItem(at: url) }

    let file = try #require(try EngineFile.read(at: url))
    #expect(file.nextVersion == "2.80.0")
}

@Test func invalidJsonIsNil() throws {
    let url = try temporaryFile("{nope")
    defer { try? FileManager.default.removeItem(at: url) }

    #expect(try EngineFile.read(at: url) == nil)
}

@Test func wrongShapeIsNil() throws {
    let url = try temporaryFile(#"{ "porta": "não é número" }"#)
    defer { try? FileManager.default.removeItem(at: url) }

    #expect(try EngineFile.read(at: url) == nil)
}

@Test func missingFileIsNil() throws {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("nao-existe-\(UUID().uuidString).json")

    #expect(try EngineFile.read(at: url) == nil)
}
