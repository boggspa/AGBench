import XCTest
import SQLite3
@testable import TaskWraithBridgeDaemon

final class MessagesBridgeTests: XCTestCase {
    private var tempDir: URL!
    private var databasePath: String!

    override func setUpWithError() throws {
        tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("taskwraith-messages-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        databasePath = tempDir.appendingPathComponent("chat.db").path
        try createMessagesDatabase(at: databasePath)
        MessagesBridge.setDatabasePathOverrideForTesting(databasePath)
    }

    override func tearDownWithError() throws {
        MessagesBridge.setDatabasePathOverrideForTesting(nil)
        if let tempDir {
            try? FileManager.default.removeItem(at: tempDir)
        }
        tempDir = nil
        databasePath = nil
    }

    func testStatusUsesElectronPlatformName() throws {
        let status = MessagesBridge.status()

        XCTAssertTrue(status.ok)
        XCTAssertEqual(status.platform, "darwin")
        XCTAssertEqual(status.databasePath, databasePath)
        XCTAssertTrue(status.databaseReadable)
        XCTAssertTrue(status.pollSupported)
    }

    func testPollReadsAllowedChatRowsAndAttachmentMetadata() throws {
        let result = try MessagesBridge.poll(
            MessagesPollParams(
                accountId: nil,
                chatGuid: "iMessage;-;operator-chat",
                afterRowId: 1,
                limit: 10,
                includeFromMe: false,
                latestFirst: nil
            )
        )

        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.accountId, "mac-default")
        XCTAssertEqual(result.databasePath, databasePath)
        XCTAssertEqual(result.messages.count, 1)

        let message = try XCTUnwrap(result.messages.first)
        XCTAssertEqual(message.rowId, 2)
        XCTAssertEqual(message.messageGuid, "message-2")
        XCTAssertEqual(message.chatGuid, "iMessage;-;operator-chat")
        XCTAssertEqual(message.senderHandle, "user@example.com")
        XCTAssertEqual(message.text, "tw describe this")
        XCTAssertFalse(message.isFromMe)

        let attachment = try XCTUnwrap(message.attachments.first)
        XCTAssertEqual(attachment.id, "attachment-1")
        XCTAssertEqual(attachment.filename, "photo.png")
        XCTAssertTrue(attachment.path?.hasSuffix("/Library/Messages/Attachments/photo.png") ?? false)
        XCTAssertEqual(attachment.mimeType, "image/png")
        XCTAssertEqual(attachment.uti, "public.png")
        XCTAssertEqual(attachment.byteCount, 1234)

        let relativeAttachment = try XCTUnwrap(message.attachments.first { $0.id == "attachment-relative" })
        XCTAssertEqual(relativeAttachment.filename, "relative-image.png")
        XCTAssertNil(relativeAttachment.path)
    }

    func testPollNormalizesReadableAttachmentPathFormsOnly() throws {
        let result = try MessagesBridge.poll(
            MessagesPollParams(
                accountId: nil,
                chatGuid: "iMessage;-;operator-chat",
                afterRowId: 1,
                limit: 10,
                includeFromMe: false,
                latestFirst: nil
            )
        )
        let message = try XCTUnwrap(result.messages.first)

        let homeRelative = try XCTUnwrap(message.attachments.first { $0.id == "attachment-home-relative" })
        XCTAssertEqual(homeRelative.filename, "memo.txt")
        XCTAssertTrue(homeRelative.path?.hasSuffix("/Library/Messages/Attachments/memo.txt") ?? false)

        let fileURL = try XCTUnwrap(message.attachments.first { $0.id == "attachment-file-url" })
        XCTAssertEqual(fileURL.filename, "voice.m4a")
        XCTAssertEqual(fileURL.path, "/tmp/voice.m4a")
    }

    func testPollCanIncludeMessagesFromSelfWhenRequested() throws {
        let result = try MessagesBridge.poll(
            MessagesPollParams(
                accountId: "desktop",
                chatGuid: "iMessage;-;operator-chat",
                afterRowId: 2,
                limit: 10,
                includeFromMe: true,
                latestFirst: nil
            )
        )

        XCTAssertEqual(result.accountId, "desktop")
        XCTAssertEqual(result.messages.map(\.messageGuid), ["message-3"])
        XCTAssertTrue(result.messages[0].isFromMe)
    }

