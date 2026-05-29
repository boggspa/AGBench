import SwiftUI

/// ComposerView — iPhone-minimal new-turn composer. Lets the user pick
/// workspace + provider + approvalMode + model + contextTurns and type
/// a prompt, then sends as a `composerPrompt` action.
///
/// Allowlist pickers: when a `sidebarStore` is supplied and it has at
/// least one workspace, the workspace + thread fields render as `Menu`
/// pickers backed by the live sidebar lists (which are populated from
/// the desktop's `workspaceList` / `threadList` bridge broadcasts).
/// Threads filter to the selected workspace. When the store is empty
/// or nil, both fields fall back to the original free-text inputs so
/// the user can type an id manually — useful on first connect before
/// summaries arrive. A small "type id manually" toggle inside each
/// picker also lets users opt out of the picker explicitly for ids
/// that haven't been broadcast yet.
@available(iOS 17.0, macOS 14.0, *)
public struct ComposerView: View {
    @Bindable public var viewModel: ComposerViewModel
    /// Optional sidebar store. When non-nil and populated, the workspace
    /// + thread fields render as `Menu` pickers; when nil or empty, they
    /// fall back to the original `themedTextField` free-text inputs.
    @Bindable private var sidebarStoreOrEmpty: iPadSidebarStore
    private let hasSidebarStore: Bool
    @FocusState private var promptFocused: Bool

    /// Local overrides letting the user "type id manually" even when the
    /// sidebar lists would normally drive a Menu picker. Resets when the
    /// user picks an item from the menu.
    @State private var workspaceManualOverride: Bool = false
    @State private var threadManualOverride: Bool = false

    public init(
        viewModel: ComposerViewModel,
        sidebarStore: iPadSidebarStore? = nil
    ) {
        self.viewModel = viewModel
        self.sidebarStoreOrEmpty = sidebarStore ?? iPadSidebarStore()
        self.hasSidebarStore = sidebarStore != nil
    }

