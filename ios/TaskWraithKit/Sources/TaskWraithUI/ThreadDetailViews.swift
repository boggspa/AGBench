// SwiftUI surface for the TaskWraith companion.
//
// Design direction (see ios/DESIGN.md): borrow the *format* of the Claude /
// Codex iOS apps — workspaces-as-projects home, thread view with collapsed
// history + tool chips, pill composer — but skinned entirely in TaskWraith's
// own theme tokens (TWTheme mirrors the desktop theme.css). iPhone focuses on
// solid thread management; iPad gets the sidebar (NavigationSplitView) where
// advanced affordances will live. Pure SwiftUI so `swift build` compile-checks
// on macOS; QR camera scanning is the one `#if os(iOS)` extra.

import SwiftUI
import TaskWraithKit

#if canImport(UIKit)
    import PhotosUI
    import UIKit
#endif

struct ThreadDetailView: View {
    @ObservedObject var model: RemoteSessionModel
    let taskId: String
    @State private var followUp = ""
    @State private var showInspector = false
    /// Follow the transcript tail as content streams in — disabled the
    /// moment the user drags, re-enabled by the jump-to-latest pill.
    @State private var autoFollow = true
    /// Secondary workspace granted to subsequent runs (rail picker).
    @State private var secondaryWorkspaceId: String? = nil

    private var card: RemoteTaskCard? { model.taskCards.first { $0.id == taskId } }
    private var snapshot: RemoteThreadSnapshot? { model.threadSnapshots[taskId] }
    private var thinkingProvider: String? {
        if let state = model.ensembleStates[taskId],
            let activeId = state.activeParticipantId
        {
            if let provider = state.participants?.first(where: { $0.participantId == activeId })?.provider,
                !provider.isEmpty
            {
                return provider
            }
            if let provider = state.roster?.first(where: { $0.id == activeId })?.provider,
                !provider.isEmpty
            {
                return provider
            }
        }
        return snapshot?.runSummary?.provider ?? card?.provider
    }
    private var thinkingModel: String? {
        guard let state = model.ensembleStates[taskId],
            let activeId = state.activeParticipantId,
            let model = state.roster?.first(where: { $0.id == activeId })?.model,
            !model.isEmpty
        else {
            return snapshot?.runSummary?.model
        }
        return model
    }
    private var isRunning: Bool {
        // The thread snapshot's runSummary refreshes un-throttled on every
        // flush — trust it over the (snapshot-throttled) task card when
        // both exist, or a stale 'running' card pins the thinking row
        // after completion.
        if let runStatus = snapshot?.runSummary?.status {
            return runStatus == "running"
        }
        return card?.status == "running"
    }
    /// While the live bubble streams a run, hide that run's in-flight
    /// snapshot assistant rows — the bubble has fresher text.
    private var visibleRows: [RemoteThreadSnapshot.Row] {
        let rows = snapshot?.rows ?? []
        guard let live = model.streamingTexts[taskId], !live.isEmpty,
            let liveRunId = model.streamingRunIds[taskId]
        else { return rows }
        return rows.filter { !($0.role == "assistant" && $0.runId == liveRunId) }
    }
    /// runId → id of that run's LAST visible row (cards anchor there).
    private var runLastRowIds: [String: String] {
        var out: [String: String] = [:]
        for row in visibleRows {
            if let runId = row.runId { out[runId] = row.id }
        }
        return out
    }

    /// The terminal summary to show after this row, if it's a run's last row.
    private func runCardSummary(after row: RemoteThreadSnapshot.Row)
        -> RemoteThreadSnapshot.RunSummary?
    {
        guard let runId = row.runId, runLastRowIds[runId] == row.id else { return nil }
        guard
            let summary = (snapshot?.runSummaries ?? [snapshot?.runSummary].compactMap { $0 })
                .first(where: { $0.runId == runId })
        else { return nil }
        let status = summary.status ?? ""
        guard status != "running", !status.isEmpty else { return nil }
        return summary
    }

    private var earlierCount: Int {
        guard let snapshot, snapshot.hasMoreAbove == true else { return 0 }
        return max(0, (snapshot.totalRows ?? 0) - (snapshot.rows?.count ?? 0))
    }

    var body: some View {
        ScrollViewReader { proxy in
            transcriptList(proxy: proxy)
        }
    }

    private func transcriptList(proxy: ScrollViewProxy) -> some View {
        // AnyView stage-breaks: the full modifier chain exceeded the
        // type-checker's budget once lifecycle modifiers joined it.
        toolbarChrome(
            AnyView(
                followChrome(
                    AnyView(navigationChrome(AnyView(listCore(proxy: proxy)), proxy: proxy)),
                    proxy: proxy)))
    }

