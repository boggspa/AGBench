import Foundation

/// Phase K5 — Blender Python dispatcher. Runs a Python script against
/// Blender's `--background --python` mode via Process(), capturing
/// stdout/stderr, with a default 30s timeout. Used by the
/// `creative.runBlenderPython` JSON-RPC method.
///
/// Why subprocess `Blender --background --python`:
/// - Blender exposes a `bpy` module that can manipulate scenes, render,
///   import/export every supported format, run modifiers, evaluate
///   geometry — basically the entire app, scriptable.
/// - `--background` runs Blender without UI (no window, no GPU
///   initialization), which is what we want for "agent does some
///   geometry work and writes a file". The interactive Blender stays
///   untouched; this is a separate process per invocation.
/// - The CLI's `--python` flag points to a script file (not source), so
///   we write the agent's script to a per-invocation tempdir + path
///   that file. Blender's cwd is set to the tempdir so any relative
///   path operations (image output, etc.) land there.
///
/// Sandbox properties:
/// - Per-invocation tempdir at `NSTemporaryDirectory()/taskwraith-blender-<uuid>/`.
/// - Blender's working directory is set to the tempdir.
/// - The agent's script lives at `<tempdir>/script.py`.
/// - Optional `inputBlendPath` is opened via Blender's positional arg
///   convention; agent supplies a separately-existing .blend file.
/// - 30s timeout (configurable). Past that we SIGTERM, then SIGKILL.
///
/// Security: this runner IS NOT a generic Python interpreter. The MCP
/// tool layer is responsible for gating each invocation via the
/// renderer approval modal AND keeping the raw-script entry-point
/// distinct from named classes so cached approvals can't bless
/// arbitrary Python source.
enum CreativeBlenderPythonRunner {
    /// Run `pythonSource` inside Blender's `--background --python` mode.
    /// Returns a dict with `ok`, `stdout`, `stderr`, `exitCode`,
    /// `tempDir` (so the renderer can surface any output files the
    /// agent wrote), and `durationMs`.
    static func runScript(
        pythonSource: String,
        inputBlendPath: String? = nil,
        timeoutMs: Int = 30_000
    ) throws -> [String: Any] {
        guard !pythonSource.isEmpty else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "creative.runBlenderPython: pythonSource must not be empty"
            )
        }

        // Resolve Blender binary. The .app bundle's MacOS executable
        // is the canonical entry. Could be sideloaded under
        // ~/Applications too; we check both.
        let candidates = [
            "/Applications/Blender.app/Contents/MacOS/Blender",
            (NSHomeDirectory() + "/Applications/Blender.app/Contents/MacOS/Blender")
        ]
        guard let blenderPath = candidates.first(where: { FileManager.default.fileExists(atPath: $0) }) else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "creative.runBlenderPython: Blender.app not found in /Applications or ~/Applications"
            )
        }

        // Per-invocation sandbox tempdir. UUID name to avoid collisions
        // when the agent dispatches multiple scripts in parallel.
        let tempDirName = "taskwraith-blender-\(UUID().uuidString)"
        let tempDirURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(tempDirName, isDirectory: true)
        try FileManager.default.createDirectory(at: tempDirURL, withIntermediateDirectories: true)

        let scriptURL = tempDirURL.appendingPathComponent("script.py")
        try pythonSource.write(to: scriptURL, atomically: true, encoding: .utf8)

        // Build the argument list. Blender accepts the input .blend as
        // a positional argument BEFORE the --python flag; if no input
        // is given, Blender starts on an empty scene.
        var arguments: [String] = ["--background"]
        if let inputBlendPath {
            if !FileManager.default.fileExists(atPath: inputBlendPath) {
                throw JSONRPCError(
                    code: JSONRPCErrorCode.invalidParams,
                    message: "creative.runBlenderPython: inputBlendPath not found at \(inputBlendPath)"
                )
            }
            arguments.append(inputBlendPath)
        }
        arguments.append(contentsOf: ["--python", scriptURL.path])

        let process = Process()
        process.executableURL = URL(fileURLWithPath: blenderPath)
        process.arguments = arguments
        process.currentDirectoryURL = tempDirURL

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        let started = Date()
        try process.run()

        // Read async on background queues so a chatty stderr can't
        // fill the pipe and block Blender mid-script.
        var stdoutData = Data()
        var stderrData = Data()
        let stdoutQueue = DispatchQueue(label: "taskwraith.blender.stdout")
        let stderrQueue = DispatchQueue(label: "taskwraith.blender.stderr")
        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            if !chunk.isEmpty {
                stdoutQueue.sync { stdoutData.append(chunk) }
            }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            if !chunk.isEmpty {
                stderrQueue.sync { stderrData.append(chunk) }
            }
        }

        // Timeout enforcement. Sleep-wait until the process exits OR
        // the timeout fires. Past the timeout, SIGTERM then SIGKILL.
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
        while process.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if process.isRunning {
            process.terminate()
            Thread.sleep(forTimeInterval: 0.2)
            if process.isRunning {
                kill(process.processIdentifier, SIGKILL)
            }
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: "creative.runBlenderPython: timed out after \(timeoutMs)ms"
            )
        }
        process.waitUntilExit()
        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil
        // Drain any trailing data.
        let trailingStdout = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let trailingStderr = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        if !trailingStdout.isEmpty { stdoutData.append(trailingStdout) }
        if !trailingStderr.isEmpty { stderrData.append(trailingStderr) }

        let durationMs = Int(Date().timeIntervalSince(started) * 1000)
        let stdoutString = String(data: stdoutData, encoding: .utf8) ?? ""
        let stderrString = String(data: stderrData, encoding: .utf8) ?? ""
        return [
            "ok": process.terminationStatus == 0,
            "exitCode": Int(process.terminationStatus),
            "stdout": stdoutString,
            "stderr": stderrString,
            "tempDir": tempDirURL.path,
            "durationMs": durationMs
        ]
    }
}