    public var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                    if isEmptyDraft {
                        composeEmptyState
                    }
                    composerSection(title: "Target", systemImage: "scope") {
                        workspaceField
                        threadField
                    }
                    composerSection(title: "Provider", systemImage: "cpu") {
                        pickerBlock(title: "Provider") {
                            Picker("Provider", selection: $viewModel.provider) {
                                Text("Gemini").tag("gemini")
                                Text("Codex").tag("codex")
                                Text("Claude").tag("claude")
                                Text("Kimi").tag("kimi")
                                Text("Grok").tag("grok")
                                Text("Cursor").tag("cursor")
                            }
                            // Six providers overflow a segmented control, so
                            // this picker uses `.menu` (matching
                            // SubThreadCreatorView's provider picker). The
                            // Approval-mode picker below keeps `.segmented`
                            // since it still only has two options.
                            .pickerStyle(.menu)
                        }
                        pickerBlock(title: "Approval mode") {
                            Picker("Approval mode", selection: $viewModel.approvalMode) {
                                Text("Default").tag("default")
                                Text("Plan").tag("plan")
                            }
                            .pickerStyle(.segmented)
                        }
                        themedTextField("Model (optional)", text: $viewModel.model)
                        Stepper("Context turns: \(viewModel.contextTurns)", value: $viewModel.contextTurns, in: 0...20)
                            .font(Theme.Typography.callout)
                            .padding(Theme.Spacing.control)
                            .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                    }
                    composerSection(title: "Prompt", systemImage: "text.cursor") {
                        promptEditor
                    }
                    sendSurface
                }
                .padding(Theme.Spacing.screen)
            }
            .scrollIndicators(.hidden)
        }
    }

    private var isEmptyDraft: Bool {
        viewModel.workspaceId.isEmpty
            && viewModel.threadId.isEmpty
            && viewModel.prompt.isEmpty
            && viewModel.model.isEmpty
    }

    private var sendDisabled: Bool {
        viewModel.prompt.isEmpty || viewModel.workspaceId.isEmpty || viewModel.threadId.isEmpty
    }

    @ViewBuilder
    private var composeEmptyState: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.control) {
            Image(systemName: "sparkles.rectangle.stack")
                .font(Theme.Typography.iconMedium)
                .foregroundStyle(Theme.accent)
                .frame(width: 58, height: 58)
                .background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            VStack(alignment: .leading, spacing: 6) {
                Text("Ready for a new turn")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Text.primary)
                Text("Set the target, choose a provider, and draft the prompt you want to send to the paired Mac.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Text.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
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
    private func composerSection<Content: View>(
        title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            Label(title, systemImage: systemImage)
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.Text.primary)
            content()
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
    private func themedTextField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Text.secondary)
            TextField(title, text: text)
                .font(Theme.Typography.body)
                .textFieldStyle(.plain)
                .modifier(NoAutocapModifier())
                .padding(Theme.Spacing.control)
                .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
        }
    }

    // MARK: - Workspace + thread pickers (allowlist driven)

    /// True when the sidebar store is non-nil AND has at least one
    /// workspace summary (meaning the desktop has broadcast its allowlist).
    private var workspacePickerAvailable: Bool {
        hasSidebarStore && !sidebarStoreOrEmpty.workspaces.isEmpty
    }

    private var threadPickerAvailable: Bool {
        hasSidebarStore && !scopedThreads.isEmpty
    }

    /// Threads filtered to the currently-selected workspace. Falls back to
    /// the full thread list when no workspace is picked yet so the user
    /// isn't blocked by ordering.
    private var scopedThreads: [iPadThreadSummary] {
        let trimmed = viewModel.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return sidebarStoreOrEmpty.threads
        }
        return sidebarStoreOrEmpty.threads.filter { $0.workspaceID == trimmed }
    }

    @ViewBuilder
    private var workspaceField: some View {
        if workspacePickerAvailable && !workspaceManualOverride {
            VStack(alignment: .leading, spacing: 6) {
                Text("Workspace")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.secondary)
                Menu {
                    ForEach(sidebarStoreOrEmpty.workspaces, id: \.id) { workspace in
                        Button {
                            viewModel.workspaceId = workspace.id
                            // Selecting a new workspace can orphan the
                            // current thread id (no longer in scope); clear
                            // only when the chosen workspace doesn't carry it.
                            if !sidebarStoreOrEmpty.threads.contains(where: {
                                $0.workspaceID == workspace.id && $0.id == viewModel.threadId
                            }) {
                                // Leave threadId alone so a manual entry
                                // survives — only the picker UI re-filters.
                            }
                        } label: {
                            menuRowLabel(
                                title: workspace.displayName,
                                subtitle: workspace.pathDisplayHint,
                                selected: viewModel.workspaceId == workspace.id
                            )
                        }
                    }
                    Divider()
                    Button {
                        workspaceManualOverride = true
                    } label: {
                        Label("Type id manually", systemImage: "keyboard")
                    }
                } label: {
                    pickerLabel(
                        systemImage: "folder",
                        title: resolvedWorkspaceLabel,
                        placeholder: "Choose workspace"
                    )
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                themedTextField("Workspace id", text: $viewModel.workspaceId)
                if workspacePickerAvailable && workspaceManualOverride {
                    Button {
                        workspaceManualOverride = false
                    } label: {
                        Label("Use workspace list", systemImage: "list.bullet.rectangle")
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.accent)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private var threadField: some View {
        if threadPickerAvailable && !threadManualOverride {
            VStack(alignment: .leading, spacing: 6) {
                Text("Thread")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.secondary)
                Menu {
                    ForEach(scopedThreads, id: \.id) { thread in
                        Button {
                            viewModel.threadId = thread.id
                            // If the picker for workspace is empty but the
                            // chosen thread carries one, backfill so the
                            // composer is internally consistent.
                            if viewModel.workspaceId.isEmpty,
                               let ws = thread.workspaceID, !ws.isEmpty {
                                viewModel.workspaceId = ws
                            }
                        } label: {
                            menuRowLabel(
                                title: thread.title,
                                subtitle: thread.subtitle.isEmpty ? thread.id : thread.subtitle,
                                selected: viewModel.threadId == thread.id
                            )
                        }
                    }
                    Divider()
                    Button {
                        threadManualOverride = true
                    } label: {
                        Label("Type id manually", systemImage: "keyboard")
                    }
                } label: {
                    pickerLabel(
                        systemImage: "bubble.left.and.bubble.right",
                        title: resolvedThreadLabel,
                        placeholder: "Choose thread"
                    )
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                themedTextField("Thread id", text: $viewModel.threadId)
                if threadPickerAvailable && threadManualOverride {
                    Button {
                        threadManualOverride = false
                    } label: {
                        Label("Use thread list", systemImage: "list.bullet.rectangle")
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.accent)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// What the picker button shows. Prefer the displayName of the
    /// currently-selected sidebar entry; fall back to the raw id (still
    /// useful when the desktop broadcast hasn't arrived yet) or the
    /// placeholder copy when nothing is set.
    private var resolvedWorkspaceLabel: String {
        let id = viewModel.workspaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return "" }
        if let match = sidebarStoreOrEmpty.workspace(id: id) {
            return match.displayName
        }
        return id
    }

    private var resolvedThreadLabel: String {
        let id = viewModel.threadId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return "" }
        if let match = sidebarStoreOrEmpty.thread(id: id) {
            return match.title
        }
        return id
    }

    @ViewBuilder
    private func pickerLabel(
        systemImage: String,
        title: String,
        placeholder: String
    ) -> some View {
        HStack(spacing: Theme.Spacing.tight) {
            Image(systemName: systemImage)
                .foregroundStyle(Theme.accent)
            Text(title.isEmpty ? placeholder : title)
                .foregroundStyle(title.isEmpty ? Theme.Text.tertiary : Theme.Text.primary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: Theme.Spacing.tight)
            Image(systemName: "chevron.down")
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.Text.secondary)
        }
        .font(Theme.Typography.body)
        .padding(Theme.Spacing.control)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func menuRowLabel(
        title: String,
        subtitle: String?,
        selected: Bool
    ) -> some View {
        if let subtitle, !subtitle.isEmpty, subtitle != title {
            Label {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                    Text(subtitle)
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.Text.secondary)
                }
            } icon: {
                Image(systemName: selected ? "checkmark" : "circle")
            }
        } else {
            Label(title, systemImage: selected ? "checkmark" : "circle")
        }
    }

    @ViewBuilder
    private func pickerBlock<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Text.secondary)
            content()
                .tint(Theme.accent)
        }
    }

    @ViewBuilder
    private var promptEditor: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $viewModel.prompt)
                .font(Theme.Typography.body)
                .focused($promptFocused)
                .frame(minHeight: 158)
                .padding(8)
                .scrollContentBackground(.hidden)
            if viewModel.prompt.isEmpty {
                Text("Write the next task or instruction.")
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Text.tertiary)
                    .padding(.horizontal, Theme.Spacing.control + 2)
                    .padding(.vertical, Theme.Spacing.control + 1)
                    .allowsHitTesting(false)
            }
        }
        .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(promptFocused ? Theme.accent : Theme.border, lineWidth: promptFocused ? 2 : 1)
        )
        .shadow(
            color: promptFocused ? Theme.accent.opacity(0.18) : .clear,
            radius: promptFocused ? Theme.Shadow.softRadius : 0,
            y: promptFocused ? Theme.Shadow.softY : 0
        )
        .animation(Theme.Motion.quick, value: promptFocused)
    }

    @ViewBuilder
    private var sendSurface: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            Button(action: { Task { await viewModel.send() } }) {
                HStack(spacing: Theme.Spacing.tight) {
                    Label("Send", systemImage: "paperplane.fill")
                    Spacer()
                    if case .sending = viewModel.status {
                        ProgressView()
                    }
                }
                .font(Theme.Typography.sectionTitle)
            }
            .buttonStyle(.borderedProminent)
            .disabled(sendDisabled)

            statusBanner
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
    private var statusBanner: some View {
        switch viewModel.status {
        case .idle:
            EmptyView()
        case .preparing:
            StatusMessage(icon: "clock", message: "Preparing request", color: Theme.accent)
        case .sending:
            StatusMessage(icon: "paperplane", message: "Sending prompt", color: Theme.accent)
        case .sent(let message):
            StatusMessage(icon: "checkmark.circle.fill", message: message, color: Theme.success)
        case .sendFailed(let message):
            StatusMessage(icon: "exclamationmark.triangle.fill", message: message, color: Theme.destructive)
        case .prepareDenied(let reason):
            StatusMessage(icon: "hand.raised.fill", message: reason, color: Theme.warning)
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct StatusMessage: View {
    let icon: String
    let message: String
    let color: Color

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.tight) {
            Image(systemName: icon)
                .font(Theme.Typography.caption)
                .foregroundStyle(color)
            Text(message)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Text.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.control)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(color.opacity(0.24), lineWidth: 1)
        )
    }
}

/// Cross-platform autocapitalization-off modifier. iOS supports
/// `textInputAutocapitalization(.never)`; macOS doesn't have the
/// concept (no software keyboard), so the modifier is a no-op there.
@available(iOS 17.0, macOS 14.0, *)
private struct NoAutocapModifier: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        content.textInputAutocapitalization(.never)
        #else
        content
        #endif
    }
}
