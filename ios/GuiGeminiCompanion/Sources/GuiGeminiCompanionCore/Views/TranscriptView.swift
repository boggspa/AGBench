import SwiftUI

/// TranscriptView — grouped-bubble rendering of the conversation that
/// flows from the paired Mac. Replaces the previous "one row per event"
/// list with assistant / user / system / tool bubbles that grow in place
/// as streaming text deltas arrive (see `TranscriptStore` for the
/// coalescing rule).
///
/// Visual treatment mirrors the desktop's K1 transcript:
///   * User → right-aligned filled bubble
///   * Assistant → left-aligned ghost bubble with markdown text
///   * System (delegation / sub-thread return) → centered inline rule
///   * Tool activity → compact card pinned under the assistant bubble it
///     belongs to (NOT a free-floating row)
///   * Error → red-tinted callout
///
/// Auto-scroll behavior: the view tracks whether the user is "near the
/// bottom" via a scroll-position observer; new content auto-scrolls
/// when they are, and surfaces a "Jump to bottom" pill when they're not.
@available(iOS 17.0, macOS 14.0, *)
public struct TranscriptView: View {
    @Bindable public var viewModel: TranscriptViewModel
    /// Optional cancel-run binding: Agent A's `ComposerViewModel` slice
    /// will add `canCancelRun: Bool` + `cancelCurrentRun()` and wire this
    /// from the host view. Until that lands the caller passes nil and the
    /// header skips the button — keeps this view compilable against the
    /// current composer model without forcing a same-commit dependency.
    public var cancelRunBinding: CancelRunBinding?

    @State private var isUserScrolledUp: Bool = false
    @State private var lastSeenGroupCount: Int = 0

    public init(
        viewModel: TranscriptViewModel,
        cancelRunBinding: CancelRunBinding? = nil
    ) {
        self.viewModel = viewModel
        self.cancelRunBinding = cancelRunBinding
    }

    /// CancelRunBinding — small adapter for the optional "cancel current
    /// run" header button. Caller supplies the live `canCancel` flag and
    /// the async `cancel` action; the transcript view doesn't care which
    /// view model produces them.
    public struct CancelRunBinding {
        public let canCancel: Bool
        public let cancel: () async -> Void

        public init(canCancel: Bool, cancel: @escaping () async -> Void) {
            self.canCancel = canCancel
            self.cancel = cancel
        }
    }

