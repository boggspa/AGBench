import Foundation

/// Splits a GROWING markdown stream into the settled prefix (safe to render
/// through the markdown pipeline — it won't change again) and the live tail
/// (still receiving tokens; rendered plain until its paragraph completes).
///
/// The boundary is the last blank line OUTSIDE a ``` code fence: splitting
/// inside an open fence would tear a code block in half and render its body
/// as paragraphs. Lists/tables stay in the tail until a blank line follows
/// them — a half-typed `**bold` or `| cell` never hits the markdown parser.
public enum StreamingMarkdownSplitter {
    public static func split(_ text: String) -> (settled: String, tail: String) {
        guard !text.isEmpty else { return ("", "") }
        var inFence = false
        var lastBoundary: String.Index? = nil
        var lineStart = text.startIndex
        while lineStart < text.endIndex {
            let lineEnd = text[lineStart...].firstIndex(of: "\n") ?? text.endIndex
            let line = text[lineStart..<lineEnd]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") {
                inFence.toggle()
            } else if trimmed.isEmpty, !inFence, lineEnd < text.endIndex {
                // The settled prefix ends AFTER this blank line; the next
                // line starts the (possibly still-growing) tail.
                lastBoundary = text.index(after: lineEnd)
            }
            if lineEnd == text.endIndex { break }
            lineStart = text.index(after: lineEnd)
        }
        guard let boundary = lastBoundary else { return ("", text) }
        return (String(text[..<boundary]), String(text[boundary...]))
    }
}

/// Plans the LIVE transcript interleave: which stream text segment renders
/// between which of the run's tool rows, so the streaming view shows the
/// same order as the finished transcript.
///
/// Invariant from the stream side: tool event k seals segment k, so segment
/// k is the text BEFORE tool k and the last segment is the growing tail.
/// Snapshot tool rows may GROUP several consecutive tool calls (the Mac
/// collapses back-to-back tools into one row) — `toolCounts[r]` says how
/// many calls row r covers, and the segments between them are empty by
/// construction (no text between back-to-back calls).
public enum StreamingInterleave {
    public enum Element: Equatable, Sendable {
        /// Index into the caller's tool-row list.
        case toolRow(index: Int)
        /// Index into the segment list; `isTail` marks the growing edge.
        case text(segmentIndex: Int, isTail: Bool)
    }

    public static func plan(segments: [String], toolCounts: [Int]) -> [Element] {
        var out: [Element] = []
        let lastIndex = segments.count - 1
        func pushText(_ index: Int) {
            guard index >= 0, index < segments.count else { return }
            let trimmed = segments[index].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            out.append(.text(segmentIndex: index, isTail: index == lastIndex))
        }
        // The stream saw `segments.count - 1` tool boundaries. If the
        // snapshot claims MORE tool calls than that, the stream missed
        // early history (app attached mid-run, or a provider that doesn't
        // emit tool markers) — alignment is unknowable, so fall back to
        // the legacy order: rows first, then the live text.
        let claimed = toolCounts.reduce(0) { $0 + max(1, $1) }
        if claimed > max(0, segments.count - 1) {
            for index in toolCounts.indices { out.append(.toolRow(index: index)) }
            for index in segments.indices { pushText(index) }
            return out
        }
        var cursor = 0
        for (rowIndex, rawCount) in toolCounts.enumerated() {
            pushText(cursor)
            out.append(.toolRow(index: rowIndex))
            let consumed = max(1, rawCount)
            // Segments the Mac grouped past are empty by construction —
            // but never drop real text if the stream disagrees.
            var skipped = cursor + 1
            while skipped < cursor + consumed, skipped < segments.count {
                pushText(skipped)
                skipped += 1
            }
            cursor += consumed
        }
        var index = cursor
        while index < segments.count {
            pushText(index)
            index += 1
        }
        return out
    }
}
