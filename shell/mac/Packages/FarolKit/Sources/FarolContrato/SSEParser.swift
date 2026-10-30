import Foundation

/// Parser incremental do fluxo SSE do motor (`event: <nome>\ndata: <json>\n\n`).
///
/// Acumula bytes entre chamadas de `feed` e devolve só as mensagens completas. Aceita
/// `\r\n`, junta várias linhas `data:` com `\n` e ignora comentários (linhas que começam
/// com `:`), o batimento `event: ping` e mensagens sem `event:`.
public struct SSEParser: Sendable {
    private var buffer = Data()
    private var eventName: String?
    private var dataLines: [String] = []

    public init() {}

    /// Entrega um pedaço do fluxo e devolve as mensagens que ele completou, na ordem.
    public mutating func feed(_ bytes: Data) -> [(name: String, data: Data)] {
        buffer.append(bytes)
        var events: [(name: String, data: Data)] = []
        while let newline = buffer.firstIndex(of: 0x0A) {
            var line = buffer[buffer.startIndex..<newline]
            buffer = Data(buffer[buffer.index(after: newline)...])
            if line.last == 0x0D {
                line = line.dropLast()
            }
            if let event = consume(line: String(decoding: line, as: UTF8.self)) {
                events.append(event)
            }
        }
        return events
    }

    /// Processa uma linha sem o terminador; linha vazia fecha a mensagem.
    private mutating func consume(line: String) -> (name: String, data: Data)? {
        if line.isEmpty {
            defer {
                eventName = nil
                dataLines = []
            }
            guard let name = eventName, name != "ping", !dataLines.isEmpty else { return nil }
            return (name: name, data: Data(dataLines.joined(separator: "\n").utf8))
        }
        if line.hasPrefix(":") {
            return nil
        }
        let field: Substring
        var value: Substring
        if let colon = line.firstIndex(of: ":") {
            field = line[..<colon]
            value = line[line.index(after: colon)...]
            if value.first == " " {
                value = value.dropFirst()
            }
        } else {
            field = Substring(line)
            value = ""
        }
        switch field {
        case "event":
            eventName = String(value)
        case "data":
            dataLines.append(String(value))
        default:
            break
        }
        return nil
    }
}
