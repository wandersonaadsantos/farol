import Foundation
import Testing

@testable import FarolContrato

/// Um caso da fixture de paridade compartilhada com o motor e a outra casca.
private struct FixtureCase: Decodable {
    struct Expected: Codable {
        let titulo: String
        let corpo: String
        let url: String?
        let pr: String?
        let silencioso: Bool
    }

    let nome: String
    let esperado: Expected?
}

/// Sobe de `#filePath` até a raiz do repositório (onde mora `test/fixtures/casca/eventos.json`).
private func fixtureURL(from filePath: String = #filePath) -> URL? {
    var directory = URL(fileURLWithPath: filePath).deletingLastPathComponent()
    while directory.path != "/" {
        let candidate = directory.appendingPathComponent("test/fixtures/casca/eventos.json")
        if FileManager.default.fileExists(atPath: candidate.path) {
            return candidate
        }
        directory = directory.deletingLastPathComponent()
    }
    return nil
}

@Test func noticesFromTheParityFixtureDecode() throws {
    let url = try #require(fixtureURL(), "fixture test/fixtures/casca/eventos.json não encontrada")
    let cases = try JSONDecoder().decode([FixtureCase].self, from: Data(contentsOf: url))
    let withNotice = cases.compactMap { item in item.esperado.map { (item.nome, $0) } }
    #expect(withNotice.count >= 10)

    for (name, expected) in withNotice {
        let data = try JSONEncoder().encode(expected)
        let event = ShellEvent.decode(name: "aviso-nativo", data: data)
        guard case .notice(let notice) = event else {
            Issue.record("caso \(name): esperava .notice, veio \(String(describing: event))")
            continue
        }
        #expect(notice.title == expected.titulo, "caso \(name)")
        #expect(notice.body == expected.corpo, "caso \(name)")
        #expect(notice.url?.absoluteString == expected.url, "caso \(name)")
        #expect(notice.pr == expected.pr, "caso \(name)")
        #expect(notice.silent == expected.silencioso, "caso \(name)")
    }
}

@Test func shellStateDecodes() {
    let data = Data(
        """
        { "badge": { "contador": 3, "rotulo": "3" }, "ocupado": true, "autostart": false,
          "cores": { "bg": "#0b1d2a", "symbol": "#f5c542" } }
        """.utf8
    )
    let expected = ShellState(
        badgeCount: 3,
        badgeLabel: "3",
        busy: true,
        autostart: false,
        colors: ShellColors(bg: "#0b1d2a", symbol: "#f5c542")
    )
    #expect(ShellEvent.decode(name: "casca", data: data) == .shell(expected))
}

@Test func exitNoticeDecodes() {
    let update = Data(#"{ "motivo": "update", "proximaVersao": "2.80.0" }"#.utf8)
    #expect(
        ShellEvent.decode(name: "casca-saida", data: update)
            == .exit(ExitNotice(reason: "update", nextVersion: "2.80.0"))
    )

    let restart = Data(#"{ "motivo": "reinicio", "proximaVersao": null }"#.utf8)
    #expect(
        ShellEvent.decode(name: "casca-saida", data: restart)
            == .exit(ExitNotice(reason: "reinicio", nextVersion: nil))
    )
}

@Test func unknownNameIsOtherWithoutDecodingTheBody() {
    let garbage = Data("{nope".utf8)
    #expect(ShellEvent.decode(name: "state", data: garbage) == .other(name: "state"))
    #expect(ShellEvent.decode(name: "state-patch", data: garbage) == .other(name: "state-patch"))
    #expect(ShellEvent.decode(name: "qualquer", data: garbage) == .other(name: "qualquer"))
}

@Test func knownNameWithInvalidBodyIsNil() {
    let garbage = Data("{nope".utf8)
    #expect(ShellEvent.decode(name: "aviso-nativo", data: garbage) == nil)
    #expect(ShellEvent.decode(name: "casca", data: garbage) == nil)
    #expect(ShellEvent.decode(name: "casca-saida", data: garbage) == nil)

    let wrongShape = Data(#"{ "titulo": 1 }"#.utf8)
    #expect(ShellEvent.decode(name: "aviso-nativo", data: wrongShape) == nil)
}
