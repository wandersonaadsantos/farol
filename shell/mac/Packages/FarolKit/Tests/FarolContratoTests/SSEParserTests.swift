import Foundation
import Testing

@testable import FarolContrato

/// Achata o resultado do parser para comparar com `#expect`.
private func flatten(_ events: [(name: String, data: Data)]) -> [String] {
    events.map { "\($0.name)|\(String(decoding: $0.data, as: UTF8.self))" }
}

@Test func eventSplitAcrossTwoChunks() {
    var parser = SSEParser()
    #expect(parser.feed(Data("event: casca\ndata: {\"ocu".utf8)).isEmpty)
    let events = parser.feed(Data("pado\":true}\n\n".utf8))
    #expect(flatten(events) == [#"casca|{"ocupado":true}"#])
}

@Test func pingIsIgnored() {
    var parser = SSEParser()
    let events = parser.feed(Data("event: ping\ndata: {}\n\nevent: casca\ndata: {}\n\n".utf8))
    #expect(flatten(events) == ["casca|{}"])
}

@Test func twoEventsInOneChunk() {
    var parser = SSEParser()
    let events = parser.feed(
        Data("event: aviso-nativo\ndata: {\"a\":1}\n\nevent: casca-saida\ndata: {\"b\":2}\n\n".utf8)
    )
    #expect(flatten(events) == [#"aviso-nativo|{"a":1}"#, #"casca-saida|{"b":2}"#])
}

@Test func crlfCommentsAndMultipleDataLines() {
    var parser = SSEParser()
    let events = parser.feed(Data(": comentário\r\nevent: casca\r\ndata: um\r\ndata: dois\r\n\r\n".utf8))
    #expect(flatten(events) == ["casca|um\ndois"])
}

@Test func messageWithoutEventNameIsIgnored() {
    var parser = SSEParser()
    #expect(parser.feed(Data("data: {}\n\n".utf8)).isEmpty)
}
