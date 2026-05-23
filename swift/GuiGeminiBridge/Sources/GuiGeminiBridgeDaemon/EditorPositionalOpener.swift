import Foundation
import AppKit

/// Phase L — positional file opens via an editor's CLI shim.
///
/// Some editors (VS Code, Cursor, Zed, Sublime, JetBrains, Xcode,
/// BBEdit, TextMate) expose a CLI that accepts a file argument with
/// line/column info. NSWorkspace.open() can't carry that — it just
/// opens the file — so for "go to line 42" handoffs we shell out to
/// the editor's binary instead.
///
/// The TS side computes the exact arg list per editor (the
/// EditorAdapters registry knows that VS Code wants `-g file:line:col`
/// while JetBrains wants `--line N --column M file`); this Swift
/// helper just resolves the binary on PATH and runs it.
enum EditorPositionalOpener {
    /// Run `cliCommand` with `args` and return after the process exits
    /// (or after `timeoutMs`, whichever comes first). Doesn't capture
    /// stdout/stderr — editor CLIs are intentionally quiet on success
    /// and we'd rather surface the exit code than guess.
    static func openAtPosition(
        cliCommand: String,
        args: [String],
        timeoutMs: Int = 5_000
    ) throws -> [String: Any] {
        guard !cliCommand.isEmpty else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "editor.openAtPosition: cliCommand must not be empty"
            )
        }
        // Resolve via /usr/bin/which because PATH at daemon-spawn time
        // includes /usr/local/bin and ~/Applications shims for the
        // common editor binaries. We deliberately do NOT fall back to
        // a hardcoded /Applications/<App>.app/Contents/Resources/bin
        // path — the user's `code` shim is the source of truth for
        // which VS Code variant they want, and second-guessing it
        // sends `cursor -g` calls into the wrong window.
        guard let resolvedPath = which(cliCommand) else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message:
                    "editor.openAtPosition: CLI shim '\(cliCommand)' not found on PATH. Install the editor's command-line tool (e.g. VS Code: Shell Command: Install 'code' in PATH)."
            )
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: resolvedPath)
        process.arguments = args
        // No pipes — editor CLIs background themselves; we just need
        // the exit code.
        let started = Date()
        try process.run()
        // Sleep-wait until exit or timeout.
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.02)
        }
        if process.isRunning {
            process.terminate()
            Thread.sleep(forTimeInterval: 0.1)
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: "editor.openAtPosition: CLI '\(cliCommand)' did not exit within \(timeoutMs)ms"
            )
        }
        process.waitUntilExit()
        let durationMs = Int(Date().timeIntervalSince(started) * 1000)
        return [
            "ok": process.terminationStatus == 0,
            "exitCode": Int(process.terminationStatus),
            "cliCommand": cliCommand,
            "resolvedPath": resolvedPath,
            "durationMs": durationMs
        ]
    }

    /// Look up `name` on PATH. Returns nil if not found. Wraps the
    /// `/usr/bin/which` binary because it transparently honours the
    /// daemon's effective PATH (whatever was set when the daemon was
    /// spawned from Electron) without us having to re-parse it.
    private static func which(_ name: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        process.arguments = [name]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        do {
            try process.run()
        } catch {
            return nil
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let path = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty else {
            return nil
        }
        return path
    }
}

/// Phase L — reveal a file in Finder. Wraps
/// `NSWorkspace.shared.selectFile(_:inFileViewerRootedAtPath:)`.
/// Trivial standalone helper; lives in this file for proximity to
/// the rest of the editor-transport surface.
enum FinderReveal {
    static func reveal(filePath: String) throws -> [String: Any] {
        guard !filePath.isEmpty else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "workspace.revealInFinder: filePath must not be empty"
            )
        }
        let url = URL(fileURLWithPath: filePath)
        // selectFile expects a string path (not a URL) and behaves
        // gracefully even when the parent dir doesn't exist — Finder
        // opens at the closest existing ancestor. We surface a clean
        // error when the file itself is missing because the agent's
        // intent was almost certainly to reveal a real file.
        if !FileManager.default.fileExists(atPath: url.path) {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "workspace.revealInFinder: file not found at \(filePath)"
            )
        }
        let revealed = NSWorkspace.shared.selectFile(url.path, inFileViewerRootedAtPath: "")
        return [
            "ok": revealed,
            "filePath": url.path
        ]
    }
}
