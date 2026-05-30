import Foundation
import BridgeCore

enum BridgeAckDecoding {
    static let knownElectronActionAckFields: Set<String> = [
        "accepted", "schemaVersion", "directJournalRecordName", "actionID",
        "actionId", "state", "deliveredAt", "executed", "reasonCode",
        "reason", "message", "error", "actionKind", "workspaceId",
        "threadId", "runId", "appRunId", "messageId", "approvalId",
        "questionId", "pairId", "correlationId", "scope", "data"
    ]

    static func actionAck(
        from resultData: Data,
        payloadData: Data? = nil,
        pairID: String? = nil,
        receivedAt: Date = Date()
    ) throws -> BridgeActionAck {
        let obj = try decodeObject(resultData)
        guard let accepted = boolValue(obj["accepted"]) else {
            throw AckDecodeError.missingAccepted
        }

        let dataObj = obj["data"] as? [String: Any]
        let message = stringValue(obj["message"])
            ?? stringValue(obj["reason"])
            ?? (accepted ? "Accepted" : "Rejected")
        let deliveredAt = dateValue(obj["deliveredAt"]) ?? receivedAt
        let actionID = firstString(
            obj["actionID"],
            obj["actionId"],
            dataObj?["actionID"],
            dataObj?["actionId"]
        ).map { ActionID($0) } ?? payloadData.flatMap(actionIDFromPayload)
        let state = firstString(
            obj["state"],
            dataObj?["state"]
        ).map { RemoteActionState($0) } ?? derivedActionState(accepted: accepted, executed: boolValue(obj["executed"]))
        let directJournalRecordName = firstString(
            obj["directJournalRecordName"],
            dataObj?["directJournalRecordName"]
        )
        let data = dataObj?.compactMapValues(bridgeJSONValue)
        let error = errorReport(
            from: obj["error"] as? [String: Any],
            fallbackAccepted: accepted,
            fallbackMessage: message,
            occurredAt: deliveredAt
        )

        return BridgeActionAck(
            schemaVersion: intValue(obj["schemaVersion"]) ?? 1,
            directJournalRecordName: directJournalRecordName,
            actionID: actionID,
            state: state,
            deliveredAt: deliveredAt,
            accepted: accepted,
            executed: boolValue(obj["executed"]),
            reasonCode: stringValue(obj["reasonCode"]),
            message: message,
            error: error,
            actionKind: firstString(obj["actionKind"], dataObj?["actionKind"]),
            workspaceId: firstString(obj["workspaceId"], dataObj?["workspaceId"]),
            threadId: firstString(obj["threadId"], dataObj?["threadId"]),
            runId: firstString(obj["runId"], dataObj?["runId"]),
            appRunId: firstString(obj["appRunId"], dataObj?["appRunId"]),
            messageId: firstString(obj["messageId"], dataObj?["messageId"]),
            approvalId: firstString(obj["approvalId"], dataObj?["approvalId"], dataObj?["toolCallId"]),
            questionId: firstString(obj["questionId"], dataObj?["questionId"], dataObj?["promptId"]),
            pairId: stringValue(obj["pairId"]) ?? pairID,
            correlationId: firstString(obj["correlationId"], dataObj?["correlationId"]),
            scope: stringValue(obj["scope"]),
            data: data
        )
    }

    static func prepareStartTurnAck(
        from resultData: Data,
        request: BridgePrepareStartTurnRequest,
        receivedAt: Date = Date()
    ) throws -> BridgePrepareStartTurnAck {
        let obj = try decodeObject(resultData)
        guard let accepted = boolValue(obj["accepted"]) else {
            throw AckDecodeError.missingAccepted
        }

        let message = stringValue(obj["message"])
        let readyAt = dateValue(obj["readyAt"]) ?? receivedAt
        let expiresAt = dateValue(obj["expiresAt"])
        let error = errorReport(
            from: obj["error"] as? [String: Any],
            fallbackAccepted: accepted,
            fallbackMessage: message,
            occurredAt: readyAt
        )

        return BridgePrepareStartTurnAck(
            prepareID: request.prepareID,
            workspaceID: request.workspaceID,
            threadID: request.threadID,
            readyAt: readyAt,
            expiresAt: expiresAt,
            accepted: accepted,
            message: message,
            error: error
        )
    }