    private func listCore(proxy: ScrollViewProxy) -> some View {
        List {
            let threadApprovals = model.approvals.filter { $0.threadId == taskId }
            if !threadApprovals.isEmpty {
                Section("Needs your approval") {
                    ForEach(threadApprovals, id: \.toolCallId) { approval in
                        ApprovalRow(model: model, card: approval)
                            .listRowBackground(TWTheme.surface2)
                    }
                }
            }
            let threadQuestions = model.questions.filter { $0.threadId == taskId }
            if !threadQuestions.isEmpty {
                Section("Questions") {
                    ForEach(threadQuestions, id: \.questionId) { question in
                        QuestionRow(model: model, card: question)
                            .listRowBackground(TWTheme.surface2)
                    }
                }
            }

            Section {
                if earlierCount > 0 {
                    Label("\(earlierCount) previous messages on your Mac", systemImage: "chevron.up")
                        .font(.caption)
                        .foregroundStyle(TWTheme.textTertiary)
                        .listRowBackground(Color.clear)
                }
                ForEach(visibleRows) { row in
                    ThreadRowView(
                        model: model, threadId: taskId,
                        row: model.resolvedRow(row, threadId: taskId),
                        threadProvider: card?.provider)
                        .listRowInsets(EdgeInsets(top: 2, leading: 12, bottom: 2, trailing: 12))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    // Desktop parity: each run's Task-complete card follows
                    // its final transcript row, persisting in the thread.
                    if let runCard = runCardSummary(after: row) {
                        TaskCompleteCard(
                            run: runCard,
                            diff: runCard.runId == snapshot?.runSummary?.runId
                                ? model.diffSummaries[taskId] : nil
                        )
                        .listRowInsets(
                            EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                }
                if let live = model.streamingTexts[taskId], !live.isEmpty {
                    StreamingRowView(
                        text: live,
                        provider: card?.provider,
                        model: snapshot?.runSummary?.model)
                        .listRowInsets(EdgeInsets(top: 2, leading: 12, bottom: 2, trailing: 12))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                } else if isRunning {
                    ThinkingRow(provider: thinkingProvider, model: thinkingModel)
                        .listRowInsets(EdgeInsets(top: 2, leading: 12, bottom: 2, trailing: 12))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                if (snapshot?.rows ?? []).isEmpty, let card {
                    if (snapshot?.totalRows ?? 0) > 0 {
                        // History exists on the Mac — the window just hasn't
                        // arrived. A welcome card here masquerades an old
                        // chat as new; show the fetch state instead.
                        HStack(spacing: 8) {
                            StreamingDots(color: TWTheme.chroma1)
                            Text("Loading transcript from your Mac…")
                                .font(.footnote)
                                .foregroundStyle(TWTheme.textSecondary)
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .padding(.vertical, 10)
                    } else {
                        ThreadWelcomeCard(card: card, model: model) { starter in
                            followUp = starter
                        }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }
                } else if (snapshot?.rows ?? []).isEmpty {
                    Text("No transcript yet.").foregroundStyle(TWTheme.textSecondary)
                        .listRowBackground(Color.clear)
                }
                if let run = snapshot?.runSummary, !isRunning,
                    runLastRowIds[run.runId ?? ""] == nil
                {
                    TaskCompleteCard(run: run, diff: model.diffSummaries[taskId])
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                Color.clear
                    .frame(height: 1)
                    .id("transcript-bottom")
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(TWTheme.appBg)
.overlay(alignment: .bottom) {
            // Jump-to-latest: centered just above the composer shell (the
            // trailing spot sat on top of the roster's + button). Black
            // circle, white arrow, white rim.
            if !autoFollow {
                Button {
                    autoFollow = true
                    withAnimation(.easeOut(duration: 0.25)) {
                        proxy.scrollTo("transcript-bottom", anchor: .bottom)
                    }
                } label: {
                    Image(systemName: "arrow.down")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Color.black.opacity(0.85)))
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
                        .shadow(color: .black.opacity(0.45), radius: 7, y: 2)
                }
                .buttonStyle(.plain)
                .padding(.bottom, 14)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // AnyView stage-break: the shell stack (banner + changes rows +
            // roster row + composer + rail) exceeds xcodebuild's stricter
            // type-check budget when inlined into the List chain.
            AnyView(composerShellStack)
        }
    }

    @ViewBuilder
    private var composerShellStack: some View {
            VStack(spacing: 4) {
                if let message = model.lastActionMessage, message != "Sent." {
                    StatusBanner(message: message) {
                        model.clearActionMessage()
                    }
                }
                if let card {
                    let diff = model.diffSummaries[taskId]
                    let hasDiff = (diff?.filesChanged ?? diff?.files?.count ?? 0) > 0
                    // Desktop composer-shell parity: attached diff header
                    // (rounded top), composer body, telemetry rail
                    // (rounded bottom) — one bordered container.
                    VStack(spacing: 0) {
                        if hasDiff, let diff {
                            if let breakdown = diff.workspaces, breakdown.count > 1 {
                                // One attached row per granted workspace
                                // (primary + secondary), desktop-style.
                                ForEach(breakdown) { workspace in
                                    WorkspaceChangesAttachedRow(
                                        breakdown: workspace,
                                        isFirst: workspace.id == breakdown.first?.id
                                    ) { showInspector = true }
                                    Rectangle().fill(TWTheme.border).frame(height: 1)
                                }
                            } else {
                                ChangesAttachedRow(diff: diff) { showInspector = true }
                                Rectangle().fill(TWTheme.border).frame(height: 1)
                            }
                        }
                        if card.isEnsemble,
                            let queued = model.ensembleStates[taskId]?.queuedPrompts,
                            !queued.isEmpty
                        {
                            // Stacked queued prompts (desktop parity) — one
                            // shared Mac-side queue, any-device origin.
                            QueuedPromptsStack(
                                model: model, card: card, prompts: queued,
                                isShellTop: !hasDiff)
                            Rectangle().fill(TWTheme.border).frame(height: 1)
                        }
                        if card.isEnsemble, let wsId = card.workspaceId {
                            // Roster row lives IN the shell, always under the
                            // changes row(s) — desktop composer parity.
                            EditableRosterStrip(
                                model: model, threadId: taskId, workspaceId: wsId,
                                attached: true,
                                isShellTop: !hasDiff
                                    && (model.ensembleStates[taskId]?.queuedPrompts ?? [])
                                        .isEmpty)
                            Rectangle().fill(TWTheme.border).frame(height: 1)
                        }
                        Composer(
                            model: model, card: card, runModel: snapshot?.runSummary?.model,
                            attachedTop: hasDiff || card.isEnsemble, attachedBottom: true,
                            extraWorkspaceIds: secondaryWorkspaceId.map { [$0] },
                            text: $followUp)
                        Rectangle().fill(TWTheme.border).frame(height: 1)
                        TelemetryFooterRail(
                            run: snapshot?.runSummary,
                            workspaceName: model.workspaceName(for: card.workspaceId),
                            workspaceOptions: model.workspaces.map {
                                (id: $0.id, name: $0.displayName)
                            },
                            primaryWorkspaceId: card.workspaceId,
                            secondaryWorkspaceId: $secondaryWorkspaceId)
                    }
                    .composerShellGlass()
                    .padding(.horizontal, 10).padding(.bottom, 6)
                }
            }
            .background(Color.clear)
    }

    private func navigationChrome(_ base: AnyView, proxy: ScrollViewProxy) -> some View {
        base
        .navigationTitle(card?.title ?? "Chat")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: taskId) {
            // On-demand transcript window — chats outside the recent-N
            // periodic snapshot have no rows until we ask. Also drop any
            // stale ack banner from the previously-open thread.
            model.clearActionMessage()
            model.visibleThreadId = taskId
            model.requestThreadSnapshot(taskId)
            autoFollow = true
            try? await Task.sleep(nanoseconds: 350_000_000)
            proxy.scrollTo("transcript-bottom", anchor: .bottom)
        }
        .onDisappear {
            if model.visibleThreadId == taskId { model.visibleThreadId = nil }
        }
    }

    private func followChrome(_ base: AnyView, proxy: ScrollViewProxy) -> some View {
        base
        .onChange(of: snapshot?.rows?.count ?? 0) { _, _ in
            guard autoFollow else { return }
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo("transcript-bottom", anchor: .bottom)
            }
        }
        .onChange(of: model.streamingTexts[taskId] ?? "") { _, _ in
            guard autoFollow else { return }
            proxy.scrollTo("transcript-bottom", anchor: .bottom)
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 14).onChanged { value in
                // An upward drag = the user is reading history; stop following.
                if value.translation.height > 0 { autoFollow = false }
            }
        )
        
    }

    private func toolbarChrome(_ base: AnyView) -> some View {
        base
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showInspector.toggle()
                } label: {
                    Label("Inspector", systemImage: "sidebar.right")
                }
            }
            if let card, card.status == "running" {
                ToolbarItem(placement: .primaryAction) {
                    Button(role: .destructive) {
                        model.cancelRun(card)
                    } label: {
                        Label("Stop", systemImage: "stop.circle")
                            .foregroundStyle(TWTheme.statusFailed)
                    }
                }
            }
        }
        .inspector(isPresented: $showInspector) {
            // iPad: right-hand panel; iPhone: presents as a sheet.
            ThreadInspector(model: model, threadId: taskId) { childId in
                showInspector = false
                // Drives the split-view selection on iPad; on iPhone the
                // sheet closes and the child is reachable from Home (a
                // path-based push from a nested detail is a later slice).
                model.navigationTarget = childId
            }
            .iPadSidebarInnerRim(edge: .leading)
            .inspectorColumnWidth(min: 300, ideal: 340, max: 420)
        }

    }
}

