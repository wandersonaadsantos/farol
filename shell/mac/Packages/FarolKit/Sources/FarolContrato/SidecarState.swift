/// Em que ponto a casca está com o motor sidecar.
public enum SidecarPhase: Equatable, Sendable {
    /// Antes do `.boot`.
    case starting
    /// O motor foi lançado e a casca espera o `casca.json` aparecer.
    case waitingForFile
    /// A casca está trocando o código de pareamento por um token.
    case pairing
    /// A janela está aberta sobre o motor que a casca lançou.
    case ready(port: Int)
    /// A janela está aberta sobre um motor que a casca NÃO lançou (outro Farol na porta).
    case viewer(port: Int)
    /// O motor saiu e a casca vai religá-lo depois de `in` segundos.
    case restarting(in: Double)
    /// A casca desistiu de religar sozinha; só `.restartNow` (o "Tentar de novo") religa.
    case stopped(reason: String)
}

/// O que acontece com o motor, entregue à máquina pela camada do app.
public enum SidecarInput: Equatable, Sendable {
    /// A casca abriu: `existingEngine` é o `casca.json` encontrado, e `engineAlive` diz se o
    /// processo dele está vivo.
    case boot(existingEngine: EngineFile?, engineAlive: Bool)
    /// O `casca.json` do motor lançado apareceu.
    case fileAppeared(EngineFile)
    /// O pareamento deu certo e o token foi guardado.
    case paired
    /// O pareamento falhou.
    case pairFailed
    /// O motor lançado pela casca saiu com `code`.
    case exited(code: Int32)
    /// O SSE respondeu 401.
    case unauthorized
    /// O motor lançado ficou de pé pela janela de estabilidade inteira depois de publicar o
    /// `casca.json` (o supervisor entrega esta entrada; a máquina não mede tempo).
    case stable
    /// O timer de religar disparou, ou a pessoa pediu "Tentar de novo".
    case restartNow
}

/// O que a camada do app precisa executar.
public enum SidecarEffect: Equatable, Sendable {
    /// Parar o motor que a casca lançou; a parada pedida não volta como `.exited` e não
    /// conta falha. O `.spawn` seguinte só sobe o motor novo depois de a parada terminar.
    case stopEngine
    /// Lançar o processo do motor.
    case spawn
    /// Esperar o `casca.json` aparecer.
    case waitFile
    /// Trocar `code` por um token em `POST /api/auth/pair` na porta `port`.
    case pair(code: String, port: Int)
    /// Mostrar a janela da `ui/` na porta `port`; `viewer` diz que o motor não é nosso.
    case openWindow(port: Int, viewer: Bool)
    /// Avisar, uma vez, que outro Farol já roda nesta porta e esta janela só mostra.
    case showViewerNotice
    /// Agendar o religar para daqui a `after` segundos (o timer entrega `.restartNow`).
    case restart(after: Double)
    /// Mostrar o alerta nativo de falha com o botão "Tentar de novo".
    case showFailure(String)
}

/// A máquina de estados do sidecar, PURA: recebe o que aconteceu e devolve o que fazer.
///
/// A máquina é total: toda entrada em toda fase devolve uma lista de efeitos, e entrada que
/// não faz sentido na fase atual (um `.paired` fora do pareamento, um `.boot` repetido, um
/// `.fileAppeared` sem motor lançado) é ignorada com `[]`, sem mudar nada.
///
/// Regras que não saem do nome dos casos:
/// - `.exited` em `.viewer` é ignorado: o processo não é nosso, quem o vigia é quem o lançou.
///   Também é ignorado em `.restarting` e `.stopped`, onde não há processo nosso vivo.
/// - `.exited` com falha (código que não é `75` nem `0`) soma uma falha seguida antes de
///   consultar a `RestartPolicy`; `75` e `0` não somam.
/// - `.fileAppeared` NÃO zera as falhas seguidas: o motor que publica o arquivo e cai logo
///   depois continua contando para a desistência. Quem zera é o `.stable`, que o supervisor
///   entrega depois da janela de estabilidade (60 s) sem saída do motor.
/// - `.unauthorized` em `.ready` para e relança o NOSSO motor, sem contar falha: o código
///   de pareamento do `casca.json` atual já foi gasto (é de uso único), e só um motor novo
///   publica um código válido. Da segunda vez seguida (sem `.stable` nem saída do motor
///   entre elas) só reabre a janela sem token, e a `ui/` mostra o próprio painel de
///   pareamento. Em `.viewer` o motor não é nosso: o 401 reabre a janela de visor sem
///   token, sempre. Nas outras fases é ignorado.
public struct SidecarMachine: Sendable {
    public private(set) var phase: SidecarPhase = .starting
    public private(set) var consecutiveFailures = 0

    private let policy: RestartPolicy
    /// Porta do motor que a casca lançou, conhecida desde o último `.fileAppeared`.
    private var enginePort: Int?
    /// Se um `.unauthorized` já relançou o motor sem que um `.stable` ou uma saída do motor
    /// viessem depois.
    private var restartedForAuth = false

    public init(policy: RestartPolicy = RestartPolicy()) {
        self.policy = policy
    }

    /// Aplica `input` e devolve os efeitos a executar, na ordem.
    public mutating func on(_ input: SidecarInput) -> [SidecarEffect] {
        switch (phase, input) {
        case (.starting, .boot(let file?, true)):
            phase = .viewer(port: file.port)
            return [.openWindow(port: file.port, viewer: true), .showViewerNotice]
        case (.starting, .boot):
            return spawn()
        case (.waitingForFile, .fileAppeared(let file)):
            enginePort = file.port
            phase = .pairing
            return [.pair(code: file.pairingCode, port: file.port)]
        case (.pairing, .paired), (.pairing, .pairFailed):
            guard let port = enginePort else { return [] }
            phase = .ready(port: port)
            return [.openWindow(port: port, viewer: false)]
        case (.ready(let port), .unauthorized):
            guard !restartedForAuth else { return [.openWindow(port: port, viewer: false)] }
            restartedForAuth = true
            return [.stopEngine] + spawn()
        case (.viewer(let port), .unauthorized):
            return [.openWindow(port: port, viewer: true)]
        case (.pairing, .stable), (.ready, .stable):
            consecutiveFailures = 0
            restartedForAuth = false
            return []
        case (.waitingForFile, .exited(let code)), (.pairing, .exited(let code)),
            (.ready, .exited(let code)):
            return exited(code: code)
        case (.restarting, .restartNow), (.stopped, .restartNow):
            return spawn()
        default:
            return []
        }
    }

    private mutating func spawn() -> [SidecarEffect] {
        phase = .waitingForFile
        return [.spawn, .waitFile]
    }

    private mutating func exited(code: Int32) -> [SidecarEffect] {
        restartedForAuth = false
        if code != RestartPolicy.intentionalExit && code != 0 {
            consecutiveFailures += 1
        }
        switch policy.delay(afterExit: code, consecutiveFailures: consecutiveFailures) {
        case .immediately:
            phase = .restarting(in: 0)
            return [.restart(after: 0)]
        case .after(let seconds):
            phase = .restarting(in: seconds)
            return [.restart(after: seconds)]
        case .stop(let reason):
            phase = .stopped(reason: reason)
            return [.showFailure(reason)]
        }
    }
}
