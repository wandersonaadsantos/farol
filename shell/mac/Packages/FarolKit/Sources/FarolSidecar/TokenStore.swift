import Foundation
import Security

/// Falha ao gravar o token no Keychain, com o `OSStatus` do Security.
public struct TokenStoreError: Error, Equatable, Sendable {
    public let status: OSStatus
}

/// O token da API local no Keychain (senha genérica), único lugar onde ele mora.
///
/// O pareamento acontece a cada subida do motor, e cada token novo sobrescreve o anterior.
public struct TokenStore: Sendable {
    public let service: String
    public let account: String

    public init(service: String = "com.biud.farol", account: String = "local-auth-token") {
        self.service = service
        self.account = account
    }

    /// O token guardado, ou `nil` quando não há item (ou o Keychain não responde).
    public func load() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Grava o token, atualizando o item quando ele já existe.
    public func save(_ token: String) throws {
        let data = Data(token.utf8)
        let update = SecItemUpdate(
            baseQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw TokenStoreError(status: update) }
        var item = baseQuery
        item[kSecValueData as String] = data
        let add = SecItemAdd(item as CFDictionary, nil)
        guard add == errSecSuccess else { throw TokenStoreError(status: add) }
    }

    /// Apaga o item; não haver item não é erro.
    public func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
