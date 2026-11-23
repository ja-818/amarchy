// A notification's payload, read as RFC 8291 says (Web Push's aes128gcm, as
// bin/amarchy's push_encrypt writes it): only this phone's private key and
// auth secret open it. phone/README.md, "Notifications", step 2.

import CryptoKit
import Foundation
import Security

enum PushCrypto {
    enum Failure: Error, Equatable {
        case short, header, recordSize, key, open, padding
    }

    /// The plaintext of one aes128gcm record: salt (16), record size (4), key
    /// id length (1, = 65), the server's one-time key (65), then the
    /// ciphertext with its 16-byte tag.
    static func decrypt(_ record: Data, keys: PushKeys) throws -> Data {
        let r = [UInt8](record)
        guard r.count >= 86 + 17 else { throw Failure.short }
        let salt = Data(r[0..<16])
        let rs = r[16..<20].reduce(0) { $0 << 8 | Int($1) }
        guard r[20] == 65 else { throw Failure.header }
        // One record: its ciphertext fits its record size.
        guard rs >= 18, r.count - 86 <= rs else { throw Failure.recordSize }
        let serverKey = Data(r[21..<86])
        let ciphertext = Data(r[86..<(r.count - 16)]), tag = Data(r[(r.count - 16)...])

        let server: P256.KeyAgreement.PublicKey
        let secret: SharedSecret
        do {
            server = try P256.KeyAgreement.PublicKey(x963Representation: serverKey)
            secret = try keys.privateKey.sharedSecretFromKeyAgreement(with: server)
        } catch {
            throw Failure.key
        }
        let ecdh = secret.withUnsafeBytes { Data($0) }
        let uaPublic = keys.privateKey.publicKey.x963Representation
        let ikm = hkdf(salt: keys.auth, ikm: ecdh, info: Data("WebPush: info\0".utf8) + uaPublic + serverKey, length: 32)
        let cek = hkdf(salt: salt, ikm: ikm, info: Data("Content-Encoding: aes128gcm\0".utf8), length: 16)
        let nonce = hkdf(salt: salt, ikm: ikm, info: Data("Content-Encoding: nonce\0".utf8), length: 12)

        var plain: [UInt8]
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: ciphertext, tag: tag)
            plain = [UInt8](try AES.GCM.open(box, using: SymmetricKey(data: cek)))
        } catch {
            throw Failure.open
        }
        // The padding: zeros after the delimiter, 0x02 for the last (only) record.
        while plain.last == 0 { plain.removeLast() }
        guard plain.last == 2 else { throw Failure.padding }
        plain.removeLast()
        return Data(plain)
    }

    /// HKDF-SHA256 for at most one block (RFC 5869), as RFC 8291 uses it.
    static func hkdf(salt: Data, ikm: Data, info: Data, length: Int) -> Data {
        let prk = HMAC<SHA256>.authenticationCode(for: ikm, using: SymmetricKey(data: salt))
        let okm = HMAC<SHA256>.authenticationCode(for: info + Data([1]), using: SymmetricKey(data: Data(prk)))
        return Data(okm).prefix(length)
    }
}

/// The phone's push keys: a P-256 key pair and a 16-byte auth secret, made
/// once on the phone and never sent anywhere but their public half (in the
/// subscription the machine keeps).
struct PushKeys {
    let privateKey: P256.KeyAgreement.PrivateKey
    let auth: Data

    /// The public key's 65 uncompressed bytes, base64url (a subscription's `p256dh`).
    var p256dh: String { privateKey.publicKey.x963Representation.base64URL }
    var authText: String { auth.base64URL }

    init(privateKey: P256.KeyAgreement.PrivateKey, auth: Data) {
        self.privateKey = privateKey
        self.auth = auth
    }

    /// The test vectors' form: the raw 32-byte scalar, and the auth secret.
    init(raw: Data, auth: Data) throws {
        privateKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: raw)
        self.auth = auth
    }

    static func make() -> PushKeys {
        let auth = SymmetricKey(size: .bits128).withUnsafeBytes { Data($0) }
        return PushKeys(privateKey: P256.KeyAgreement.PrivateKey(), auth: auth)
    }

    /// Kept as 48 bytes: the scalar (32), then the auth secret (16).
    var stored: Data { privateKey.rawRepresentation + auth }

    init?(stored: Data) {
        guard stored.count == 48, let key = try? P256.KeyAgreement.PrivateKey(rawRepresentation: stored.prefix(32))
        else { return nil }
        self.init(privateKey: key, auth: Data(stored.suffix(16)))
    }
}

/// Where the keys are kept: the Keychain, in the group the notification
/// extension shares, readable after the phone's first unlock (a notification
/// arrives on a locked phone).
enum KeyStore {
    static let service = "io.github.ja818.amarchy.push"
    static let account = "keys"

    struct Failure: LocalizedError {
        let status: OSStatus
        var errorDescription: String? { "Couldn't keep the notification keys on this phone (Keychain error \(status))" }
    }

    static func load() -> PushKeys? {
        for group in groups {
            var query = base(group)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: CFTypeRef?
            if SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
               let keys = PushKeys(stored: data) {
                return keys
            }
        }
        return nil
    }

    /// The kept keys, else new ones, kept.
    static func loadOrMake() throws -> PushKeys {
        if let keys = load() { return keys }
        let keys = PushKeys.make()
        var last: OSStatus = errSecSuccess
        for group in groups {
            var item = base(group)
            item[kSecValueData as String] = keys.stored
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            last = SecItemAdd(item as CFDictionary, nil)
            if last == errSecSuccess { return keys }
            if last == errSecDuplicateItem, let kept = load() { return kept }
            // Not entitled to the shared group (a build that isn't signed): the app's own.
            if last != errSecMissingEntitlement { break }
        }
        throw Failure(status: last)
    }

    static func delete() {
        for group in groups { SecItemDelete(base(group) as CFDictionary) }
    }

    private static var groups: [String?] {
        Amarchy.keychainGroup.map { [$0, nil] } ?? [nil]
    }

    private static func base(_ group: String?) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account,
                                kSecAttrSynchronizable as String: false]
        if let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }
}
