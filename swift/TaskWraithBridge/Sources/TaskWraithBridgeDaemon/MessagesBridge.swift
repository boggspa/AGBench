import Foundation
import SQLite3

enum MessagesBridgeError: LocalizedError {
    case databaseUnavailable(String)
    case databaseQuery(String)
    case invalidSendTarget
    case missingSendScope
    case sendTargetNotInChat(String)
    case invalidAttachment(String)
    case appleScriptFailed(String)

    var errorDescription: String? {
        switch self {
        case .databaseUnavailable(let message):
            return message
        case .databaseQuery(let message):
            return message
        case .invalidSendTarget:
            return "messages.sendText requires a non-empty recipient handle."
        case .missingSendScope:
            return "Refusing Messages.app send: a bound iMessage chat GUID is required."
        case .sendTargetNotInChat(let message):
            return message
        case .invalidAttachment(let message):
            return message
        case .appleScriptFailed(let message):
            return message
        }
    }
}

struct MessagesStatusResult: Encodable {
    let ok: Bool
    let platform: String
    let databasePath: String
    let databaseExists: Bool
    let databaseReadable: Bool
    let pollSupported: Bool
    let sendTextSupported: Bool
    let sendAttachmentSupported: Bool
    let automationRequiresUserConsent: Bool
    let note: String
}

struct MessagesPollParams: Decodable {
    let accountId: String?
    let chatGuid: String?
    let afterRowId: Int64?
    let limit: Int?
    let includeFromMe: Bool?
    let latestFirst: Bool?
}

struct MessagesConversationsParams: Decodable {
    let accountId: String?
    let limit: Int?
}

struct MessagesSendTextParams: Decodable {
    let accountId: String?
    let chatGuid: String?
    let recipientHandle: String
    let text: String
}

struct MessagesSendAttachmentParams: Decodable {
    let accountId: String?
    let chatGuid: String?
    let recipientHandle: String
    let filePath: String
}

struct MessagesPollResult: Encodable {
    let ok: Bool
    let accountId: String
    let databasePath: String
    let messages: [MessagesInboundMessage]
}

struct MessagesConversationListResult: Encodable {
    let ok: Bool
    let accountId: String
    let databasePath: String
    let conversations: [MessagesConversation]
}

struct MessagesConversation: Encodable {
    let channel: String
    let accountId: String
    let chatGuid: String
    let displayName: String?
    let chatIdentifier: String?
    let serviceName: String?
    let participantHandles: [String]
    let lastMessageGuid: String?
    let lastMessageText: String?
    let lastSenderHandle: String?
    let lastTimestamp: String?
    let lastIsFromMe: Bool?
    let lastRowId: Int64?
}

struct MessagesInboundMessage: Encodable {
    let channel: String
    let accountId: String
    let chatGuid: String
    let messageGuid: String
    let senderHandle: String
    let text: String?
    let timestamp: String
    let isFromMe: Bool
    let rowId: Int64
    let attachments: [MessagesAttachment]
}

struct MessagesAttachment: Encodable {
    let id: String
    let filename: String?
    let path: String?
    let mimeType: String?
    let uti: String?
    let byteCount: Int64?
}

struct MessagesSendTextResult: Encodable {
    let ok: Bool
    let recipientHandle: String
    let sentAt: String
}

struct MessagesSendAttachmentResult: Encodable {
    let ok: Bool
    let recipientHandle: String
    let filePath: String
    let filename: String
    let byteCount: Int64
    let sentAt: String
}

enum MessagesBridge {
    private static let testingState = MessagesBridgeTestingState()

    static func setDatabasePathOverrideForTesting(_ path: String?) {
        testingState.setDatabasePathOverride(path)
    }

    static func status() -> MessagesStatusResult {
        let dbPath = messagesDatabasePath()
        let exists = FileManager.default.fileExists(atPath: dbPath)
        let readable = FileManager.default.isReadableFile(atPath: dbPath)
        return MessagesStatusResult(
            ok: exists && readable,
            platform: "darwin",
            databasePath: dbPath,
            databaseExists: exists,
            databaseReadable: readable,
            pollSupported: exists && readable,
            sendTextSupported: true,
            sendAttachmentSupported: true,
            automationRequiresUserConsent: true,
            note: "TaskWraith reads Messages locally in read-only mode and sends through Messages.app automation. It never asks for Apple ID credentials."
        )
    }