    static func unknownActionAckFields(in resultData: Data) -> Set<String> {
        guard let obj = try? decodeObject(resultData) else { return [] }
        return Set(obj.keys).subtracting(knownElectronActionAckFields)
    }

    static func actionIDFromPayload(_ payloadData: Data) -> ActionID? {
        guard let obj = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              let rawActionID = stringValue(obj["actionID"]) ?? stringValue(obj["actionId"]) else {
            return nil
        }
        return ActionID(rawActionID)
    }

    enum AckDecodeError: Error, Equatable, CustomStringConvertible {
        case invalidJSON
        case missingAccepted

        var description: String {
            switch self {
            case .invalidJSON: return "Ack result is not a JSON object"
            case .missingAccepted: return "Ack result missing accepted Bool"
            }
        }
    }

    private static func decodeObject(_ data: Data) throws -> [String: Any] {
        guard let obj = try JSONSerialization.jsonObject(
            with: data,
            options: [.fragmentsAllowed]
        ) as? [String: Any] else {
            throw AckDecodeError.invalidJSON
        }
        return obj
    }

    private static func derivedActionState(accepted: Bool, executed: Bool?) -> RemoteActionState {
        if !accepted {
            return .rejected
        }
        if executed == true {
            return .succeeded
        }
        return .accepted
    }

    private static func errorReport(
        from obj: [String: Any]?,
        fallbackAccepted accepted: Bool,
        fallbackMessage: String?,
        occurredAt: Date
    ) -> BridgeErrorReport? {
        if let obj {
            let code = stringValue(obj["code"]) ?? (accepted ? "bridgeActionWarning" : "bridgeActionRejected")
            let message = stringValue(obj["message"]) ?? fallbackMessage ?? (accepted ? "Accepted" : "Rejected")
            let severity = stringValue(obj["severity"]).map { EventSeverity($0) }
                ?? (accepted ? .warning : .error)
            let redactedDetails = stringValue(obj["redactedDetails"])
            let errorOccurredAt = dateValue(obj["occurredAt"]) ?? occurredAt
            return BridgeErrorReport(
                code: code,
                message: message,
                severity: severity,
                redactedDetails: redactedDetails,
                occurredAt: errorOccurredAt
            )
        }
        guard !accepted, let fallbackMessage else {
            return nil
        }
        return BridgeErrorReport(
            code: "bridgeActionRejected",
            message: fallbackMessage,
            severity: .warning,
            occurredAt: occurredAt
        )
    }

    private static func firstString(_ values: Any?...) -> String? {
        for value in values {
            if let string = stringValue(value), !string.isEmpty {
                return string
            }
        }
        return nil
    }

    private static func stringValue(_ value: Any?) -> String? {
        if let value = value as? String {
            return value
        }
        if let value = value as? NSNumber {
            return value.stringValue
        }
        return nil
    }

    private static func boolValue(_ value: Any?) -> Bool? {
        if let value = value as? Bool {
            return value
        }
        if let value = value as? NSNumber {
            return value.boolValue
        }
        return nil
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let value = value as? Int {
            return value
        }
        if let value = value as? NSNumber {
            return value.intValue
        }
        return nil
    }

    private static func bridgeJSONValue(_ value: Any) -> BridgeJSONValue? {
        switch value {
        case _ as NSNull:
            return .null
        case let value as Bool:
            return .bool(value)
        case let value as NSNumber:
            return .number(value.doubleValue)
        case let value as String:
            return .string(value)
        case let value as [Any]:
            return .array(value.compactMap(bridgeJSONValue))
        case let value as [String: Any]:
            return .object(value.compactMapValues(bridgeJSONValue))
        default:
            return nil
        }
    }

    private static func dateValue(_ value: Any?) -> Date? {
        if let value = value as? Date {
            return value
        }
        if let value = value as? NSNumber {
            let raw = value.doubleValue
            return Date(timeIntervalSince1970: raw > 10_000_000_000 ? raw / 1000.0 : raw)
        }
        guard let string = value as? String, !string.isEmpty else {
            return nil
        }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: string) {
            return date
        }
        return ISO8601DateFormatter().date(from: string)
    }
}
