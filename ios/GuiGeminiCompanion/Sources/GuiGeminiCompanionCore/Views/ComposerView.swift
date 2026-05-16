import SwiftUI

/// ComposerView — iPhone-minimal new-turn composer. Lets the user pick
/// workspace + provider + approvalMode + model + contextTurns and type
/// a prompt, then sends as a `composerPrompt` action.
///
/// Minimal-by-design: when the iOS UI gets the desktop's allowlisted
/// workspace list (a future feed), the workspace field becomes a
/// picker rather than free text. Same for provider + approvalMode +
/// model — those are picker-shaped today via segmented controls.
@available(iOS 17.0, macOS 14.0, *)
public struct ComposerView: View {
    @Bindable public var viewModel: ComposerViewModel
    @FocusState private var promptFocused: Bool

    public init(viewModel: ComposerViewModel) {
        self.viewModel = viewModel
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
                        themedTextField("Workspace id", text: $viewModel.workspaceId)
                        themedTextField("Thread id", text: $viewModel.threadId)
                    }
                    composerSection(title: "Provider", systemImage: "cpu") {
                        pickerBlock(title: "Provider") {
                            Picker("Provider", selection: $viewModel.provider) {
                                Text("Gemini").tag("gemini")
                                Text("Codex").tag("codex")
                                Text("Claude").tag("claude")
                                Text("Kimi").tag("kimi")
                            }
                            .pickerStyle(.segmented)
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
