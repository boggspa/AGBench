import Foundation
import OSAKit

/// Phase K4 — AppleScript dispatcher. Compiles and runs an AppleScript
/// source string with a timeout, returning the script's terminal value
/// as a JSON-friendly dict. Used by the `creative.runAppleScript`
/// JSON-RPC method to drive Final Cut Pro and Logic Pro via their
/// scripting dictionaries (FCP via System Events / GUI scripting,
/// Logic via its own dictionary which is somewhat anemic but
/// functional for transport/playhead/tempo).
///
/// Why OSAKit, not the `osascript` CLI:
/// - In-process scripting is faster (no subprocess fork per call) and
///   inherits the daemon's TCC grants — important because every
///   AppleScript invocation against another app triggers a TCC
///   prompt the FIRST time, and we want that prompt attributed to
///   TaskWraith, not to `osascript`.
/// - We get typed error objects (compile vs runtime vs permission).
/// - We can run with a timeout — the CLI doesn't have an in-process
///   stop mechanism, only an external `kill`.
///
/// Security: this runner IS NOT a generic script-runner. The MCP tool
/// `creative_applescript_dispatch` is responsible for gating each
/// invocation via the renderer-side approval modal AND keeping the
/// raw-script entry-point distinct from the named-class library so
/// the agent can't bypass class-cache approval by passing a custom
/// source. The Swift side just executes; the gating lives upstream.
enum CreativeAppleScriptRunner {
    /// Run `source` as AppleScript. Returns a JSON-friendly dict
    /// with `ok`, the result as a string (AppleScript's terminal
    /// value coerced to text), and timing info. Times out at
    /// `timeoutMs` (default 10s) — anything that takes longer than
    /// 10s of AppleScript is almost certainly stuck on a GUI prompt.
    static func runScript(source: String, timeoutMs: Int = 10_000) throws -> [String: Any] {
        guard !source.isEmpty else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "creative.runAppleScript: source must not be empty"
            )
        }
        let script = OSAScript(source: source, language: OSALanguage(forName: "AppleScript"))

        // Compile first so syntax errors surface separately from
        // execution errors.
        var compileError: NSDictionary?
        script.compileAndReturnError(&compileError)
        if let compileError {
            let message = compileError[NSAppleScript.errorMessage] as? String ?? "compile error"
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "creative.runAppleScript: AppleScript compile error: \(message)"
            )
        }

        // Run on a background queue so the timeout semaphore can fire.
        // OSAScript is documented as not thread-safe, so a fresh
        // instance per call (above) keeps us out of trouble.
        let started = Date()
        var runError: NSDictionary?
        let semaphore = DispatchSemaphore(value: 0)
        var executionResult: NSAppleEventDescriptor?
        DispatchQueue.global(qos: .userInitiated).async {
            executionResult = script.executeAndReturnError(&runError)
            semaphore.signal()
        }
        let waitResult = semaphore.wait(timeout: .now() + .milliseconds(timeoutMs))
        let durationMs = Int(Date().timeIntervalSince(started) * 1000)
        if waitResult == .timedOut {
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message:
                    "creative.runAppleScript: timed out after \(timeoutMs)ms (script likely stuck on a GUI prompt or modal)"
            )
        }
        if let runError {
            let message = runError[NSAppleScript.errorMessage] as? String ?? "runtime error"
            let number = runError[NSAppleScript.errorNumber] as? Int
            let detail = number.map { "(\($0)) \(message)" } ?? message
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: "creative.runAppleScript: AppleScript runtime error: \(detail)"
            )
        }
        // Coerce the result to a string for JSON-RPC. AppleScript can
        // return many types; for our scripted-control use case the
        // value is usually `missing value`, `true`, or a short string,
        // all of which stringValue handles cleanly.
        let resultString = executionResult?.stringValue ?? ""
        return [
            "ok": true,
            "result": resultString,
            "durationMs": durationMs
        ]
    }
}
