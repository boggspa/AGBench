import SwiftUI

/// Thread pane shown by `iPadDetailHost` when a thread is selected.
/// Mirrors the visual language of the desktop's `RunInspector.tsx`
/// (K1 Slice 1B): a tinted header card up top, then either the new
/// grouped-bubble transcript (primary) OR the dense classified
/// timeline (secondary "timeline" tab — kept for when scanning lots of
/// short events is more useful than reading the streaming bubbles).
///
/// The header reads from the existing iPad data — title, provider chip,
/// status pill, last-activity timestamp — and the body reads from
/// either the transcript store's grouped bubbles (primary tab) or the
/// raw event stream (timeline tab). When `mocked == true` and the
/// transcript is empty we render a soft "sample preview row" so the
/// pane teaches rather than displaying an empty box.
@available(iOS 17.0, macOS 14.0, *)
public struct iPadThreadPane: View {
    public let threadID: String
    public let thread: iPadThreadSummary?
    public let events: [BridgeRunEvent]
    public let transcriptStore: TranscriptStore?
    public let composerViewModel: ComposerViewModel?
    public let taskDetail: RemoteTaskDetail?
    public let mocked: Bool

    @State private var selectedTab: BodyTab = .transcript

    /// Which body section is showing — the new grouped transcript or the
    /// classified-event timeline. Defaults to transcript on entry.
    enum BodyTab: String, CaseIterable, Identifiable {
        case transcript
        case timeline

        var id: String { rawValue }
        var label: String {
            switch self {
            case .transcript: return "Transcript"
            case .timeline: return "Timeline"
            }
        }
        var systemImage: String {
            switch self {
            case .transcript: return "text.bubble.fill"
            case .timeline: return "list.bullet.indent"
            }
        }
    }