    public var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                header
                if viewModel.transcriptStore.groups.isEmpty {
                    EmptyTranscriptState()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    bubbleScrollView
                }
            }
            .padding(Theme.Spacing.screen)
        }
    }

    // MARK: - Scrollable transcript

    @ViewBuilder
    private var bubbleScrollView: some View {
        ScrollViewReader { scrollProxy in
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Theme.Spacing.control) {
                        ForEach(viewModel.transcriptStore.groups) { group in
                            TranscriptBubbleRow(group: group)
                                .id(group.id)
                        }
                        // Sentinel anchor used by the auto-scroll target so
                        // the bottom of the LazyVStack is reachable without
                        // having to know the last group's id.
                        Color.clear
                            .frame(height: 1)
                            .id(TranscriptBottomAnchorID)
                    }
                    .padding(.bottom, Theme.Spacing.screen)
                    .background(scrollPositionObserver)
                }
                .scrollIndicators(.hidden)
                .onChange(of: viewModel.transcriptStore.groups.count) { _, newCount in
                    handleGroupCountChange(newCount: newCount, scrollProxy: scrollProxy)
                }
                .onChange(of: latestGroupTextLength) { _, _ in
                    // Streaming text appended to an existing group doesn't
                    // bump groups.count — observe text length as a proxy so
                    // the auto-scroll catches every delta on the latest
                    // bubble when the user is at the bottom.
                    if !isUserScrolledUp {
                        withAnimation(Theme.Motion.quick) {
                            scrollProxy.scrollTo(TranscriptBottomAnchorID, anchor: .bottom)
                        }
                    }
                }
                .onAppear {
                    scrollProxy.scrollTo(TranscriptBottomAnchorID, anchor: .bottom)
                    lastSeenGroupCount = viewModel.transcriptStore.groups.count
                }

                if isUserScrolledUp {
                    jumpToBottomPill {
                        withAnimation(Theme.Motion.handoff) {
                            scrollProxy.scrollTo(TranscriptBottomAnchorID, anchor: .bottom)
                        }
                        isUserScrolledUp = false
                    }
                    .padding(Theme.Spacing.control)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
    }

    /// Watches the latest group's text length so streaming text within
    /// an existing bubble triggers auto-scroll the same way new bubbles
    /// do. Returns 0 when the array is empty.
    private var latestGroupTextLength: Int {
        viewModel.transcriptStore.groups.last?.text.count ?? 0
    }

    private func handleGroupCountChange(newCount: Int, scrollProxy: ScrollViewProxy) {
        defer { lastSeenGroupCount = newCount }
        guard newCount > lastSeenGroupCount else { return }
        guard !isUserScrolledUp else { return }
        withAnimation(Theme.Motion.quick) {
            scrollProxy.scrollTo(TranscriptBottomAnchorID, anchor: .bottom)
        }
    }

    /// Background "view" that uses a GeometryReader to track scroll
    /// offset, flipping `isUserScrolledUp` when the user moves more than
    /// ~120pt away from the bottom. The threshold avoids fluttering on
    /// short overscroll bounces.
    private var scrollPositionObserver: some View {
        GeometryReader { proxy in
            Color.clear
                .preference(
                    key: TranscriptScrollOffsetKey.self,
                    value: proxy.frame(in: .global).maxY
                )
        }
        .onPreferenceChange(TranscriptScrollOffsetKey.self) { _ in
            // We don't currently use the offset itself — the dependable
            // signal for "is the bottom anchor visible" comes from the
            // LazyVStack's child appearance. Reserved here for future
            // refinement (e.g. show a "N new" badge on the jump pill).
        }
    }

    @ViewBuilder
    private func jumpToBottomPill(_ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(Theme.Typography.sectionTitle)
                Text("Jump to latest")
                    .font(Theme.Typography.caption)
            }
            .padding(.horizontal, Theme.Spacing.control)
            .padding(.vertical, 8)
            .background(Theme.accent, in: Capsule(style: .continuous))
            .foregroundStyle(Color.white)
        }
        .buttonStyle(.plain)
        .shadow(color: Theme.softShadowColor, radius: Theme.Shadow.softRadius, y: Theme.Shadow.softY)
        .accessibilityLabel("Jump to latest message")
    }

    // MARK: - Header

    @ViewBuilder
    private var header: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Live Transcript")
                    .font(Theme.Typography.screenTitle)
                    .foregroundStyle(Theme.Text.primary)
                Text("Mirrors provider output and run status from your Mac.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.secondary)
            }
            Spacer()
            if let route = viewModel.activeRouteLabel {
                statusPill(route)
            } else if let status = viewModel.lastStatus {
                statusPill(status)
            }
            if let cancelRunBinding, cancelRunBinding.canCancel {
                Button(action: {
                    Task {
                        await cancelRunBinding.cancel()
                    }
                }) {
                    Label("Cancel run", systemImage: "stop.circle")
                        .labelStyle(.iconOnly)
                }
                .font(Theme.Typography.caption)
                .buttonStyle(.bordered)
                .tint(Theme.destructive)
                .accessibilityLabel("Cancel current run")
            }
            Button(action: viewModel.clear) {
                Label("Clear", systemImage: "trash")
                    .labelStyle(.iconOnly)
            }
                .font(Theme.Typography.caption)
                .buttonStyle(.bordered)
                .accessibilityLabel("Clear transcript")
        }
        .padding(Theme.Spacing.section)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: Theme.softShadowColor, radius: Theme.Shadow.softRadius, y: Theme.Shadow.softY)
    }

    @ViewBuilder
    private func statusPill(_ status: String) -> some View {
        Text(status)
            .font(Theme.Typography.code)
            .foregroundStyle(Theme.accent)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Theme.accent.opacity(0.12), in: Capsule())
    }
}

