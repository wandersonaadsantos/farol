import FarolContrato
import Foundation

/// O que o fluxo de eventos entrega à casca.
public enum EventStreamOutput: Equatable, Sendable {
    /// Um evento que a casca lê (`aviso-nativo`, `casca` ou `casca-saida`).
    case event(ShellEvent)
    /// O motor recusou o token (401); o fluxo para de reconectar até o próximo `start()`.
    case unauthorized
}

/// Espera entre reconexões: começa em `initial` e dobra a cada tentativa, até `maximum`.
public struct BackoffSchedule: Equatable, Sendable {
    public let initial: Duration
    public let maximum: Duration

    /// 3 s dobrando até 30 s, como o `ui/transporte.js`.
    public static let `default` = BackoffSchedule(initial: .seconds(3), maximum: .seconds(30))

    public init(initial: Duration, maximum: Duration) {
        self.initial = initial
        self.maximum = maximum
    }

    /// A espera antes da reconexão de número `attempt` (zero é a primeira).
    public func delay(attempt: Int) -> Duration {
        var delay = initial
        for _ in 0..<max(0, attempt) {
            if delay >= maximum { break }
            delay *= 2
        }
        return min(delay, maximum)
    }
}

/// Cliente do `GET /api/events` do motor.
///
/// Lê o fluxo aos poucos, descarta `state`, `state-patch` e `ping` sem decodificar e entrega
/// só os eventos da casca. Queda ou status diferente de 200 reconecta com o recuo; uma
/// conexão que chegou a abrir zera o recuo. O 401 sai uma vez como `.unauthorized` e encerra
/// as reconexões: quem decide parear de novo é a máquina de estados.
public actor EventStream {
    /// Os eventos, enquanto o objeto existir; `stop()` não fecha o fluxo, para `start()` voltar.
    public nonisolated let events: AsyncStream<EventStreamOutput>

    private let continuation: AsyncStream<EventStreamOutput>.Continuation
    private let port: Int
    private let token: String
    private let session: URLSession
    private let backoff: BackoffSchedule
    private var loop: Task<Void, Never>?
    private var generation = 0

    public init(port: Int, token: String, session: URLSession = .shared, backoff: BackoffSchedule = .default)
    {
        (events, continuation) = AsyncStream.makeStream(of: EventStreamOutput.self)
        self.port = port
        self.token = token
        self.session = session
        self.backoff = backoff
    }

    deinit {
        loop?.cancel()
        continuation.finish()
    }

    /// Começa a ler (e a reconectar); sem efeito quando já está lendo.
    public func start() {
        guard loop == nil else { return }
        generation += 1
        let current = generation
        let request = makeRequest()
        let session = session
        let backoff = backoff
        let continuation = continuation
        loop = Task { [weak self] in
            await Self.run(request: request, session: session, backoff: backoff, continuation: continuation)
            await self?.finished(generation: current)
        }
    }

    /// Para de ler e de reconectar, cancelando a conexão aberta.
    public func stop() {
        loop?.cancel()
        loop = nil
    }

    private func finished(generation finishedGeneration: Int) {
        if finishedGeneration == generation {
            loop = nil
        }
    }

    private func makeRequest() -> URLRequest {
        // A porta inválida cai numa URL que falha na conexão e entra no recuo.
        let url = URL(string: "http://127.0.0.1:\(port)/api/events") ?? URL(fileURLWithPath: "/")
        // O motor manda `ping` a cada 25 s; 75 s sem bytes é conexão morta.
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 75)
        request.setValue("127.0.0.1:\(port)", forHTTPHeaderField: "Host")
        request.setValue("1", forHTTPHeaderField: "x-farol")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    /// Como terminou uma conexão.
    private enum Outcome {
        case unauthorized
        case opened
        case failed
    }

    /// O laço de conexões, fora do ator: só toca no que recebe por parâmetro.
    private static func run(
        request: URLRequest, session: URLSession, backoff: BackoffSchedule,
        continuation: AsyncStream<EventStreamOutput>.Continuation
    ) async {
        var attempt = 0
        while !Task.isCancelled {
            switch await connect(request: request, session: session, continuation: continuation) {
            case .unauthorized:
                if !Task.isCancelled {
                    continuation.yield(.unauthorized)
                }
                return
            case .opened:
                attempt = 0
            case .failed:
                break
            }
            if Task.isCancelled { return }
            try? await Task.sleep(for: backoff.delay(attempt: attempt))
            attempt += 1
        }
    }

    /// Uma conexão: lê até o motor fechar, a conexão cair ou a tarefa ser cancelada.
    private static func connect(
        request: URLRequest, session: URLSession,
        continuation: AsyncStream<EventStreamOutput>.Continuation
    ) async -> Outcome {
        guard let (bytes, response) = try? await session.bytes(for: request) else { return .failed }
        switch (response as? HTTPURLResponse)?.statusCode {
        case 200: break
        case 401: return .unauthorized
        default: return .failed
        }
        var parser = SSEParser()
        var line = Data()
        do {
            for try await byte in bytes {
                line.append(byte)
                guard byte == 0x0A else { continue }
                for message in parser.feed(line) {
                    guard !Task.isCancelled, let output = output(name: message.name, data: message.data)
                    else { continue }
                    continuation.yield(output)
                }
                line.removeAll(keepingCapacity: true)
            }
        } catch {
            // Queda no meio do fluxo: a conexão chegou a abrir, então o recuo recomeça.
        }
        return .opened
    }

    /// O evento que a casca recebe, ou `nil` para descartar. `state`, `state-patch` e `ping`
    /// saem antes de qualquer decodificação (o `state` é o retrato inteiro da UI).
    static func output(name: String, data: Data) -> EventStreamOutput? {
        if ["state", "state-patch", "ping"].contains(name) { return nil }
        switch ShellEvent.decode(name: name, data: data) {
        case .some(.other), .none: return nil
        case .some(let event): return .event(event)
        }
    }
}
