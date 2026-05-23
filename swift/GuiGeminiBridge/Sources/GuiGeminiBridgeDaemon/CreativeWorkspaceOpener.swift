import Foundation
import AppKit

/// Drives the `NSWorkspace.open(_:withApplicationAt:configuration:completionHandler:)`
/// transport for the creative-app integration. Used by Phase K3 to hand
/// a freshly-emitted `.fcpxml` to Final Cut Pro the same way a user-side
/// drag-drop or `open -a "Final Cut Pro" file.fcpxml` would.
///
/// Why NSWorkspace and not `Process()` + `open` CLI:
/// - NSWorkspace bypasses LSOpenURLs's launch-services strict-mode behaviour
///   that can surface as a confusing "permission" error from the CLI path
///   when the .app bundle isn't quarantined the way LS expects.
/// - It gives us a typed error when the bundle id isn't registered (vs the
///   CLI's silent fail + exit code 1).
/// - It honours per-app Launch Services preferences (default-handler-for-
///   extension), which the agent shouldn't accidentally bypass.
///
/// Security: this opener IS NOT a generic file-opener. The renderer-side
/// MCP tool is responsible for: (a) scoping the file path to the active
/// workspace tempdir, (b) gating the call behind user approval, (c)
/// validating the bundle id against the small set of declared creative
/// apps. The Swift side just executes the transport — it trusts the
/// caller's gating.
enum CreativeWorkspaceOpener {
    /// Open the file at `filePath` using the app registered with
    /// `bundleId`. Returns when the launch request has been delivered
    /// to Launch Services — does NOT wait for the app to actually open
    /// the file (FCP can take 5+ seconds to import a complex project,
    /// and the renderer doesn't need to block on that).
    static func openWithApp(filePath: String, bundleId: String) throws -> [String: Any] {
        let url = URL(fileURLWithPath: filePath)
        // FileManager.fileExists honours symlinks; we want the agent to
        // surface "file missing" before NSWorkspace's less-helpful
        // "launch failed" error.
        if !FileManager.default.fileExists(atPath: url.path) {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "creative.openWithApp: file not found at \(filePath)"
            )
        }
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "creative.openWithApp: no application registered with bundle id \(bundleId)"
            )
        }

        // `openOptions` newWindow:true keeps the import from clobbering
        // whatever the user has open in their existing FCP/Logic
        // window. Default activation policy is fine — bringing the
        // target app to the foreground is part of the workflow.
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.addsToRecentItems = true

        // Wrap the completion-handler NSWorkspace into a sync call. The
        // RPC layer is sync-per-line, and the launch dispatch itself is
        // fast (Launch Services returns once the app is told to open the
        // file — the actual import work happens in the target process).
        // 5s ceiling because Launch Services can hang on a bundle that's
        // mid-update or partially indexed.
        let semaphore = DispatchSemaphore(value: 0)
        var openError: Error?
        var launchedPID: Int32 = 0
        NSWorkspace.shared.open(
            [url],
            withApplicationAt: appURL,
            configuration: configuration
        ) { runningApp, error in
            if let error { openError = error }
            if let pid = runningApp?.processIdentifier { launchedPID = pid }
            semaphore.signal()
        }
        let waitResult = semaphore.wait(timeout: .now() + .seconds(5))
        if waitResult == .timedOut {
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: "creative.openWithApp: launch dispatch timed out after 5s"
            )
        }
        if let openError {
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: "creative.openWithApp: \(openError.localizedDescription)"
            )
        }
        return [
            "ok": true,
            "bundleId": bundleId,
            "appURL": appURL.path,
            "filePath": url.path,
            "pid": Int(launchedPID)
        ]
    }
}