/// Satellite transcript row — inline label + body, no bubble chrome.
/// Provider parsed from a speaker label — "Codex · gpt-5.4" / "Gemini /
/// Researcher (2.5 Flash)" → accent color, mirroring the desktop's
/// provider-tinted transcript names.
@MainActor func providerAccentFromSpeaker(_ speaker: String?, fallback: Color) -> Color {
    guard let speaker, !speaker.isEmpty else { return fallback }
    let head = speaker.split(whereSeparator: { $0 == "·" || $0 == "/" }).first.map {
        String($0).trimmingCharacters(in: .whitespaces)
    }
    guard let head, !head.isEmpty else { return fallback }
    let known = ["gemini", "codex", "claude", "kimi", "grok", "cursor", "ollama", "qwen"]
    guard known.contains(head.lowercased()) else { return fallback }
    return TWTheme.providerAccent(head.lowercased())
}

struct ThreadRowView: View {
    @ObservedObject var model: RemoteSessionModel
    let threadId: String
    let row: RemoteThreadSnapshot.Row
    var threadProvider: String? = nil

    private var isUser: Bool { row.role == "user" }
    private var isTool: Bool { row.role == "tool" || row.kind == "tool" }
    private var showExpand: Bool { row.truncated == true }
    private var isExpanding: Bool { model.expandingRows.contains(row.id) }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if !isUser {
                Circle()
                    .fill(accentColor)
                    .frame(width: 6, height: 6)
                    .padding(.top, 7)
            } else {
                Color.clear.frame(width: 6, height: 6)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(labelColor)
                if let tools = row.toolSummary, let count = tools.activityCount, count > 0 {
                    if let entries = tools.tools, !entries.isEmpty {
                        ToolActivityCards(
                            entries: entries, totalCount: count, status: tools.status)
                    } else {
                        HStack(spacing: 5) {
                            Image(systemName: "wrench.and.screwdriver")
                            Text(toolLine(count: count, status: tools.status))
                            if let status = tools.status {
                                Circle().fill(TWTheme.statusColor(status))
                                    .frame(width: 5, height: 5)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(TWTheme.textTertiary)
                    }
                }
                if let count = row.imageAttachmentCount, count > 0 {
                    HStack(spacing: 5) {
                        Image(systemName: "photo.on.rectangle.angled")
                        Text("\(count) image\(count == 1 ? "" : "s") attached")
                    }
                    .font(.caption)
                    .foregroundStyle(TWTheme.textTertiary)
                }
                if let preview = row.preview, !preview.isEmpty {
                    MarkdownLite(
                        preview,
                        participants: model.ensembleStates[threadId]?.participants ?? [],
                        baseColor: bodyColor
                    )
                    .textSelection(.enabled)
                    .contextMenu {
                        if let card = model.taskCards.first(where: { $0.id == threadId }) {
                            Button {
                                model.toggleMessagePin(card, messageId: row.id, pinned: true)
                            } label: {
                                Label("Pin message", systemImage: "pin")
                            }
                        }
                    }
                }
                if showExpand {
                    Button {
                        model.expandRow(threadId: threadId, rowId: row.id)
                    } label: {
                        if isExpanding {
                            Text("Loading…")
                        } else {
                            Text("Show more")
                        }
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TWTheme.chroma1)
                    .disabled(isExpanding)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 5)
    }

    private func toolLine(count: Int, status: String?) -> String {
        let noun = "\(count) tool\(count == 1 ? "" : "s")"
        if let status, !status.isEmpty {
            return "\(noun) · \(status)"
        }
        return noun
    }

    private var label: String {
        if let speaker = row.speaker, !speaker.isEmpty { return speaker }
        switch row.role {
        case "user": return "You"
        case "assistant": return "Assistant"
        case "tool": return "Tools"
        case "error": return "Error"
        case "system": return "System"
        default: return row.kind ?? row.role ?? "Message"
        }
    }

    private var accentColor: Color {
        if row.speaker != nil {
            return providerAccentFromSpeaker(row.speaker, fallback: TWTheme.chroma2)
        }
        if isTool { return TWTheme.textTertiary }
        if row.role == "assistant", let threadProvider {
            return TWTheme.providerAccent(threadProvider)
        }
        return TWTheme.textSecondary
    }

    private var labelColor: Color {
        if row.speaker != nil {
            return providerAccentFromSpeaker(row.speaker, fallback: TWTheme.chroma2)
        }
        switch row.role {
        case "user": return TWTheme.chroma1
        case "error": return TWTheme.statusFailed
        case "tool": return TWTheme.textTertiary
        case "assistant":
            if let threadProvider { return TWTheme.providerAccent(threadProvider) }
            return TWTheme.textSecondary
        default: return TWTheme.textSecondary
        }
    }

    private var bodyColor: Color {
        if row.kind == "attention" { return TWTheme.statusAttention }
        if row.role == "error" { return TWTheme.statusFailed }
        return TWTheme.textPrimary
    }
}

/// Token-level live assistant bubble — grows as bridge.runEvent content
/// deltas arrive, superseding the in-flight snapshot row until the run
/// exits and the final snapshot takes over.

struct StreamingRowView: View {
    let text: String
    let provider: String?
    var model: String? = nil

    private var accent: Color { TWTheme.providerAccent(provider) }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle().fill(accent).frame(width: 6, height: 6).padding(.top, 7)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Text(
                        model.map { "\(TWTheme.providerLabel(provider)) · \($0)" }
                            ?? TWTheme.providerLabel(provider)
                    )
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(accent)
                    StreamingDots(color: accent)
                }
                TokenRevealText(
                    target: text,
                    font: TWFont.transcript(),
                    color: TWTheme.textPrimary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 5)
    }
}

