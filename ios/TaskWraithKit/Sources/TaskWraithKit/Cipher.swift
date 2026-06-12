// taskwraith-e2ee-v1 — AES-256-GCM seal/open (Swift port of
// src/shared/e2ee/cipher.ts). 12-byte nonce = 4B BE direction prefix ‖ 8B BE
// seq; AAD = "sessionId:seq". CryptoKit's default GCM tag is 128-bit, matching
// Node's getAuthTag().

import Foundation
import CryptoKit

public struct SealedFrame: Sendable {
    public var nonce: Data
    public var ct: Data
    public var tag: Data
}

public enum TWCipher {
    public enum CipherError: Error { case nonceMismatch, badTagLength, openFailed }

    public static func buildNonce(_ direction: Direction, _ seq: Int) -> Data {
        var nonce = Data(count: 12)
        let prefix = direction.noncePrefix.bigEndian
        withUnsafeBytes(of: prefix) { nonce.replaceSubrange(0..<4, with: $0) }
        let seqBE = UInt64(seq).bigEndian
        withUnsafeBytes(of: seqBE) { nonce.replaceSubrange(4..<12, with: $0) }
        return nonce
    }

    public static func buildAad(_ sessionId: String, _ seq: Int) -> Data {
        Data("\(sessionId):\(seq)".utf8)
    }

    public static func seal(
        key: SymmetricKey, direction: Direction, sessionId: String, seq: Int, plaintext: Data
    ) throws -> SealedFrame {
        let nonce = buildNonce(direction, seq)
        let sealedBox = try AES.GCM.seal(
            plaintext, using: key, nonce: AES.GCM.Nonce(data: nonce),
            authenticating: buildAad(sessionId, seq))
        return SealedFrame(nonce: nonce, ct: sealedBox.ciphertext, tag: sealedBox.tag)
    }

    public static func open(
        key: SymmetricKey, direction: Direction, sessionId: String, seq: Int, frame: SealedFrame
    ) throws -> Data {
        let expected = buildNonce(direction, seq)
        guard frame.nonce == expected else { throw CipherError.nonceMismatch }
        guard frame.tag.count == 16 else { throw CipherError.badTagLength }
        let box = try AES.GCM.SealedBox(
            nonce: AES.GCM.Nonce(data: expected), ciphertext: frame.ct, tag: frame.tag)
        return try AES.GCM.open(box, using: key, authenticating: buildAad(sessionId, seq))
    }
}