    public init(
        threadID: String,
        thread: iPadThreadSummary?,
        events: [BridgeRunEvent],
        transcriptStore: TranscriptStore? = nil,
        composerViewModel: ComposerViewModel? = nil,
        taskDetail: RemoteTaskDetail? = nil,
        mocked: Bool
    ) {
        self.threadID = threadID
        self.thread = thread
        self.events = events
        self.transcriptStore = transcriptStore
        self.composerViewModel = composerViewModel
        self.taskDetail = taskDetail
        self.mocked = mocked
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.section) {
            headerCard
            bodyTabPicker
            switch selectedTab {
            case .transcript:
                transcriptCard
            case .timeline:
                timelineCard
            }
            if let composerViewModel {
                iPadRemoteComposerDock(
                    viewModel: composerViewModel,
                    target: iPadRemoteComposerTarget(
                        threadID: threadID,
                        thread: thread,
                        taskDetail: taskDetail,
                        fallbackProvider: composerViewModel.provider
                    )
                )
            }
        }
        .padding(Theme.Spacing.screen)
    }

    @ViewBuilder
    private var bodyTabPicker: some View {
        Picker("View", selection: $selectedTab) {
            ForEach(BodyTab.allCases) { tab in
                Label(tab.label, systemImage: tab.systemImage).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, Theme.Spacing.tight)
    }

    @ViewBuilder
    private var transcriptCard: some View {
        let bubbleGroups = filteredTranscriptGroups
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            transcriptHeader(bubbleGroups.count)
            if bubbleGroups.isEmpty {
                emptyTranscriptState
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Theme.Spacing.control) {
                        ForEach(bubbleGroups) { group in
                            TranscriptBubbleRow(group: group)
                                .id(group.id)
                        }
                    }
                    .padding(.vertical, Theme.Spacing.tight)
                }
                .scrollIndicators(.hidden)
                .frame(maxHeight: .infinity)
            }
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
    }

    @ViewBuilder
    private func transcriptHeader(_ count: Int) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "text.bubble.fill")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.accent)
            Text("Conversation".uppercased())
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
            Spacer(minLength: 0)
            if count > 0 {
                Text("\(count) message\(count == 1 ? "" : "s")")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Theme.inputSurface, in: Capsule(style: .continuous))
            }
        }
    }

    @ViewBuilder
    private var emptyTranscriptState: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            HStack(spacing: Theme.Spacing.control) {
                Image(systemName: "text.bubble")
                    .font(Theme.Typography.iconMedium)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 44, height: 44)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("No messages yet")
                        .font(Theme.Typography.sectionTitle)
                        .foregroundStyle(Theme.primaryText)
                    Text("Assistant replies and tool activity stream in here once the desktop emits this thread's first run event.")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(3)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.vertical, Theme.Spacing.tight)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Bubble groups visible in this pane. When a transcript store is
    /// provided we use it (the new path). When it's nil we fall back to
    /// building groups on the fly from `events` so the pane keeps
    /// working in tests / previews that haven't wired the store yet.
    private var filteredTranscriptGroups: [TranscriptMessageGroup] {
        if let transcriptStore {
            return transcriptStore.groups
        }
        // Inline single-shot build matches the live store's coalescing
        // rule so the visual output is identical.
        let store = TranscriptStore()
        for event in events {
            store.ingest(event)
        }
        return store.groups
    }

    // MARK: - Resolved values

    private var resolvedTitle: String {
        if let projected = taskDetail?.task.displayTitle.trimmingCharacters(in: .whitespacesAndNewlines),
           !projected.isEmpty {
            return projected
        }
        let actual = thread?.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if let actual, !actual.isEmpty { return actual }
        return mocked ? iPadDetailSampleData.sampleThread().title : "Thread"
    }

    private var resolvedSubtitle: String {
        let projectedStatus = taskDetail?.task.status.rawValue
        if let projectedStatus, !projectedStatus.isEmpty { return projectedStatus }
        let actual = thread?.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if let actual, !actual.isEmpty { return actual }
        if mocked {
            return iPadDetailSampleData.sampleThread().subtitle
        }
        return "Live desktop run · waiting for first event"
    }

    private var resolvedProvider: String? {
        taskDetail?.task.provider ?? thread?.provider ?? (mocked ? iPadDetailSampleData.sampleThread().provider : nil)
    }

    private var resolvedLastActivity: Date {
        taskDetail?.task.updatedAt ?? thread?.lastActivityAt ?? (mocked ? iPadDetailSampleData.referenceDate : Date())
    }

    private var resolvedIsActive: Bool {
        taskDetail?.task.status.isActive ?? thread?.isActive ?? (mocked ? true : false)
    }

    private var providerTint: Color {
        iPadDetailProviderChip.tint(for: resolvedProvider)
    }

    // MARK: - Header

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            HStack(alignment: .top, spacing: Theme.Spacing.control) {
                ZStack {
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(providerTint.opacity(0.18))
                    Image(systemName: "text.bubble.fill")
                        .font(Theme.Typography.iconMedium)
                        .foregroundStyle(providerTint)
                }
                .frame(width: 52, height: 52)

                VStack(alignment: .leading, spacing: 6) {
                    Text(resolvedTitle)
                        .font(Theme.Typography.headline)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(2)
                    Text(resolvedSubtitle)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(2)
                    HStack(spacing: 6) {
                        iPadDetailProviderChip(provider: resolvedProvider)
                        statusPill
                        timestampPill
                    }
                }
                Spacer(minLength: Theme.Spacing.tight)
            }
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            // Subtle accent gradient stripe — visual cue that this pane is
            // the "current focus" run. Mirrors the K1 RunInspector header.
            ZStack(alignment: .top) {
                LinearGradient(
                    colors: [
                        providerTint.opacity(0.22),
                        providerTint.opacity(0.05),
                        .clear
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 78)
                .frame(maxWidth: .infinity, alignment: .top)
                .blendMode(.plusLighter)
            }
        }
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .accessibilityElement(children: .combine)
    }

    private var statusPill: some View {
        let tint: Color = resolvedIsActive ? Theme.success : Theme.tertiaryText
        let text = resolvedIsActive ? "running" : "idle"
        let glyph = resolvedIsActive ? "bolt.fill" : "pause.fill"
        return HStack(spacing: 4) {
            Image(systemName: glyph)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(tint)
            Text(text)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(tint)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(tint.opacity(0.14), in: Capsule(style: .continuous))
        .accessibilityLabel(resolvedIsActive ? "Status: running" : "Status: idle")
    }

    private var timestampPill: some View {
        HStack(spacing: 4) {
            Image(systemName: "clock")
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
            Text(resolvedLastActivity, style: .relative)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Theme.inputSurface, in: Capsule(style: .continuous))
        .accessibilityLabel("Last active")
    }

    // MARK: - Timeline

    private var timelineCard: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            timelineHeader
            if events.isEmpty {
                emptyTimelineState
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(events.enumerated()), id: \.offset) { offset, event in
                            iPadEventTimelineRow(
                                row: Self.classify(event: event),
                                showsDivider: offset < events.count - 1
                            )
                        }
                    }
                    .padding(.vertical, Theme.Spacing.tight)
                }
                .scrollIndicators(.hidden)
                .frame(maxHeight: .infinity)
            }
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
    }

    private var timelineHeader: some View {
        HStack(spacing: 6) {
            Image(systemName: "list.bullet.indent")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.accent)
            Text("Run timeline".uppercased())
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
            Spacer(minLength: 0)
            if !events.isEmpty {
                Text("\(events.count) event\(events.count == 1 ? "" : "s")")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Theme.inputSurface, in: Capsule(style: .continuous))
            }
        }
    }

    @ViewBuilder
    private var emptyTimelineState: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            HStack(spacing: Theme.Spacing.control) {
                Image(systemName: "waveform.path.ecg.rectangle")
                    .font(Theme.Typography.iconMedium)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 44, height: 44)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("No events yet")
                        .font(Theme.Typography.sectionTitle)
                        .foregroundStyle(Theme.primaryText)
                    Text("Tool calls, replies, approvals, and diffs will stream in here once the desktop publishes them.")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(3)
                }
                Spacer(minLength: 0)
            }
            // MOCK: sample preview row so users see what the timeline will look like.
            // TODO: drop once `events` is reliably non-empty in production builds.
            if mocked {
                Text("PREVIEW")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.tertiaryText)
                    .padding(.top, Theme.Spacing.tight)
                let row = Self.classify(mock: iPadDetailSampleData.sampleEventPreviewRow())
                iPadEventTimelineRow(row: row, showsDivider: false)
                    .opacity(0.85)
            }
        }
        .padding(.vertical, Theme.Spacing.tight)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Classification

    /// Convert a real `BridgeRunEvent` into the lightweight row model
    /// the timeline understands. Mirrors the kinds enumerated by the
    /// desktop's `classifyEventsForInspector`.
    static func classify(event: BridgeRunEvent) -> iPadEventTimelineRow.Model {
        let payload = event.payloadDictionary()
        let marker = (string(payload, keys: ["kind", "type", "event", "eventType", "payloadType"])?.lowercased()) ?? ""
        let provider = event.provider.isEmpty ? nil : event.provider

        // Path / file chip — first matching string we find.
        let path = string(payload, keys: ["path", "filePath", "relativePath"])

        // Channel takes precedence for lifecycle / error / exit.
        switch event.channel {
        case .agentExit, .geminiExit:
            let code = (payload?["code"] as? Int).map(String.init) ?? "—"
            return iPadEventTimelineRow.Model(
                publishedAt: event.publishedAt,
                kind: .providerExit,
                label: "Exit",
                summary: "exit code \(code)",
                path: nil,
                provider: provider
            )
        case .agentError, .geminiError:
            let text = string(payload, keys: ["text", "message", "error"]) ?? "provider error"
            return iPadEventTimelineRow.Model(
                publishedAt: event.publishedAt,
                kind: .providerError,
                label: "Error",
                summary: text,
                path: path,
                provider: provider
            )
        default:
            break
        }

        // Otherwise, use the payload marker to pick a kind.
        if marker.contains("approval") {
            if marker.contains("response") || marker.contains("decision") {
                let decision = string(payload, keys: ["decision"]) ?? "decided"
                return iPadEventTimelineRow.Model(
                    publishedAt: event.publishedAt,
                    kind: .approvalResponse,
                    label: "Decision",
                    summary: decision,
                    path: path,
                    provider: provider
                )
            }
            let summary = string(payload, keys: ["title", "summary", "toolName"]) ?? "Approval requested"
            return iPadEventTimelineRow.Model(
                publishedAt: event.publishedAt,
                kind: .approvalRequest,
                label: "Approval",
                summary: summary,
                path: path,
                provider: provider
            )
        }
        if marker.contains("diff") || marker.contains("patch") {
            return iPadEventTimelineRow.Model(
                publishedAt: event.publishedAt,
                kind: .diff,
                label: "Diff",
                summary: path ?? string(payload, keys: ["summary", "title"]) ?? "diff",
                path: path,
                provider: provider
            )
        }
        if marker.contains("file_edit") || marker.contains("fileedit") || marker.contains("edit") || marker.contains("write") {
            return iPadEventTimelineRow.Model(
                publishedAt: event.publishedAt,
                kind: .fileEdit,
                label: marker.contains("write") ? "Write" : "Edit",
                summary: path ?? string(payload, keys: ["summary", "title"]) ?? "file edit",
                path: path,
                provider: provider
            )
        }
        if marker.contains("subthread") || marker.contains("sub_thread") {
            let to = string(payload, keys: ["provider", "targetProvider"]) ?? provider ?? "provider"
            return iPadEventTimelineRow.Model(
                publishedAt: event.publishedAt,
                kind: .subThread,
                label: "Sub-thread",
                summary: "→ \(to)",
                path: nil,
                provider: to
            )
        }
        if marker.contains("tool") {
            let tool = string(payload, keys: ["toolName", "tool", "name"]) ?? "tool"
            return iPadEventTimelineRow.Model(
                publishedAt: event.publishedAt,
                kind: .tool,
                label: "Tool",
                summary: tool,
                path: path,
                provider: provider
            )
        }
        if marker.contains("reply") || marker.contains("response") || marker.contains("text") {
            let text = string(payload, keys: ["text", "summary", "message"]) ?? "reply"
            return iPadEventTimelineRow.Model(
                publishedAt: event.publishedAt,
                kind: .reply,
                label: "Reply",
                summary: text.replacingOccurrences(of: "\n", with: " "),
                path: nil,
                provider: provider
            )
        }
        if marker.contains("lifecycle") || marker.contains("status") || marker.contains("start") {
            let text = string(payload, keys: ["status", "phase", "text", "summary"]) ?? marker
            return iPadEventTimelineRow.Model(
                publishedAt: event.publishedAt,
                kind: .lifecycle,
                label: "Lifecycle",
                summary: text,
                path: nil,
                provider: provider
            )
        }

        // Fallback: surface whatever text we can find — keeps the timeline
        // honest about events we haven't taught it about yet.
        let fallbackText = string(payload, keys: ["text", "summary", "message"])
        let text = fallbackText ?? (marker.isEmpty ? "event" : marker)
        return iPadEventTimelineRow.Model(
            publishedAt: event.publishedAt,
            kind: .lifecycle,
            label: marker.isEmpty ? "Event" : marker,
            summary: text,
            path: path,
            provider: provider
        )
    }

    static func classify(mock: iPadDetailSampleData.EventRowMock) -> iPadEventTimelineRow.Model {
        let kind: iPadEventTimelineRow.Model.Kind
        switch mock.kind {
        case .lifecycle: kind = .lifecycle
        case .tool: kind = .tool
        case .reply: kind = .reply
        case .approvalRequest: kind = .approvalRequest
        case .approvalResponse: kind = .approvalResponse
        case .fileEdit: kind = .fileEdit
        case .diff: kind = .diff
        case .subThread: kind = .subThread
        case .providerError: kind = .providerError
        case .providerExit: kind = .providerExit
        }
        return iPadEventTimelineRow.Model(
            publishedAt: mock.publishedAt,
            kind: kind,
            label: mock.label,
            summary: mock.summary,
            path: mock.path,
            provider: mock.provider
        )
    }

    private static func string(_ payload: [String: Any]?, keys: [String]) -> String? {
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
}

