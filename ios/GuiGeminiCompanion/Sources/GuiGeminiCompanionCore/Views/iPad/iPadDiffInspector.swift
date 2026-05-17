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
                emptyStateCard
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
            filePathHeader(payload: payload)

            if let unifiedDiff = payload.unifiedDiff, !unifiedDiff.isEmpty {
                unifiedDiffView(unifiedDiff)
            } else if let before = payload.before,
                      let after = payload.after {
                splitDiffView(before: before, after: after)
            } else {
                emptyStateCard
            }
        }
    }

    /// Prominent file path header. The path uses a monospaced font with
    /// truncating-middle so a deep path like
    /// `Sources/GuiGeminiCompanionCore/Views/iPad/Subdir/File.swift` still
    /// shows the meaningful trailing segment in narrow inspector widths.
    private func filePathHeader(payload: iPadDiffPayload) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let path = payload.path, !path.isEmpty {
                HStack(spacing: Theme.Spacing.tight) {
                    Image(systemName: "doc.text")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.accent)
                        .accessibilityHidden(true)
                    Text(path)
                        .font(Theme.Typography.code)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .accessibilityLabel("File path \(path)")
                }
                .padding(.horizontal, Theme.Spacing.control)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .stroke(Theme.accent.opacity(0.22), lineWidth: 1)
                )
            }
            if payload.title != payload.path {
                Text(payload.title)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(2)
            }
        }
    }

    /// Render the unified diff with a left-aligned line-number gutter so
    /// the inspector reads like a Mac/desktop diff viewer. Line numbers
    /// follow standard unified-diff conventions: the gutter tracks each
    /// emitted output line ("after" side) but we annotate header lines
    /// (`@@`, `diff`, `---`, `+++`) with a dot so they don't claim a
    /// numbered slot.
    private func unifiedDiffView(_ diff: String) -> some View {
        let lines = diff.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let numbered = Self.assignLineNumbers(lines)

        return ScrollView(.horizontal) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(numbered.enumerated()), id: \.offset) { _, entry in
                    HStack(alignment: .top, spacing: 0) {
                        Text(entry.gutter)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Theme.tertiaryText)
                            .frame(width: 38, alignment: .trailing)
                            .padding(.trailing, 8)
                            .padding(.leading, 6)
                            .accessibilityHidden(true)
                        Text(entry.line)
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(color(for: entry.line))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.trailing, 8)
                            .padding(.vertical, 2)
                    }
                    .background(background(for: entry.line))
                }
            }
            .textSelection(.enabled)
            .padding(.vertical, 8)
        }
        .frame(maxHeight: 320)
        .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .accessibilityLabel("Read-only unified diff with line numbers")
    }

    private struct NumberedDiffLine {
        let gutter: String
        let line: String
    }

    private static func assignLineNumbers(_ lines: [String]) -> [NumberedDiffLine] {
        var result: [NumberedDiffLine] = []
        result.reserveCapacity(lines.count)
        var newLineNumber: Int = 0
        var parsedHunkStart: Bool = false

        for line in lines {
            if line.hasPrefix("@@") {
                if let parsed = parseHunkHeader(line) {
                    newLineNumber = parsed.newStart - 1
                    parsedHunkStart = true
                }
                result.append(NumberedDiffLine(gutter: "·", line: line))
                continue
            }
            if line.hasPrefix("diff ") || line.hasPrefix("index ")
                || line.hasPrefix("--- ") || line.hasPrefix("+++ ") {
                result.append(NumberedDiffLine(gutter: "·", line: line))
                continue
            }
            // Removed lines do not occupy a position in the "new" file —
            // mark with a dash. Added & context lines increment the
            // counter and claim a numbered slot.
            if line.hasPrefix("-") {
                result.append(NumberedDiffLine(gutter: "—", line: line))
                continue
            }
            if parsedHunkStart {
                newLineNumber += 1
                result.append(NumberedDiffLine(gutter: "\(newLineNumber)", line: line))
            } else {
                // Diff didn't include a hunk header (some bridges strip
                // them). Fall back to a simple 1-based count.
                newLineNumber += 1
                result.append(NumberedDiffLine(gutter: "\(newLineNumber)", line: line))
            }
        }
        return result
    }

    /// Parses `@@ -oldStart,oldLen +newStart,newLen @@` and returns the
    /// new-side start. Tolerates the single-line form
    /// (`@@ -42 +42 @@`) and ignores trailing context.
    private static func parseHunkHeader(_ line: String) -> (newStart: Int, newLen: Int)? {
        guard let plusRange = line.range(of: "+") else { return nil }
        let after = line[plusRange.upperBound...]
        // Take up to the first whitespace or "@" after the +.
        let segment = after.prefix { $0.isNumber || $0 == "," }
        let parts = segment.split(separator: ",")
        guard let startString = parts.first,
              let start = Int(startString) else { return nil }
        let length: Int = {
            if parts.count > 1, let parsed = Int(parts[1]) { return parsed }
            return 1
        }()
        return (start, length)
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
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Theme.primaryText)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
            }
            .frame(maxHeight: 260)
            .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
    }

    /// Polished empty state card: a subtle accent-bordered surface with
    /// the `text.badge.checkmark` SF Symbol that conveys "nothing pending,
    /// you're all caught up" rather than the older "no diff" framing.
    private var emptyStateCard: some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: "text.badge.checkmark")
                .font(Theme.Typography.iconMedium)
                .foregroundStyle(Theme.accent)
                .frame(width: 56, height: 56)
                .background(
                    Theme.accentSoft,
                    in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                )
                .accessibilityHidden(true)
            Text("No diff selected")
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.primaryText)
            Text("Pick a run that emitted a file change to see its diff here.")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .fill(Theme.inputSurface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.accent.opacity(0.22), lineWidth: 1)
        )
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

// MARK: - Previews

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
private enum iPadDiffInspectorPreviewSamples {
    static func populatedEvent() -> BridgeRunEvent? {
        let json = """
        {
          "channel": "agent-output",
          "provider": "codex",
          "publishedAt": "2026-05-17T12:30:00.000Z",
          "payload": {
            "kind": "diff",
            "threadId": "thread-preview",
            "workspaceId": "workspace-preview",
            "path": "Sources/GuiGeminiCompanionCore/Views/iPad/iPadSettingsPane.swift",
            "diff": "diff --git a/Sources/GuiGeminiCompanionCore/Views/iPad/iPadSettingsPane.swift b/Sources/GuiGeminiCompanionCore/Views/iPad/iPadSettingsPane.swift\\n@@ -42,7 +42,9 @@\\n     public var body: some View {\\n         VStack(alignment: .leading, spacing: Theme.Spacing.section) {\\n-            headerStrip\\n+            headerStrip\\n+            pairingCard\\n+            bridgeConnectionCard\\n             Spacer(minLength: 0)\\n         }\\n     }"
          }
        }
        """
        return try? BridgeRunEvent.decode(eventRecordBytes: Data(json.utf8))
    }
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("Diff Inspector — empty state") {
    iPadDiffInspector(event: nil)
        .frame(width: 360, height: 280)
        .padding()
        .background(Theme.background)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("Diff Inspector — populated diff") {
    iPadDiffInspector(event: iPadDiffInspectorPreviewSamples.populatedEvent())
        .frame(width: 420, height: 460)
        .padding()
        .background(Theme.background)
}
#endif
