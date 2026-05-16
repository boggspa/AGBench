import SwiftUI

public struct iPadDiffPayload: Hashable, Sendable {
    public let title: String
    public let path: String?
    public let unifiedDiff: String?
    public let before: String?
    public let after: String?

    public init(
        title: String,
        path: String? = nil,
        unifiedDiff: String? = nil,
        before: String? = nil,
        after: String? = nil
    ) {
        self.title = title
        self.path = path
        self.unifiedDiff = unifiedDiff
        self.before = before
        self.after = after
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct iPadDiffInspector: View {
    public let event: BridgeRunEvent?

    public init(event: BridgeRunEvent?) {
        self.event = event
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            header
            if let event,
               let payload = Self.diffPayload(from: event) {
                diffContent(payload)
            } else {
                emptyState
            }
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
    }

    public static func latestDiffEvent(
        in events: [BridgeRunEvent],
        threadID: String?
    ) -> BridgeRunEvent? {
        events.reversed().first { event in
            guard let payload = event.payloadDictionary(),
                  diffPayload(from: event) != nil
            else { return false }
            guard let threadID else { return true }
            return string(payload, keys: [
                "threadId", "threadID", "thread_id", "conversationId", "conversationID", "runId", "runID", "appRunId"
            ]).flatMap { trimmed($0) } == threadID
        }
    }

    public static func diffPayload(from event: BridgeRunEvent) -> iPadDiffPayload? {
        guard let payload = event.payloadDictionary() else { return nil }
        return diffPayload(from: payload)
    }

    private static func diffPayload(from payload: [String: Any]) -> iPadDiffPayload? {
        let nestedDiff = dictionary(payload, keys: ["diff", "patch"])
        let marker = string(payload, keys: ["kind", "type", "event", "eventType", "payloadType"])?.lowercased() ?? ""
        let unified = string(payload, keys: ["diff", "patch", "unifiedDiff", "unified", "text"])
            ?? string(nestedDiff, keys: ["diff", "patch", "unifiedDiff", "unified", "text"])
            ?? filesDiffText(from: payload)
        let before = string(payload, keys: ["before", "oldText", "previous"])
            ?? string(nestedDiff, keys: ["before", "oldText", "previous"])
        let after = string(payload, keys: ["after", "newText", "current"])
            ?? string(nestedDiff, keys: ["after", "newText", "current"])

        let hasDiffMarker = marker.contains("diff")
            || marker.contains("patch")
            || unified != nil
            || before != nil
            || after != nil
        guard hasDiffMarker else { return nil }

        let path = string(payload, keys: ["path", "filePath", "relativePath"])
            ?? string(nestedDiff, keys: ["path", "filePath", "relativePath"])
        let title = string(payload, keys: ["title", "summary"])
            ?? path
            ?? "Run Diff"

        return iPadDiffPayload(
            title: title,
            path: path,
            unifiedDiff: trimmed(unified),
            before: trimmed(before),
            after: trimmed(after)
        )
    }

    private var header: some View {
        HStack(spacing: Theme.Spacing.tight) {
            Label("Diff", systemImage: "doc.text.magnifyingglass")
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.primaryText)
            Spacer(minLength: Theme.Spacing.tight)
            if event != nil {
                Text("read-only")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.inputSurface, in: Capsule(style: .continuous))
            }
        }
    }

    @ViewBuilder
    private func diffContent(_ payload: iPadDiffPayload) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            VStack(alignment: .leading, spacing: 4) {
                Text(payload.title)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(2)
                if let path = payload.path, !path.isEmpty {
                    Text(path)
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            if let unifiedDiff = payload.unifiedDiff, !unifiedDiff.isEmpty {
                unifiedDiffView(unifiedDiff)
            } else if let before = payload.before,
                      let after = payload.after {
                splitDiffView(before: before, after: after)
            } else {
                emptyState
            }
        }
    }

    private func unifiedDiffView(_ diff: String) -> some View {
        ScrollView(.horizontal) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(diff.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, line in
                    Text(String(line))
                        .font(Theme.Typography.code)
                        .foregroundStyle(color(for: String(line)))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(background(for: String(line)))
                }
            }
            .textSelection(.enabled)
            .padding(.vertical, 8)
        }
        .frame(maxHeight: 320)
        .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .accessibilityLabel("Read-only unified diff")
    }

    private func splitDiffView(before: String, after: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.tight) {
            splitColumn(title: "Before", text: before, tint: Theme.destructive)
            splitColumn(title: "After", text: after, tint: Theme.success)
        }
        .accessibilityElement(children: .contain)
    }

    private func splitColumn(title: String, text: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            Text(title)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(tint)
            ScrollView(.horizontal) {
                Text(text)
                    .font(Theme.Typography.code)
                    .foregroundStyle(Theme.primaryText)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
            }
            .frame(maxHeight: 260)
            .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
    }

    private var emptyState: some View {
        VStack(spacing: Theme.Spacing.tight) {
            Image(systemName: "doc.text.magnifyingglass")
                .font(Theme.Typography.iconMedium)
                .foregroundStyle(Theme.tertiaryText)
            Text("No diff selected")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
            Text("Read-only file changes appear here when the selected run publishes a diff event.")
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
                .multilineTextAlignment(.center)
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func color(for line: String) -> Color {
        if line.hasPrefix("+") && !line.hasPrefix("+++") {
            return Theme.success
        }
        if line.hasPrefix("-") && !line.hasPrefix("---") {
            return Theme.destructive
        }
        if line.hasPrefix("@@") || line.hasPrefix("diff ") || line.hasPrefix("index ") {
            return Theme.accent
        }
        return Theme.primaryText
    }

    private func background(for line: String) -> Color {
        if line.hasPrefix("+") && !line.hasPrefix("+++") {
            return Theme.success.opacity(0.10)
        }
        if line.hasPrefix("-") && !line.hasPrefix("---") {
            return Theme.destructive.opacity(0.10)
        }
        if line.hasPrefix("@@") {
            return Theme.accent.opacity(0.10)
        }
        return .clear
    }

    private static func filesDiffText(from payload: [String: Any]) -> String? {
        guard let files = payload["files"] as? [[String: Any]] else { return nil }
        let chunks = files.compactMap { file -> String? in
            let path = string(file, keys: ["path", "filePath", "relativePath"])
            let diff = string(file, keys: ["diff", "patch", "unifiedDiff", "text"])
            guard let diff, !diff.isEmpty else { return nil }
            if let path, !path.isEmpty {
                return "diff -- \(path)\n\(diff)"
            }
            return diff
        }
        guard !chunks.isEmpty else { return nil }
        return chunks.joined(separator: "\n\n")
    }

    private static func dictionary(
        _ payload: [String: Any]?,
        keys: [String]
    ) -> [String: Any]? {
        guard let payload else { return nil }
        for key in keys {
            if let value = payload[key] as? [String: Any] {
                return value
            }
        }
        return nil
    }

    private static func string(
        _ payload: [String: Any]?,
        keys: [String]
    ) -> String? {
        guard let payload else { return nil }
        for key in keys {
            if let value = payload[key] as? String {
                return value
            }
            if let value = payload[key] as? CustomStringConvertible {
                return value.description
            }
        }
        return nil
    }

    private static func trimmed(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