// MARK: - Timeline row

/// One dense row in the K1-mirrored timeline.
///   `[ glyph ]  HH:mm:ss  [Kind label]  summary text…  [path chip]`
@available(iOS 17.0, macOS 14.0, *)
struct iPadEventTimelineRow: View {
    struct Model: Equatable {
        enum Kind: Equatable {
            case lifecycle
            case tool
            case reply
            case approvalRequest
            case approvalResponse
            case fileEdit
            case diff
            case subThread
            case providerError
            case providerExit
        }

        let publishedAt: Date
        let kind: Kind
        let label: String
        let summary: String
        let path: String?
        let provider: String?
    }

    let row: Model
    var showsDivider: Bool = true

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: Theme.Spacing.control) {
                glyphCircle
                Text(row.publishedAt, style: .time)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.tertiaryText)
                    .monospacedDigit()
                    .frame(width: 64, alignment: .leading)
                Text(row.label)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(kindTint)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(kindTint.opacity(0.14), in: Capsule(style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.summary)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(3)
                        .textSelection(.enabled)
                    if let path = row.path, !path.isEmpty {
                        pathChip(path)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, Theme.Spacing.tight)
            .padding(.horizontal, Theme.Spacing.tight)
            if showsDivider {
                Divider()
                    .overlay(Theme.separator.opacity(0.6))
                    .padding(.leading, 44)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.label) at \(row.publishedAt.formatted(date: .omitted, time: .shortened))")
        .accessibilityValue(row.summary)
    }

    private var glyphCircle: some View {
        Image(systemName: glyph)
            .font(Theme.Typography.smallCaption)
            .foregroundStyle(kindTint)
            .frame(width: 24, height: 24)
            .background(kindTint.opacity(0.14), in: Circle())
            .accessibilityHidden(true)
    }

    private func pathChip(_ path: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "doc.text")
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
            Text(path)
                .font(Theme.Typography.code)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Theme.inputSurface, in: Capsule(style: .continuous))
    }

    private var glyph: String {
        switch row.kind {
        case .lifecycle: return "circle.dashed"
        case .tool: return "wrench.adjustable.fill"
        case .reply: return "text.bubble.fill"
        case .approvalRequest: return "pause.circle.fill"
        case .approvalResponse: return "checkmark.circle.fill"
        case .fileEdit: return "square.and.pencil"
        case .diff: return "doc.text.magnifyingglass"
        case .subThread: return "arrow.turn.down.right"
        case .providerError: return "exclamationmark.triangle.fill"
        case .providerExit: return "stop.circle.fill"
        }
    }

    private var kindTint: Color {
        switch row.kind {
        case .lifecycle: return Theme.secondaryAccent
        case .tool: return Theme.accent
        case .reply: return Theme.accent
        case .approvalRequest: return Theme.warning
        case .approvalResponse: return Theme.success
        case .fileEdit: return Theme.accent
        case .diff: return Theme.accent
        case .subThread: return Theme.secondaryAccent
        case .providerError: return Theme.destructive
        case .providerExit: return Theme.success
        }
    }
}