    func testPollIgnoresNonIMessageChatsEvenWhenRequested() throws {
        let broadResult = try MessagesBridge.poll(
            MessagesPollParams(
                accountId: nil,
                chatGuid: nil,
                afterRowId: 0,
                limit: 10,
                includeFromMe: true,
                latestFirst: nil
            )
        )
        XCTAssertEqual(broadResult.messages.map(\.messageGuid), ["message-1", "message-2", "message-3"])

        let smsResult = try MessagesBridge.poll(
            MessagesPollParams(
                accountId: nil,
                chatGuid: "SMS;-;ignored-chat",
                afterRowId: 0,
                limit: 10,
                includeFromMe: true,
                latestFirst: nil
            )
        )
        XCTAssertTrue(smsResult.messages.isEmpty)
    }

    func testPollCanReturnLatestRowsFirstForDiagnostics() throws {
        let result = try MessagesBridge.poll(
            MessagesPollParams(
                accountId: nil,
                chatGuid: "iMessage;-;operator-chat",
                afterRowId: 0,
                limit: 2,
                includeFromMe: true,
                latestFirst: true
            )
        )

        XCTAssertEqual(result.messages.map(\.messageGuid), ["message-3", "message-2"])
        XCTAssertEqual(result.messages.map(\.rowId), [3, 2])
    }

    func testConversationsListsRecentIMessageChatsWithParticipants() throws {
        let result = try MessagesBridge.conversations(
            MessagesConversationsParams(accountId: nil, limit: 10)
        )

        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.databasePath, databasePath)
        XCTAssertEqual(result.conversations.count, 1)

        let conversation = try XCTUnwrap(result.conversations.first)
        XCTAssertEqual(conversation.channel, "imessage")
        XCTAssertEqual(conversation.accountId, "mac-default")
        XCTAssertEqual(conversation.chatGuid, "iMessage;-;operator-chat")
        XCTAssertEqual(conversation.displayName, "Operator")
        XCTAssertEqual(conversation.chatIdentifier, "operator-chat")
        XCTAssertEqual(conversation.serviceName, "iMessage")
        XCTAssertEqual(conversation.participantHandles, ["me@example.com", "user@example.com"])
        XCTAssertEqual(conversation.lastMessageGuid, "message-3")
        XCTAssertEqual(conversation.lastMessageText, "self echo")
        XCTAssertEqual(conversation.lastSenderHandle, "me@example.com")
        XCTAssertEqual(conversation.lastIsFromMe, true)
        XCTAssertEqual(conversation.lastRowId, 3)
    }

    func testSendTextRejectsRecipientOutsideBoundChatBeforeAutomation() throws {
        XCTAssertThrowsError(
            try MessagesBridge.sendText(
                MessagesSendTextParams(
                    accountId: "mac-default",
                    chatGuid: "iMessage;-;operator-chat",
                    recipientHandle: "intruder@example.com",
                    text: "TaskWraith bridge test"
                )
            )
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Refusing Messages.app send: recipient handle is not a participant in the bound iMessage chat."
            )
        }
    }

    func testSendTextRequiresBoundChatScopeBeforeAutomation() throws {
        XCTAssertThrowsError(
            try MessagesBridge.sendText(
                MessagesSendTextParams(
                    accountId: "mac-default",
                    chatGuid: nil,
                    recipientHandle: "user@example.com",
                    text: "TaskWraith bridge test"
                )
            )
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Refusing Messages.app send: a bound iMessage chat GUID is required."
            )
        }
    }

    func testSendAttachmentRejectsRecipientOutsideBoundChatBeforeAutomation() throws {
        let attachmentPath = tempDir.appendingPathComponent("outbound.txt").path
        try "hello".write(toFile: attachmentPath, atomically: true, encoding: .utf8)

        XCTAssertThrowsError(
            try MessagesBridge.sendAttachment(
                MessagesSendAttachmentParams(
                    accountId: "mac-default",
                    chatGuid: "iMessage;-;operator-chat",
                    recipientHandle: "intruder@example.com",
                    filePath: attachmentPath
                )
            )
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Refusing Messages.app send: recipient handle is not a participant in the bound iMessage chat."
            )
        }
    }

    func testSendAttachmentRequiresBoundChatScopeBeforeAutomation() throws {
        let attachmentPath = tempDir.appendingPathComponent("outbound.txt").path
        try "hello".write(toFile: attachmentPath, atomically: true, encoding: .utf8)

        XCTAssertThrowsError(
            try MessagesBridge.sendAttachment(
                MessagesSendAttachmentParams(
                    accountId: "mac-default",
                    chatGuid: "",
                    recipientHandle: "user@example.com",
                    filePath: attachmentPath
                )
            )
        ) { error in
            XCTAssertEqual(
                error.localizedDescription,
                "Refusing Messages.app send: a bound iMessage chat GUID is required."
            )
        }
    }
}

