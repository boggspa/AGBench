import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

struct RunAnalystTimelineItem: Decodable {
    let kind: String
    let summary: String?
    let timestamp: String?
}

struct RunAnalystParams: Decodable {
    let runId: String
    let provider: String?
    let chatTitle: String?
    let status: String?
    let startedAt: String?
    let endedAt: String?
    let promptPreview: String?
    let workspacePath: String?
    let touchedFiles: [String]?
    let warnings: [String]?
    let countsByKind: [String: Int]?
    let timeline: [RunAnalystTimelineItem]?
}

enum RunAnalyst {
    static func analyze(_ params: Any) throws -> [String: Any] {
        let request: RunAnalystParams
        do {
            request = try decodeParams(params, as: RunAnalystParams.self)
        } catch {
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message: "Invalid run analyst params: \(error.localizedDescription)"
            )
        }

        guard !request.runId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw JSONRPCError(code: JSONRPCErrorCode.invalidParams, message: "runId is required.")
        }

        #if canImport(FoundationModels)
        if #available(macOS 26.0, *) {
            return try FoundationModelsRunAnalyst.analyze(request)
        }
        #endif

        throw JSONRPCError(
            code: JSONRPCErrorCode.bridgeUnavailable,
            message: "Apple Foundation Models are unavailable on this host or SDK."
        )
    }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
private struct FoundationAnalystSignal: Sendable {
    let label: String
    let value: String
    let tone: String
}

@available(macOS 26.0, *)
private struct FoundationAnalystOutput: Sendable {
    let status: String
    let model: String
    let summary: String
    let risks: [String]
    let nextSteps: [String]
    let signals: [FoundationAnalystSignal]

    func toJSONObject() -> [String: Any] {
        return [
            "status": status,
            "model": model,
            "summary": summary,
            "risks": risks,
            "nextSteps": nextSteps,
            "signals": signals.map { signal in
                [
                    "label": signal.label,
                    "value": signal.value,
                    "tone": signal.tone
                ]
            }
        ]
    }
}

@available(macOS 26.0, *)
private enum FoundationModelsRunAnalyst {
    static func analyze(_ request: RunAnalystParams) throws -> [String: Any] {
        let output = try runBlocking {
            try await analyzeAsync(request)
        }
        return output.toJSONObject()
    }

    private static func analyzeAsync(_ request: RunAnalystParams) async throws -> FoundationAnalystOutput {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.bridgeUnavailable,
                message: "Apple Foundation Models are not available: \(model.availability)"
            )
        }

        let session = LanguageModelSession(
            instructions: """
            You are TaskWraith's local run analyst. Analyze compact run telemetry.
            Return only terse JSON with keys: summary, risks, nextSteps, signals.
            risks and nextSteps are arrays of strings. signals is an array of
            {label, value, tone}; tone is neutral, good, warn, or bad.
            Do not suggest recursive agent runs or spawning new analysts.
            """
        )
        let prompt = buildPrompt(from: request)
        let response = try await session.respond(to: prompt)
        let text = String(describing: response.content)
        return parseAnalystJSON(text, fallbackRunId: request.runId)
    }

    private static func buildPrompt(from request: RunAnalystParams) -> String {
        let timeline = (request.timeline ?? [])
            .prefix(12)
            .map { item in
                let summary = item.summary?.replacingOccurrences(of: "\n", with: " ") ?? ""
                return "- \(item.kind): \(summary)"
            }
            .joined(separator: "\n")
        let files = (request.touchedFiles ?? []).prefix(12).joined(separator: ", ")
        let warnings = (request.warnings ?? []).prefix(8).joined(separator: " | ")
        let counts = (request.countsByKind ?? [:])
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: ", ")

        return """
        Run id: \(request.runId)
        Provider: \(request.provider ?? "unknown")
        Chat: \(request.chatTitle ?? "untitled")
        Status: \(request.status ?? "unknown")
        Started: \(request.startedAt ?? "unknown")
        Ended: \(request.endedAt ?? "unknown")
        Workspace: \(request.workspacePath ?? "unknown")
        Prompt: \(request.promptPreview ?? "")
        Event counts: \(counts)
        Files: \(files)
        Warnings: \(warnings)
        Timeline:
        \(timeline)
        """
    }

    private static func parseAnalystJSON(_ text: String, fallbackRunId: String) -> FoundationAnalystOutput {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = extractJSONObject(from: trimmed) ?? trimmed
        if let data = candidate.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data),
           let dict = object as? [String: Any] {
            return sanitizeResult(dict)
        }
        return FoundationAnalystOutput(
            status: "ready",
            model: "Apple Foundation Models",
            summary: trimmed.isEmpty ? "Foundation Models returned an empty analysis for \(fallbackRunId)." : trimmed,
            risks: [],
            nextSteps: [],
            signals: []
        )
    }

    private static func extractJSONObject(from text: String) -> String? {
        guard let start = text.firstIndex(of: "{"),
              let end = text.lastIndex(of: "}"),
              start <= end else {
            return nil
        }
        return String(text[start...end])
    }

    private static func sanitizeResult(_ dict: [String: Any]) -> FoundationAnalystOutput {
        return FoundationAnalystOutput(
            status: "ready",
            model: "Apple Foundation Models",
            summary: string(dict["summary"], fallback: "Foundation Models returned no summary."),
            risks: stringArray(dict["risks"], limit: 6),
            nextSteps: stringArray(dict["nextSteps"], limit: 6),
            signals: signalArray(dict["signals"], limit: 8)
        )
    }

    private static func string(_ value: Any?, fallback: String = "") -> String {
        guard let text = value as? String else { return fallback }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func stringArray(_ value: Any?, limit: Int) -> [String] {
        guard let array = value as? [Any] else { return [] }
        return array.prefix(limit).compactMap { item in
            string(item).isEmpty ? nil : string(item)
        }
    }

    private static func signalArray(_ value: Any?, limit: Int) -> [FoundationAnalystSignal] {
        guard let array = value as? [Any] else { return [] }
        let allowedTones: Set<String> = ["neutral", "good", "warn", "bad"]
        return array.prefix(limit).compactMap { item in
            guard let dict = item as? [String: Any] else { return nil }
            let label = string(dict["label"], fallback: "Signal")
            let value = string(dict["value"])
            if value.isEmpty { return nil }
            let tone = string(dict["tone"], fallback: "neutral")
            return FoundationAnalystSignal(
                label: label,
                value: value,
                tone: allowedTones.contains(tone) ? tone : "neutral"
            )
        }
    }
}
#endif
