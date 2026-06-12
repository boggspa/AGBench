// TransportErrorCopy — the NSURLError → actionable-guidance mapper that
// replaces raw `String(describing:)` walls on the pairing screen. The -1004
// case mirrors the exact field failure: tailscale serve off on the Mac, so
// the phone's dial of wss://<name>.ts.net answered nothing.

import Foundation
import Testing

@testable import TaskWraithKit

@Suite("Transport error copy")
struct TransportErrorCopyTests {
    private func urlError(_ code: Int) -> NSError {
        NSError(
            domain: NSURLErrorDomain, code: code,
            userInfo: [NSLocalizedDescriptionKey: "Could not connect to the server."])
    }

    @Test("-1004 on a ts.net host names both ends of the Tailscale fix")
    func cannotConnectTailnet() {
        let message = TransportErrorCopy.friendlyMessage(
            for: urlError(NSURLErrorCannotConnectToHost),
            relayUrl: "wss://chriss-mac-studio.tail2d0961.ts.net")
        #expect(message.contains("chriss-mac-studio.tail2d0961.ts.net"))
        #expect(message.contains("Tailscale is ON"))
        #expect(message.contains("Remote access via Tailscale"))
        // The NSError UserInfo wall must be gone.
        #expect(!message.contains("NSErrorFailingURLKey"))
    }

    @Test("-1004 on a LAN host points at the Mac + same-network basics")
    func cannotConnectLan() {
        let message = TransportErrorCopy.friendlyMessage(
            for: urlError(NSURLErrorCannotConnectToHost),
            relayUrl: "ws://192.168.1.20:8787")
        #expect(message.contains("192.168.1.20"))
        #expect(message.contains("same network"))
    }

    @Test("-1003 on a ts.net host blames phone-side Tailscale DNS")
    func cannotFindTailnetHost() {
        let message = TransportErrorCopy.friendlyMessage(
            for: urlError(NSURLErrorCannotFindHost),
            relayUrl: "wss://chriss-mac-studio.tail2d0961.ts.net")
        #expect(message.contains("Turn Tailscale ON on this device"))
    }

    @Test("timeouts and TLS failures get their own guidance")
    func timeoutAndTls() {
        let timeout = TransportErrorCopy.friendlyMessage(
            for: urlError(NSURLErrorTimedOut),
            relayUrl: "wss://chriss-mac-studio.tail2d0961.ts.net")
        #expect(timeout.contains("timed out"))
        #expect(timeout.contains("Mac is awake"))

        let tls = TransportErrorCopy.friendlyMessage(
            for: urlError(NSURLErrorSecureConnectionFailed),
            relayUrl: "wss://chriss-mac-studio.tail2d0961.ts.net")
        #expect(tls.contains("certificate"))
    }

    @Test("non-URL errors fall back to their own description")
    func nonUrlErrorFallsThrough() {
        struct CustomError: LocalizedError {
            var errorDescription: String? { "Pairing code expired — refresh on the Mac." }
        }
        let message = TransportErrorCopy.friendlyMessage(
            for: CustomError(), relayUrl: "wss://chriss-mac-studio.tail2d0961.ts.net")
        #expect(message == "Pairing code expired — refresh on the Mac.")
    }

    @Test("unmapped NSURLError codes keep the system description, not the debug dump")
    func unmappedCodeUsesLocalizedDescription() {
        let message = TransportErrorCopy.friendlyMessage(
            for: urlError(NSURLErrorHTTPTooManyRedirects), relayUrl: nil)
        #expect(message == "Could not connect to the server.")
    }
}
