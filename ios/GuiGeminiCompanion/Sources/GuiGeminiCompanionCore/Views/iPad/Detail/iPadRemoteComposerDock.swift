import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
struct iPadRemoteComposerTarget: Equatable, Sendable {
    let workspaceId: String
    let threadId: String
    let provider: String
    let title: String
    let subtitle: String
    let capabilityAllowsStartTurn: Bool
    let capabilityKnown: Bool

    init(
        threadID: String,
        thread: iPadThreadSummary?,
        taskDetail: RemoteTaskDetail?,
        fallbackProvider: String
    ) {
        let task = taskDetail?.task
        self.workspaceId = Self.firstNonEmpty(task?.workspaceId, thread?.workspaceID)
        self.threadId = Self.firstNonEmpty(task?.threadId, thread?.id, threadID)
        self.provider = Self.firstNonEmpty(task?.provider, thread?.provider, fallbackProvider, "gemini")
        self.title = Self.firstNonEmpty(task?.displayTitle, thread?.title, threadID)
        self.subtitle = Self.subtitle(task: task, thread: thread)
        self.capabilityKnown = taskDetail != nil
        self.capabilityAllowsStartTurn = task?.capabilities.startTurn ?? true
    }

    var identityKey: String {
        [workspaceId, threadId, provider, capabilityAllowsStartTurn ? "can" : "cannot"].joined(separator: "|")
    }

    var unavailableReason: String? {
        if workspaceId.isEmpty {
            return "Workspace id is unavailable for this thread."
        }
        if threadId.isEmpty {
            return "Thread id is unavailable."
        }
        if provider.isEmpty {
            return "Provider is unavailable."
        }
        if !capabilityAllowsStartTurn {
            return "Start turn is unavailable for this task."
        }
        return nil
    }

    private static func subtitle(task: RemoteTaskCard?, thread: iPadThreadSummary?) -> String {
        if let task {
            var parts: [String] = []
            if let workspace = task.workspaceDisplayName ?? task.workspaceId,
               !workspace.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                parts.append(workspace)
            }
            if let provider = task.provider,
               !provider.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                parts.append(provider)
            }
            let status = task.status.rawValue
            if !status.isEmpty {
                parts.append(status)
            }
            if !parts.isEmpty {
                return parts.joined(separator: " · ")
            }
        }
        if let thread {
            var parts: [String] = []
            if let workspace = thread.workspaceID,
               !workspace.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                parts.append(workspace)
            }
            if let provider = thread.provider,
               !provider.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                parts.append(provider)
            }
            if !thread.subtitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                parts.append(thread.subtitle)
            }
            if !parts.isEmpty {
                return parts.joined(separator: " · ")
            }
        }
        return "Selected thread"
    }

    private static func firstNonEmpty(_ values: String?...) -> String {
        for value in values {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !trimmed.isEmpty {
                return trimmed
            }
        }
        return ""
    }
}

@available(iOS 17.0, macOS 14.0, *)
struct iPadRemoteComposerDock: View {
    @Bindable var viewModel: ComposerViewModel
    let target: iPadRemoteComposerTarget

    @State private var promptText: String = ""
    @State private var selectedProvider: String
    @State private var approvalMode: String = "default"
    @State private var contextTurns: Int = 5
    @FocusState private var promptFocused: Bool
    @Environment(\.companionThemePalette) private var palette