    static func poll(_ params: MessagesPollParams) throws -> MessagesPollResult {
        let dbPath = messagesDatabasePath()
        guard FileManager.default.fileExists(atPath: dbPath) else {
            throw MessagesBridgeError.databaseUnavailable("Messages database was not found at \(dbPath).")
        }
        guard FileManager.default.isReadableFile(atPath: dbPath) else {
            throw MessagesBridgeError.databaseUnavailable(
                "Messages database is not readable. Grant Full Disk Access to TaskWraith and restart the app."
            )
        }

        let accountId = (params.accountId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            ? params.accountId!.trimmingCharacters(in: .whitespacesAndNewlines)
            : "mac-default"
        let limit = min(max(params.limit ?? 25, 1), 100)
        let includeFromMe = params.includeFromMe ?? false
        let latestFirst = params.latestFirst ?? false
        let messages = try withMessagesDatabase(path: dbPath) { db in
            try fetchMessages(
                db: db,
                accountId: accountId,
                chatGuid: params.chatGuid,
                afterRowId: params.afterRowId ?? 0,
                limit: limit,
                includeFromMe: includeFromMe,
                latestFirst: latestFirst
            )
        }
        return MessagesPollResult(
            ok: true,
            accountId: accountId,
            databasePath: dbPath,
            messages: messages
        )
    }

    static func conversations(_ params: MessagesConversationsParams) throws -> MessagesConversationListResult {
        let dbPath = messagesDatabasePath()
        guard FileManager.default.fileExists(atPath: dbPath) else {
            throw MessagesBridgeError.databaseUnavailable("Messages database was not found at \(dbPath).")
        }
        guard FileManager.default.isReadableFile(atPath: dbPath) else {
            throw MessagesBridgeError.databaseUnavailable(
                "Messages database is not readable. Grant Full Disk Access to TaskWraith and restart the app."
            )
        }

        let accountId = (params.accountId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            ? params.accountId!.trimmingCharacters(in: .whitespacesAndNewlines)
            : "mac-default"
        let limit = min(max(params.limit ?? 25, 1), 100)
        let conversations = try withMessagesDatabase(path: dbPath) { db in
            try fetchConversations(db: db, accountId: accountId, limit: limit)
        }
        return MessagesConversationListResult(
            ok: true,
            accountId: accountId,
            databasePath: dbPath,
            conversations: conversations
        )
    }

    static func sendText(_ params: MessagesSendTextParams) throws -> MessagesSendTextResult {
        let handle = params.recipientHandle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !handle.isEmpty else {
            throw MessagesBridgeError.invalidSendTarget
        }
        let text = params.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            throw MessagesBridgeError.appleScriptFailed("messages.sendText requires non-empty text.")
        }
        try validateSendTarget(handle: handle, chatGuid: params.chatGuid)

        let script = """
        tell application "Messages"
          set targetService to first service whose service type = iMessage
          set targetBuddy to buddy \(appleScriptStringLiteral(handle)) of targetService
          send \(appleScriptStringLiteral(text)) to targetBuddy
        end tell
        """
        var errorInfo: NSDictionary?
        guard let appleScript = NSAppleScript(source: script) else {
            throw MessagesBridgeError.appleScriptFailed("Failed to build Messages AppleScript.")
        }
        appleScript.executeAndReturnError(&errorInfo)
        if let errorInfo {
            let message = (errorInfo[NSAppleScript.errorMessage] as? String) ?? String(describing: errorInfo)
            throw MessagesBridgeError.appleScriptFailed(message)
        }
        return MessagesSendTextResult(
            ok: true,
            recipientHandle: handle,
            sentAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    static func sendAttachment(_ params: MessagesSendAttachmentParams) throws -> MessagesSendAttachmentResult {
        let handle = params.recipientHandle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !handle.isEmpty else {
            throw MessagesBridgeError.invalidSendTarget
        }
        let filePath = normalizeAttachmentPath(params.filePath.trimmingCharacters(in: .whitespacesAndNewlines))
            ?? ""
        guard !filePath.isEmpty else {
            throw MessagesBridgeError.invalidAttachment("messages.sendAttachment requires a non-empty file path.")
        }

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: filePath, isDirectory: &isDirectory), !isDirectory.boolValue else {
            throw MessagesBridgeError.invalidAttachment("Attachment file does not exist: \(filePath)")
        }
        guard FileManager.default.isReadableFile(atPath: filePath) else {
            throw MessagesBridgeError.invalidAttachment("Attachment file is not readable: \(filePath)")
        }
        try validateSendTarget(handle: handle, chatGuid: params.chatGuid)
        let attributes = try FileManager.default.attributesOfItem(atPath: filePath)
        let byteCount = (attributes[.size] as? NSNumber)?.int64Value ?? 0

        let script = """
        tell application "Messages"
          set targetService to first service whose service type = iMessage
          set targetBuddy to buddy \(appleScriptStringLiteral(handle)) of targetService
          send POSIX file \(appleScriptStringLiteral(filePath)) to targetBuddy
        end tell
        """
        var errorInfo: NSDictionary?
        guard let appleScript = NSAppleScript(source: script) else {
            throw MessagesBridgeError.appleScriptFailed("Failed to build Messages attachment AppleScript.")
        }
        appleScript.executeAndReturnError(&errorInfo)
        if let errorInfo {
            let message = (errorInfo[NSAppleScript.errorMessage] as? String) ?? String(describing: errorInfo)
            throw MessagesBridgeError.appleScriptFailed(message)
        }
        return MessagesSendAttachmentResult(
            ok: true,
            recipientHandle: handle,
            filePath: filePath,
            filename: URL(fileURLWithPath: filePath).lastPathComponent,
            byteCount: byteCount,
            sentAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    private static func messagesDatabasePath() -> String {
        if let databasePathOverride = testingState.databasePathOverride() {
            return databasePathOverride
        }
        if let testDatabasePath = ProcessInfo.processInfo.environment["TASKWRAITH_MESSAGES_DB_PATH_FOR_TESTING"],
           !testDatabasePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return testDatabasePath.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return "\(home)/Library/Messages/chat.db"
    }

    private static func withMessagesDatabase<T>(
        path: String,
        _ body: (OpaquePointer) throws -> T
    ) throws -> T {
        var db: OpaquePointer?
        let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX
        guard sqlite3_open_v2(path, &db, flags, nil) == SQLITE_OK, let db else {
            let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "sqlite open failed"
            if let db {
                sqlite3_close(db)
            }
            throw MessagesBridgeError.databaseUnavailable(message)
        }
        defer {
            sqlite3_close(db)
        }
        return try body(db)
    }

    private static func fetchMessages(
        db: OpaquePointer,
        accountId: String,
        chatGuid: String?,
        afterRowId: Int64,
        limit: Int,
        includeFromMe: Bool,
        latestFirst: Bool
    ) throws -> [MessagesInboundMessage] {
        let orderDirection = latestFirst ? "DESC" : "ASC"
        let sql = """
        SELECT message.ROWID,
               message.guid,
               chat.guid,
               COALESCE(handle.id, ''),
               message.text,
               message.date,
               message.is_from_me
        FROM message
        JOIN chat_message_join ON chat_message_join.message_id = message.ROWID
        JOIN chat ON chat.ROWID = chat_message_join.chat_id
        LEFT JOIN handle ON handle.ROWID = message.handle_id
        WHERE message.ROWID > ?
          AND (chat.service_name = 'iMessage' OR chat.guid LIKE 'iMessage;%')
          AND (? IS NULL OR chat.guid = ?)
          AND (? = 1 OR message.is_from_me = 0)
        ORDER BY message.ROWID \(orderDirection)
        LIMIT ?
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw MessagesBridgeError.databaseQuery(String(cString: sqlite3_errmsg(db)))
        }
        defer {
            sqlite3_finalize(statement)
        }

        sqlite3_bind_int64(statement, 1, afterRowId)
        if let chatGuid, !chatGuid.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            sqlite3_bind_text(statement, 2, chatGuid, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(statement, 3, chatGuid, -1, SQLITE_TRANSIENT)
        } else {
            sqlite3_bind_null(statement, 2)
            sqlite3_bind_null(statement, 3)
        }
        sqlite3_bind_int(statement, 4, includeFromMe ? 1 : 0)
        sqlite3_bind_int(statement, 5, Int32(limit))

        var messages: [MessagesInboundMessage] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let rowId = sqlite3_column_int64(statement, 0)
            let messageGuid = columnString(statement, 1) ?? "message-row-\(rowId)"
            let chatGuid = columnString(statement, 2) ?? ""
            let senderHandle = columnString(statement, 3) ?? ""
            let text = columnString(statement, 4)
            let rawDate = sqlite3_column_int64(statement, 5)
            let isFromMe = sqlite3_column_int(statement, 6) != 0
            messages.append(
                MessagesInboundMessage(
                    channel: "imessage",
                    accountId: accountId,
                    chatGuid: chatGuid,
                    messageGuid: messageGuid,
                    senderHandle: senderHandle,
                    text: text,
                    timestamp: messagesTimestamp(rawDate),
                    isFromMe: isFromMe,
                    rowId: rowId,
                    attachments: try fetchAttachments(db: db, messageRowId: rowId)
                )
            )
        }
        return messages
    }

    private static func fetchConversations(
        db: OpaquePointer,
        accountId: String,
        limit: Int
    ) throws -> [MessagesConversation] {
        let sql = """
        SELECT chat.ROWID,
               chat.guid,
               chat.display_name,
               chat.chat_identifier,
               chat.service_name,
               message.ROWID,
               message.guid,
               message.text,
               message.date,
               message.is_from_me,
               COALESCE(handle.id, '')
        FROM chat
        LEFT JOIN chat_message_join latest_join
          ON latest_join.message_id = (
            SELECT MAX(message_id)
            FROM chat_message_join
            WHERE chat_id = chat.ROWID
          )
        LEFT JOIN message ON message.ROWID = latest_join.message_id
        LEFT JOIN handle ON handle.ROWID = message.handle_id
        WHERE chat.service_name = 'iMessage'
           OR chat.guid LIKE 'iMessage;%'
        ORDER BY COALESCE(message.ROWID, 0) DESC
        LIMIT ?
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw MessagesBridgeError.databaseQuery(String(cString: sqlite3_errmsg(db)))
        }
        defer {
            sqlite3_finalize(statement)
        }
        sqlite3_bind_int(statement, 1, Int32(limit))

        var conversations: [MessagesConversation] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let chatRowId = sqlite3_column_int64(statement, 0)
            let chatGuid = columnString(statement, 1) ?? ""
            let rawDate = sqlite3_column_type(statement, 8) == SQLITE_NULL
                ? nil
                : sqlite3_column_int64(statement, 8)
            let lastIsFromMe = sqlite3_column_type(statement, 9) == SQLITE_NULL
                ? nil
                : sqlite3_column_int(statement, 9) != 0
            let lastRowId = sqlite3_column_type(statement, 5) == SQLITE_NULL
                ? nil
                : sqlite3_column_int64(statement, 5)
            conversations.append(
                MessagesConversation(
                    channel: "imessage",
                    accountId: accountId,
                    chatGuid: chatGuid,
                    displayName: columnString(statement, 2),
                    chatIdentifier: columnString(statement, 3),
                    serviceName: columnString(statement, 4),
                    participantHandles: try fetchParticipantHandles(db: db, chatRowId: chatRowId),
                    lastMessageGuid: columnString(statement, 6),
                    lastMessageText: columnString(statement, 7),
                    lastSenderHandle: columnString(statement, 10),
                    lastTimestamp: rawDate.map(messagesTimestamp),
                    lastIsFromMe: lastIsFromMe,
                    lastRowId: lastRowId
                )
            )
        }
        return conversations
    }

    private static func fetchParticipantHandles(
        db: OpaquePointer,
        chatRowId: Int64
    ) throws -> [String] {
        let sql = """
        SELECT DISTINCT handle.id
        FROM chat_handle_join
        JOIN handle ON handle.ROWID = chat_handle_join.handle_id
        WHERE chat_handle_join.chat_id = ?
        ORDER BY handle.id ASC
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw MessagesBridgeError.databaseQuery(String(cString: sqlite3_errmsg(db)))
        }
        defer {
            sqlite3_finalize(statement)
        }
        sqlite3_bind_int64(statement, 1, chatRowId)

        var handles: [String] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            if let handle = columnString(statement, 0), !handle.isEmpty {
                handles.append(handle)
            }
        }
        return handles
    }

    private static func validateSendTarget(handle: String, chatGuid: String?) throws {
        guard let chatGuid = chatGuid?.trimmingCharacters(in: .whitespacesAndNewlines),
              !chatGuid.isEmpty else {
            throw MessagesBridgeError.missingSendScope
        }
        let dbPath = messagesDatabasePath()
        guard FileManager.default.fileExists(atPath: dbPath) else {
            throw MessagesBridgeError.databaseUnavailable(
                "Messages database was not found at \(dbPath); cannot verify scoped send target."
            )
        }
        guard FileManager.default.isReadableFile(atPath: dbPath) else {
            throw MessagesBridgeError.databaseUnavailable(
                "Messages database is not readable. Grant Full Disk Access to TaskWraith and restart the app before sending through the iMessage bridge."
            )
        }
        let isParticipant = try withMessagesDatabase(path: dbPath) { db in
            try isHandleParticipant(db: db, chatGuid: chatGuid, handle: handle)
        }
        guard isParticipant else {
            throw MessagesBridgeError.sendTargetNotInChat(
                "Refusing Messages.app send: recipient handle is not a participant in the bound iMessage chat."
            )
        }
    }

    private static func isHandleParticipant(
        db: OpaquePointer,
        chatGuid: String,
        handle: String
    ) throws -> Bool {
        let sql = """
        SELECT 1
        FROM chat
        JOIN chat_handle_join ON chat_handle_join.chat_id = chat.ROWID
        JOIN handle ON handle.ROWID = chat_handle_join.handle_id
        WHERE chat.guid = ?
          AND (chat.service_name = 'iMessage' OR chat.guid LIKE 'iMessage;%')
          AND lower(handle.id) = lower(?)
        LIMIT 1
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw MessagesBridgeError.databaseQuery(String(cString: sqlite3_errmsg(db)))
        }
        defer {
            sqlite3_finalize(statement)
        }
        sqlite3_bind_text(statement, 1, chatGuid, -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(statement, 2, handle, -1, SQLITE_TRANSIENT)
        return sqlite3_step(statement) == SQLITE_ROW
    }

    private static func fetchAttachments(
        db: OpaquePointer,
        messageRowId: Int64
    ) throws -> [MessagesAttachment] {
        let sql = """
        SELECT COALESCE(attachment.guid, ''),
               attachment.filename,
               attachment.mime_type,
               attachment.uti,
               attachment.total_bytes
        FROM attachment
        JOIN message_attachment_join ON message_attachment_join.attachment_id = attachment.ROWID
        WHERE message_attachment_join.message_id = ?
        ORDER BY attachment.ROWID ASC
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw MessagesBridgeError.databaseQuery(String(cString: sqlite3_errmsg(db)))
        }
        defer {
            sqlite3_finalize(statement)
        }
        sqlite3_bind_int64(statement, 1, messageRowId)

        var attachments: [MessagesAttachment] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let rawFilename = columnString(statement, 1)
            let attachmentPath = normalizeAttachmentPath(rawFilename)
            attachments.append(
                MessagesAttachment(
                    id: columnString(statement, 0) ?? "attachment-\(messageRowId)-\(attachments.count)",
                    filename: attachmentDisplayName(path: attachmentPath, rawValue: rawFilename),
                    path: attachmentPath,
                    mimeType: columnString(statement, 2),
                    uti: columnString(statement, 3),
                    byteCount: sqlite3_column_type(statement, 4) == SQLITE_NULL
                        ? nil
                        : sqlite3_column_int64(statement, 4)
                )
            )
        }
        return attachments
    }

    private static func messagesTimestamp(_ rawDate: Int64) -> String {
        let appleEpoch = Date(timeIntervalSince1970: 978_307_200)
        let seconds: TimeInterval
        if rawDate > 10_000_000_000_000 {
            seconds = TimeInterval(rawDate) / 1_000_000_000
        } else {
            seconds = TimeInterval(rawDate)
        }
        return ISO8601DateFormatter().string(from: appleEpoch.addingTimeInterval(seconds))
    }

    private static func columnString(_ statement: OpaquePointer, _ index: Int32) -> String? {
        guard sqlite3_column_type(statement, index) != SQLITE_NULL else {
            return nil
        }
        guard let text = sqlite3_column_text(statement, index) else {
            return nil
        }
        return String(cString: text)
    }

    private static func normalizeAttachmentPath(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let url = URL(string: trimmed), url.isFileURL {
            return url.path
        }
        if trimmed.hasPrefix("~/") {
            return FileManager.default.homeDirectoryForCurrentUser.path + String(trimmed.dropFirst())
        }
        if trimmed.hasPrefix("/") {
            return trimmed
        }
        if trimmed.hasPrefix("Library/Messages/") {
            return FileManager.default.homeDirectoryForCurrentUser.path + "/" + trimmed
        }
        return nil
    }

    private static func attachmentDisplayName(path: String?, rawValue: String?) -> String? {
        if let path, !path.isEmpty {
            return URL(fileURLWithPath: path).lastPathComponent
        }
        guard let rawValue else { return nil }
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let url = URL(string: trimmed), url.isFileURL {
            return url.lastPathComponent
        }
        return trimmed.split(separator: "/").last.map(String.init) ?? trimmed
    }

    private static func appleScriptStringLiteral(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "\"\(escaped)\""
    }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

private final class MessagesBridgeTestingState: @unchecked Sendable {
    private let lock = NSLock()
    private var pathOverride: String?

    func setDatabasePathOverride(_ path: String?) {
        lock.lock()
        pathOverride = path
        lock.unlock()
    }

    func databasePathOverride() -> String? {
        lock.lock()
        let path = pathOverride
        lock.unlock()
        return path
    }
}