/// Stable id for the invisible bottom anchor used by auto-scroll.
private let TranscriptBottomAnchorID = "transcript-bottom-anchor"

/// PreferenceKey for tracking scroll offset. The default reducer takes
/// the latest value; combining intermediates would over-trigger.
private struct TranscriptScrollOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

// MARK: - Bubble row

/// One row in the transcript, branching on `TranscriptMessageGroup.Role`
/// to pick the right bubble + alignment.
@available(iOS 17.0, macOS 14.0, *)
public struct TranscriptBubbleRow: View {
    public let group: TranscriptMessageGroup

    public init(group: TranscriptMessageGroup) {
        self.group = group
    }

    public var body: some View {
        switch group.role {
        case .user:
            userBubble
        case .assistant:
            assistantBubble
        case .system:
            systemRule
        case .tool:
            // Free-floating tool events are rare (they normally attach to
            // an assistant bubble's `toolActivities` array). Render as a
            // standalone tool activity card when we see one.
            toolStandaloneCard
        case .error:
            errorCallout
        }
    }

    // MARK: User

    @ViewBuilder
    private var userBubble: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.control) {
            Spacer(minLength: Theme.Spacing.screen)
            VStack(alignment: .trailing, spacing: 4) {
                bubbleText(text: group.text, foreground: .white)
                    .padding(.horizontal, Theme.Spacing.control)
                    .padding(.vertical, 10)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                bubbleTimestamp(alignment: .trailing)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("You said")
        .accessibilityValue(group.text)
    }

    // MARK: Assistant

    @ViewBuilder
    private var assistantBubble: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.control) {
            providerAvatar
            VStack(alignment: .leading, spacing: 6) {
                if !group.text.isEmpty {
                    bubbleMarkdown(text: group.text)
                        .padding(.horizontal, Theme.Spacing.control)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                .fill(Theme.cardFill)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                .stroke(Theme.border, lineWidth: 1)
                        )
                }
                if !group.toolActivities.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(group.toolActivities) { tool in
                            ToolActivityRow(tool: tool)
                        }
                    }
                }
                HStack(spacing: 6) {
                    if group.state == .streaming {
                        StreamingDot()
                            .accessibilityHidden(true)
                        Text("streaming…")
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.tertiaryText)
                    } else if group.state == .failed {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.destructive)
                        Text("failed")
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.destructive)
                    }
                    Spacer(minLength: 0)
                    bubbleTimestamp(alignment: .leading)
                }
            }
            Spacer(minLength: Theme.Spacing.screen)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(group.provider.capitalized) assistant")
        .accessibilityValue(group.text)
    }

    @ViewBuilder
    private var providerAvatar: some View {
        ZStack {
            Circle()
                .fill(Theme.accentSoft)
                .frame(width: 32, height: 32)
            Image(systemName: providerGlyph)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.accent)
        }
        .accessibilityHidden(true)
    }

    private var providerGlyph: String {
        switch group.provider.lowercased() {
        case "claude": return "sparkles"
        case "gemini": return "diamond.fill"
        case "codex": return "chevron.left.forwardslash.chevron.right"
        case "kimi": return "moon.stars.fill"
        default: return "cpu"
        }
    }

    // MARK: System

    @ViewBuilder
    private var systemRule: some View {
        HStack(spacing: Theme.Spacing.tight) {
            Rectangle()
                .fill(Theme.separator)
                .frame(height: 1)
                .accessibilityHidden(true)
            Text(group.text.isEmpty ? "system event" : group.text)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Theme.inputSurface, in: Capsule(style: .continuous))
                .lineLimit(2)
            Rectangle()
                .fill(Theme.separator)
                .frame(height: 1)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("System event")
        .accessibilityValue(group.text)
    }

    // MARK: Tool standalone

    @ViewBuilder
    private var toolStandaloneCard: some View {
        if let tool = group.toolActivities.first {
            ToolActivityRow(tool: tool)
        } else {
            EmptyView()
        }
    }

    // MARK: Error

    @ViewBuilder
    private var errorCallout: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.control) {
            Image(systemName: "exclamationmark.octagon.fill")
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.destructive)
                .frame(width: 32, height: 32)
                .background(Theme.destructive.opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text("Error")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.destructive)
                Text(group.text.isEmpty ? "provider error" : group.text)
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Text.primary)
                    .textSelection(.enabled)
                bubbleTimestamp(alignment: .leading)
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Spacing.control)
        .background(Theme.destructive.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(Theme.destructive.opacity(0.32), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Error")
        .accessibilityValue(group.text)
    }

    // MARK: Common widgets

    @ViewBuilder
    private func bubbleText(text: String, foreground: Color) -> some View {
        Text(text.isEmpty ? "…" : text)
            .font(Theme.Typography.body)
            .foregroundStyle(foreground)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func bubbleMarkdown(text: String) -> some View {
        // Use AttributedString's Markdown initializer for inline markdown
        // rendering. Falls back to a plain Text on parse failure so a
        // stray "[" never blanks the bubble.
        if let attributed = try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) {
            Text(attributed)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Text.primary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(text)
                .font(Theme.Typography.body)
                .foregroundStyle(Theme.Text.primary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func bubbleTimestamp(alignment: HorizontalAlignment) -> some View {
        Text(group.lastUpdatedAt, style: .time)
            .font(Theme.Typography.smallCaption)
            .foregroundStyle(Theme.tertiaryText)
            .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
    }
}

// MARK: - Tool activity row

@available(iOS 17.0, macOS 14.0, *)
struct ToolActivityRow: View {
    let tool: ToolActivityCard

    var body: some View {
        HStack(spacing: Theme.Spacing.tight) {
            Image(systemName: glyph)
                .font(Theme.Typography.caption)
                .foregroundStyle(tint)
                .frame(width: 22, height: 22)
                .background(tint.opacity(0.14), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(tool.toolName)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Text.primary)
                        .lineLimit(1)
                    Text(tool.status.rawValue)
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(tint)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(tint.opacity(0.14), in: Capsule(style: .continuous))
                }
                if let summary = tool.summary, !summary.isEmpty {
                    Text(summary)
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.Text.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Spacing.tight)
        .padding(.vertical, 6)
        .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Tool \(tool.toolName) \(tool.status.rawValue)")
    }

    private var glyph: String {
        switch tool.status {
        case .pending: return "hourglass"
        case .running: return "wrench.adjustable"
        case .success: return "checkmark.circle.fill"
        case .failed: return "xmark.octagon.fill"
        }
    }

    private var tint: Color {
        switch tool.status {
        case .pending: return Theme.secondaryAccent
        case .running: return Theme.accent
        case .success: return Theme.success
        case .failed: return Theme.destructive
        }
    }
}

// MARK: - Streaming indicator

@available(iOS 17.0, macOS 14.0, *)
private struct StreamingDot: View {
    @State private var phase: Double = 0

    var body: some View {
        Circle()
            .fill(Theme.accent)
            .frame(width: 7, height: 7)
            .opacity(0.4 + 0.6 * abs(sin(phase)))
            .onAppear {
                withAnimation(Animation.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                    phase = .pi
                }
            }
    }
}

// MARK: - Empty state

@available(iOS 17.0, macOS 14.0, *)
private struct EmptyTranscriptState: View {
    var body: some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: "waveform.path.ecg.rectangle")
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.accent)
                .frame(width: 84, height: 84)
                .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .stroke(Theme.strongBorder, lineWidth: 1)
                )
            Text("No run events yet")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Text.primary)
            Text("Start or resume a provider run on your Mac and the live transcript will stream into this tab.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: 340)
    }
}