    init(viewModel: ComposerViewModel, target: iPadRemoteComposerTarget) {
        self.viewModel = viewModel
        self.target = target
        _selectedProvider = State(initialValue: target.provider)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            header
            HStack(alignment: .bottom, spacing: Theme.Spacing.control) {
                promptField
                sendButton
            }
            controls
            if let reason = target.unavailableReason {
                statusBanner(icon: "lock.fill", message: reason, color: palette.warning)
            } else {
                statusView
            }
        }
        .padding(Theme.Spacing.section)
        .companionCardBackground(cornerRadius: Theme.Radius.panel)
        .onChange(of: target.identityKey) { _, _ in
            selectedProvider = target.provider
            promptText = ""
        }
    }

    private var sendDisabled: Bool {
        target.unavailableReason != nil
            || promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || isSending
    }

    private var isSending: Bool {
        if case .sending = viewModel.status {
            return true
        }
        return false
    }

    private var header: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            Image(systemName: "square.and.pencil")
                .font(Theme.Typography.caption)
                .foregroundStyle(palette.accent)
                .frame(width: 32, height: 32)
                .background(palette.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text("Next turn")
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.primaryText)
                Text(target.title)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: Theme.Spacing.tight)
            Text(target.capabilityKnown ? "thread scoped" : "router checked")
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(target.capabilityAllowsStartTurn ? palette.accent : palette.warning)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(
                    (target.capabilityAllowsStartTurn ? palette.accent : palette.warning).opacity(0.12),
                    in: Capsule(style: .continuous)
                )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Next turn composer for \(target.title)")
    }

    private var promptField: some View {
        TextField("Send a prompt to this thread", text: $promptText, axis: .vertical)
            .font(Theme.Typography.body)
            .textFieldStyle(.plain)
            .lineLimit(2...5)
            .focused($promptFocused)
            .padding(Theme.Spacing.control)
            .background(palette.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(promptFocused ? palette.accent : palette.cardStroke, lineWidth: promptFocused ? 2 : 1)
            }
            .animation(Theme.Motion.quick, value: promptFocused)
    }

    private var sendButton: some View {
        Button {
            Task { await sendPrompt() }
        } label: {
            if isSending {
                ProgressView()
                    .frame(width: 22, height: 22)
            } else {
                Image(systemName: "arrow.up.circle.fill")
                    .font(Theme.Typography.iconMedium)
            }
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(sendDisabled)
        .accessibilityLabel("Send prompt")
    }

    private var controls: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Spacing.tight) {
                providerPicker
                approvalModePicker
                contextStepper
                targetSummary
            }
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                HStack(spacing: Theme.Spacing.tight) {
                    providerPicker
                    approvalModePicker
                    contextStepper
                }
                targetSummary
            }
        }
    }

    private var providerPicker: some View {
        Menu {
            ForEach(Self.providers, id: \.id) { provider in
                Button {
                    selectedProvider = provider.id
                } label: {
                    Label(provider.label, systemImage: selectedProvider == provider.id ? "checkmark" : "circle")
                }
            }
        } label: {
            controlChip(systemImage: "cpu", text: providerLabel)
        }
        .disabled(target.unavailableReason != nil)
    }

    private var approvalModePicker: some View {
        Picker("Approval mode", selection: $approvalMode) {
            Text("Default").tag("default")
            Text("Plan").tag("plan")
        }
        .pickerStyle(.segmented)
        .frame(width: 170)
        .disabled(target.unavailableReason != nil)
    }

    private var contextStepper: some View {
        Stepper(value: $contextTurns, in: 0...20) {
            Text("\(contextTurns) ctx")
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.secondaryText)
                .frame(minWidth: 42, alignment: .leading)
        }
        .labelsHidden()
        .frame(width: 96)
        .disabled(target.unavailableReason != nil)
        .accessibilityLabel("Context turns")
        .accessibilityValue("\(contextTurns)")
    }

    private var targetSummary: some View {
        HStack(spacing: 6) {
            Image(systemName: "scope")
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
            Text(target.subtitle)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func controlChip(systemImage: String, text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage)
                .font(Theme.Typography.smallCaption)
            Text(text)
                .font(Theme.Typography.smallCaption)
                .lineLimit(1)
        }
        .foregroundStyle(palette.accent)
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(palette.accent.opacity(0.10), in: Capsule(style: .continuous))
    }

    private var providerLabel: String {
        Self.providers.first { $0.id == selectedProvider }?.label ?? selectedProvider.capitalized
    }

    @ViewBuilder
    private var statusView: some View {
        switch viewModel.status {
        case .idle:
            EmptyView()
        case .preparing:
            statusBanner(icon: "clock", message: "Preparing request", color: palette.accent)
        case .sending:
            statusBanner(icon: "paperplane", message: "Sending prompt", color: palette.accent)
        case .sent(let message):
            statusBanner(icon: "checkmark.circle.fill", message: message, color: palette.success)
        case .sendFailed(let message):
            statusBanner(icon: "exclamationmark.triangle.fill", message: message, color: palette.destructive)
        case .prepareDenied(let reason):
            statusBanner(icon: "hand.raised.fill", message: reason, color: palette.warning)
        }
    }

    private func statusBanner(icon: String, message: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.tight) {
            Image(systemName: icon)
                .font(Theme.Typography.caption)
                .foregroundStyle(color)
            Text(message)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.tight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
    }

    private func sendPrompt() async {
        let trimmed = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard target.unavailableReason == nil, !trimmed.isEmpty else { return }
        viewModel.workspaceId = target.workspaceId
        viewModel.threadId = target.threadId
        viewModel.provider = selectedProvider.isEmpty ? target.provider : selectedProvider
        viewModel.approvalMode = approvalMode
        viewModel.contextTurns = contextTurns
        viewModel.prompt = trimmed
        await viewModel.send()
        if case .sent = viewModel.status {
            promptText = ""
        }
    }

    private static let providers: [(id: String, label: String)] = [
        ("gemini", "Gemini"),
        ("codex", "Codex"),
        ("claude", "Claude"),
        ("kimi", "Kimi"),
        ("grok", "Grok"),
        ("cursor", "Cursor")
    ]
}
