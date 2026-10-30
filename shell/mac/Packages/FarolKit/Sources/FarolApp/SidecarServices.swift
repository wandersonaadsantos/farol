import FarolContrato
import FarolSidecar
import Foundation

/// O processo do motor visto pelo supervisor (o `EngineProcess`, ou um falso nos testes).
public protocol EngineControl: Sendable {
    /// Os códigos de saída do motor; o fim pedido pelo próprio `stop()` não aparece.
    var exitCodes: AsyncStream<Int32> { get }
    func start() async throws
    func stop() async
}

extension EngineProcess: EngineControl {}

/// O fluxo de eventos do motor visto pelo supervisor (o `EventStream`, ou um falso).
public protocol EventSource: Sendable {
    var events: AsyncStream<EventStreamOutput> { get }
    func start() async
    func stop() async
}

extension EventStream: EventSource {}

/// O que o supervisor pede à interface nativa (janela, bandeja, Dock, avisos).
@MainActor
public protocol ShellUI: AnyObject {
    /// Abre (ou refaz) a janela da `ui/` na porta, com o token injetado quando houver.
    func openWindow(port: Int, token: String?, viewer: Bool)
    /// O aviso único de que outro Farol já roda nesta porta.
    func showViewerNotice()
    /// O alerta de falha com "Tentar de novo" (que chama `SidecarSupervisor.retry()`).
    func showFailure(_ message: String)
    /// O retrato do evento `casca`: cores, selo do Dock e dica da bandeja.
    func apply(_ state: ShellState)
    /// Abrir junto com o sistema; chamado só quando o pedido do motor muda.
    func applyAutostart(_ wanted: Bool)
    /// Um aviso nativo.
    func post(_ notice: NativeNotice)
}

/// As fronteiras de entrada e saída do supervisor, trocadas por falsos nos testes.
public struct SidecarServices: Sendable {
    public var engine: any EngineControl
    /// O `casca.json` agora, ou `nil`.
    public var readEngineFile: @Sendable () -> EngineFile?
    /// Apaga o `casca.json` que sobrou de um motor morto, antes de subir outro.
    public var removeEngineFile: @Sendable () -> Void
    /// Espera o motor publicar o `casca.json` desta subida (a marca recusa o de antes); lança
    /// no prazo estourado.
    public var waitForEngineFile: @Sendable (SpawnMark) async throws -> EngineFile
    /// O processo `pid` existe (`kill(pid, 0)`).
    public var isProcessAlive: @Sendable (Int32) -> Bool
    /// Quem escuta na porta responde como Farol (`GET /api/auth/status`).
    public var isFarol: @Sendable (Int) async -> Bool
    /// Troca o código por token: `(porta, código)`.
    public var pair: @Sendable (Int, String) async throws -> String
    public var saveToken: @Sendable (String) throws -> Void
    /// O token guardado no Keychain, usado pelo visor (o motor não é nosso e não há código).
    public var loadToken: @Sendable () -> String?
    /// Um fluxo de eventos novo para `(porta, token)`.
    public var makeEventSource: @Sendable (Int, String) -> any EventSource
    /// O "Checar agora": `(porta, token)`.
    public var checkNow: @Sendable (Int, String) async throws -> Void
    /// Consome o marcador de reabertura silenciosa e devolve a versão nova.
    public var consumeSilentReopen: @Sendable () -> String?
    public var sleep: @Sendable (Double) async throws -> Void
    /// Quanto tempo, em segundos, o motor fica de pé depois do `casca.json` até as falhas
    /// seguidas zerarem (`.stable`).
    public var stabilityWindow: Double
    /// O intervalo, em segundos, entre as sondas de um motor cujo pid está vivo no boot.
    public var probeRetryInterval: Double

    /// A janela de estabilidade do app: um minuto de pé sem sair.
    public static let defaultStabilityWindow: Double = 60
    /// O intervalo entre as sondas do boot no app.
    public static let defaultProbeRetryInterval: Double = 2

    public init(
        engine: any EngineControl,
        readEngineFile: @escaping @Sendable () -> EngineFile?,
        removeEngineFile: @escaping @Sendable () -> Void,
        waitForEngineFile: @escaping @Sendable (SpawnMark) async throws -> EngineFile,
        isProcessAlive: @escaping @Sendable (Int32) -> Bool,
        isFarol: @escaping @Sendable (Int) async -> Bool,
        pair: @escaping @Sendable (Int, String) async throws -> String,
        saveToken: @escaping @Sendable (String) throws -> Void,
        loadToken: @escaping @Sendable () -> String?,
        makeEventSource: @escaping @Sendable (Int, String) -> any EventSource,
        checkNow: @escaping @Sendable (Int, String) async throws -> Void,
        consumeSilentReopen: @escaping @Sendable () -> String?,
        sleep: @escaping @Sendable (Double) async throws -> Void,
        stabilityWindow: Double = SidecarServices.defaultStabilityWindow,
        probeRetryInterval: Double = SidecarServices.defaultProbeRetryInterval
    ) {
        self.engine = engine
        self.readEngineFile = readEngineFile
        self.removeEngineFile = removeEngineFile
        self.waitForEngineFile = waitForEngineFile
        self.isProcessAlive = isProcessAlive
        self.isFarol = isFarol
        self.pair = pair
        self.saveToken = saveToken
        self.loadToken = loadToken
        self.makeEventSource = makeEventSource
        self.checkNow = checkNow
        self.consumeSilentReopen = consumeSilentReopen
        self.sleep = sleep
        self.stabilityWindow = stabilityWindow
        self.probeRetryInterval = probeRetryInterval
    }

    /// As peças de verdade: `EngineProcess` do `EngineLocator`, `casca.json` e marcador nos
    /// caminhos de `paths`, token no Keychain e o `EventStream`.
    public static func live(
        paths: ShellPaths, environment: [String: String], shellVersion: String
    ) -> SidecarServices {
        let located = EngineLocator.resolve(environment: environment)
        let engine = EngineProcess(
            node: located.node, serverJS: located.serverJS, home: paths.explicitHome,
            shellVersion: shellVersion)
        let fileURL = paths.engineFile
        let stateDir = paths.workspaceState
        return SidecarServices(
            engine: engine,
            readEngineFile: { try? EngineFile.read(at: fileURL) },
            removeEngineFile: { try? FileManager.default.removeItem(at: fileURL) },
            waitForEngineFile: { try await FarolSidecar.waitForEngineFile(at: fileURL, accepting: $0) },
            isProcessAlive: { EngineProbe.isProcessAlive(pid: $0) },
            isFarol: { await EngineProbe.isFarol(port: $0) },
            pair: { try await Pairing.pair(port: $0, code: $1) },
            saveToken: { try TokenStore().save($0) },
            loadToken: { TokenStore().load() },
            makeEventSource: { EventStream(port: $0, token: $1) },
            checkNow: { try await EngineCommands(port: $0, token: $1).checkNow() },
            consumeSilentReopen: { SilentReopen.consume(stateDir: stateDir) },
            sleep: { try await Task.sleep(for: .seconds($0)) }
        )
    }
}