/// "Thinking…" indicator shown while a run is active but no content has
/// streamed yet — replaces the static status chip during runs (desktop
/// parity with the transcript's thinking element).

struct ThinkingRow: View {
    let provider: String?
    var model: String? = nil

    private var accent: Color { TWTheme.providerAccent(provider) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(TWTheme.providerLabel(provider))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(accent)
                if let model, !model.isEmpty {
                    Text(model)
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)
                        .foregroundStyle(TWTheme.textTertiary)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(TWTheme.surface3, in: Capsule())
                }
            }
            HStack(alignment: .center, spacing: 8) {
                ShimmerThinkingText()
                StreamingDots(color: TWTheme.textSecondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 5)
    }
}

/// Desktop-style shimmer sweep for the transcript's in-flight "Thinking" label.
struct ShimmerThinkingText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1.2

    var body: some View {
        Group {
            if reduceMotion {
                Text("Thinking")
                    .font(TWFont.transcript(16, weight: .medium))
                    .foregroundStyle(TWTheme.textPrimary)
            } else {
                Text("Thinking")
                    .font(TWFont.transcript(16, weight: .medium))
                    .foregroundStyle(
                        LinearGradient(
                            stops: [
                                .init(color: TWTheme.textSecondary.opacity(0.7), location: 0.0),
                                .init(color: TWTheme.textSecondary.opacity(0.7), location: 0.35),
                                .init(color: TWTheme.textPrimary, location: 0.5),
                                .init(color: TWTheme.textSecondary.opacity(0.7), location: 0.65),
                                .init(color: TWTheme.textSecondary.opacity(0.7), location: 1.0)
                            ],
                            startPoint: UnitPoint(x: phase, y: 0.5),
                            endPoint: UnitPoint(x: phase + 1.0, y: 0.5)
                        )
                    )
                    .onAppear {
                        phase = -1.2
                        withAnimation(.linear(duration: 2.4).repeatForever(autoreverses: false)) {
                            phase = 1.2
                        }
                    }
            }
        }
    }
}

/// Three-dot pulse used by the thinking + streaming indicators.

struct StreamingDots: View {
    let color: Color
    @State private var phase = false

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(color)
                    .frame(width: 4, height: 4)
                    .opacity(phase ? 0.25 : 1)
                    .animation(
                        .easeInOut(duration: 0.6)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.2),
                        value: phase)
            }
        }
        .onAppear { phase = true }
    }
}

/// Live ensemble roster — desktop composer roster-chip parity: one chip
/// per participant, provider-tinted, active speaker highlighted.