// MARK: - Previews

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad thread pane — mocked") {
    let thread = iPadDetailSampleData.sampleThread()
    // Synthesize BridgeRunEvent rows from the deterministic mock data so
    // the preview exercises both the classifier and the timeline visuals.
    let events: [BridgeRunEvent] = iPadDetailSampleData.sampleEventRows.compactMap { row in
        let payload: [String: Any] = {
            var p: [String: Any] = [:]
            p["kind"] = previewKindMarker(for: row.kind)
            p["text"] = row.summary
            if let path = row.path { p["path"] = path }
            return p
        }()
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else {
            return nil
        }
        return BridgeRunEvent(
            channel: row.kind == .providerExit ? .agentExit : (row.kind == .providerError ? .agentError : .agentOutput),
            provider: row.provider ?? "claude",
            payloadJSON: data,
            publishedAt: row.publishedAt
        )
    }
    return iPadThreadPane(
        threadID: thread.id,
        thread: thread,
        events: events,
        mocked: true
    )
    .frame(minWidth: 540, minHeight: 720)
    .background(Theme.windowBase)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad thread pane — empty") {
    iPadThreadPane(
        threadID: "thread-empty",
        thread: nil,
        events: [],
        mocked: false
    )
    .frame(minWidth: 540, minHeight: 720)
    .background(Theme.windowBase)
}

@available(iOS 17.0, macOS 14.0, *)
private func previewKindMarker(for kind: iPadDetailSampleData.EventKind) -> String {
    switch kind {
    case .lifecycle: return "lifecycle"
    case .tool: return "tool"
    case .reply: return "reply"
    case .approvalRequest: return "approval_request"
    case .approvalResponse: return "approval_response"
    case .fileEdit: return "file_edit"
    case .diff: return "diff"
    case .subThread: return "subthread_spawned"
    case .providerError: return "provider_error"
    case .providerExit: return "provider_exit"
    }
}
