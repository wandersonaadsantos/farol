import Foundation

/// O que a migração encontrou no disco, deixado pelo Farol da era Electron.
public struct LegacySnapshot: Equatable, Sendable {
    /// O LaunchAgent do `lib/autostart-mac.js` existe.
    public let launchAgentExists: Bool
    /// O `~/Applications/Farol.app` tem o marcador do lançador do Electron.
    public let launcherHasMarker: Bool
    /// O `~/Applications/Farol.app` é o próprio app que está rodando.
    public let launcherIsRunningApp: Bool

    public init(launchAgentExists: Bool, launcherHasMarker: Bool, launcherIsRunningApp: Bool) {
        self.launchAgentExists = launchAgentExists
        self.launcherHasMarker = launcherHasMarker
        self.launcherIsRunningApp = launcherIsRunningApp
    }
}

/// Um item a apagar.
public enum LegacyAction: Equatable, Sendable {
    /// Descarregar e apagar o LaunchAgent.
    case removeLaunchAgent
    /// Apagar a pasta inteira do lançador do Electron.
    case removeElectronLauncher
}

/// A regra da primeira abertura da casca nativa: o que o Farol Electron deixou e pode sair.
///
/// Só dois caminhos existem para esta regra: o LaunchAgent e o lançador. O `~/.farol` nunca
/// entra (a preferência de abrir junto com o sistema mora na `config.json` dele, e o evento
/// `casca` do motor a devolve à casca nova).
public enum LegacyCleanup {
    /// O `ROTULO` de `lib/autostart-mac.js`.
    public static let launchAgentLabel = "com.biud.farol.autostart"

    /// `<home>/Library/LaunchAgents/com.biud.farol.autostart.plist`.
    public static func launchAgent(home: URL) -> URL {
        home.appendingPathComponent("Library/LaunchAgents/\(launchAgentLabel).plist")
    }

    /// `<home>/Applications/Farol.app`, onde o `installer/native-bundle-mac.sh` monta o lançador.
    public static func electronLauncher(home: URL) -> URL {
        home.appendingPathComponent("Applications/Farol.app", isDirectory: true)
    }

    /// O arquivo que só o lançador do Electron tem; sem ele o `Farol.app` não é tocado (pode ser
    /// a casca nova instalada em `~/Applications`).
    public static func launcherMarker(home: URL) -> URL {
        electronLauncher(home: home).appendingPathComponent("Contents/Resources/app/bootstrap.cjs")
    }

    /// O que apagar, na ordem: o LaunchAgent antes, para o launchd não abrir o lançador de novo.
    public static func plan(_ snapshot: LegacySnapshot) -> [LegacyAction] {
        var actions: [LegacyAction] = []
        if snapshot.launchAgentExists { actions.append(.removeLaunchAgent) }
        if snapshot.launcherHasMarker && !snapshot.launcherIsRunningApp {
            actions.append(.removeElectronLauncher)
        }
        return actions
    }
}