private func createMessagesDatabase(at path: String) throws {
    var db: OpaquePointer?
    guard sqlite3_open(path, &db) == SQLITE_OK, let db else {
        throw NSError(domain: "MessagesBridgeTests", code: 1)
    }
    defer {
        sqlite3_close(db)
    }

    try exec(
        db,
        """
        CREATE TABLE handle (id TEXT);
        CREATE TABLE chat (
          guid TEXT,
          display_name TEXT,
          chat_identifier TEXT,
          service_name TEXT
        );
        CREATE TABLE message (
          guid TEXT,
          handle_id INTEGER,
          text TEXT,
          date INTEGER,
          is_from_me INTEGER
        );
        CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
        CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
        CREATE TABLE attachment (
          guid TEXT,
          filename TEXT,
          mime_type TEXT,
          uti TEXT,
          total_bytes INTEGER
        );
        CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);

        INSERT INTO handle(rowid, id) VALUES
          (1, 'user@example.com'),
          (2, 'me@example.com');
        INSERT INTO chat(rowid, guid, display_name, chat_identifier, service_name) VALUES
          (1, 'iMessage;-;operator-chat', 'Operator', 'operator-chat', 'iMessage'),
          (2, 'SMS;-;ignored-chat', 'Ignored', 'ignored-chat', 'SMS');
        INSERT INTO chat_handle_join(chat_id, handle_id) VALUES
          (1, 2),
          (1, 1),
          (2, 1);
        INSERT INTO message(rowid, guid, handle_id, text, date, is_from_me) VALUES
          (1, 'message-1', 1, 'old message', 0, 0),
          (2, 'message-2', 1, 'tw describe this', 1, 0),
          (3, 'message-3', 2, 'self echo', 2, 1),
          (4, 'message-4', 1, 'sms ignored', 3, 0);
        INSERT INTO chat_message_join(chat_id, message_id) VALUES
          (1, 1),
          (1, 2),
          (1, 3),
          (2, 4);
        INSERT INTO attachment(rowid, guid, filename, mime_type, uti, total_bytes) VALUES
          (1, 'attachment-1', '~/Library/Messages/Attachments/photo.png', 'image/png', 'public.png', 1234),
          (2, 'attachment-relative', 'relative-image.png', 'image/png', 'public.png', 2345),
          (3, 'attachment-home-relative', 'Library/Messages/Attachments/memo.txt', 'text/plain', 'public.plain-text', 3456),
          (4, 'attachment-file-url', 'file:///tmp/voice.m4a', 'audio/mp4', 'public.mpeg-4-audio', 4567);
        INSERT INTO message_attachment_join(message_id, attachment_id) VALUES
          (2, 1),
          (2, 2),
          (2, 3),
          (2, 4);
        """
    )
}

private func exec(_ db: OpaquePointer, _ sql: String) throws {
    var errorMessage: UnsafeMutablePointer<CChar>?
    if sqlite3_exec(db, sql, nil, nil, &errorMessage) != SQLITE_OK {
        let message = errorMessage.map { String(cString: $0) } ?? "sqlite exec failed"
        sqlite3_free(errorMessage)
        throw NSError(domain: "MessagesBridgeTests", code: 2, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
