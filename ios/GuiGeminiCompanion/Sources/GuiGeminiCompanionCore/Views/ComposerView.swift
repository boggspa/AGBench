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

    public init(viewModel: ComposerViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        Form {
            Section("Target") {
                TextField("Workspace id", text: $viewModel.workspaceId)
                    .modifier(NoAutocapModifier())
                TextField("Thread id", text: $viewModel.threadId)
                    .modifier(NoAutocapModifier())
            }
            Section("Provider") {
                Picker("Provider", selection: $viewModel.provider) {
                    Text("Gemini").tag("gemini")
                    Text("Codex").tag("codex")
                    Text("Claude").tag("claude")
                    Text("Kimi").tag("kimi")
                }
                .pickerStyle(.segmented)
                Picker("Approval mode", selection: $viewModel.approvalMode) {
                    Text("Default").tag("default")
                    Text("Plan").tag("plan")
                }
                .pickerStyle(.segmented)
                TextField("Model (optional)", text: $viewModel.model)
                    .modifier(NoAutocapModifier())
                Stepper("Context turns: \(viewModel.contextTurns)", value: $viewModel.contextTurns, in: 0...20)
            }
            Section("Prompt") {
                TextEditor(text: $viewModel.prompt)
                    .frame(minHeight: 140)
            }
            Section {
                Button(action: { Task { await viewModel.send() } }) {
                    HStack {
                        Text("Send")
                        Spacer()
                        if case .sending = viewModel.status {
                            ProgressView()
                        }
                    }
                }
                .disabled(viewModel.prompt.isEmpty || viewModel.workspaceId.isEmpty || viewModel.threadId.isEmpty)
                if case .sent(let message) = viewModel.status {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.green)
                } else if case .sendFailed(let message) = viewModel.status {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                } else if case .prepareDenied(let reason) = viewModel.status {
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
        }
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
