import Foundation
import BridgeCore

public extension BridgeActionAck {
    var structuredAppRunId: String? {
        if let value = normalizedNonEmpty(appRunId) {
            return value
        }
        for key in ["appRunId", "appRunID", "runId", "runID"] {
            if let value = data?[key]?.stringValueForGuiGemini,
               let normalized = normalizedNonEmpty(value) {
                return normalized
            }
        }
        return nil
    }
}

private extension BridgeJSONValue {
    var stringValueForGuiGemini: String? {
        switch self {
        case .string(let value):
            return value
        case .number(let value):
            if value.rounded() == value {
                return String(Int(value))
            }
            return String(value)
        case .bool(let value):
            return value ? "true" : "false"
        case .null, .array, .object:
            return nil
        }
    }
}

private func normalizedNonEmpty(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}
