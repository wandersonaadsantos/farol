import Foundation
import Testing

@testable import FarolSidecar

@Suite struct TokenStoreTests {
    @Test func defaultsPointAtTheFarolItem() {
        let store = TokenStore()
        #expect(store.service == "com.biud.farol")
        #expect(store.account == "local-auth-token")
    }

    /// Usa o Keychain de verdade, num serviço só deste teste; se o Keychain não estiver
    /// disponível, o `save` lança e o teste falha (nunca passa sem ter gravado).
    @Test func saveLoadOverwriteAndDelete() throws {
        let store = TokenStore(service: "com.biud.farol.tests.\(UUID().uuidString)")
        defer { store.delete() }

        #expect(store.load() == nil)
        try store.save("primeiro")
        #expect(store.load() == "primeiro")
        try store.save("segundo")
        #expect(store.load() == "segundo")
        store.delete()
        #expect(store.load() == nil)
        store.delete()
    }
}
