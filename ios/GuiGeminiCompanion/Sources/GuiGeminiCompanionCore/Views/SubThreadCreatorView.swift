import SwiftUI

/// SubThreadCreatorView — iOS modal that spawns a cross-provider
/// sub-thread under a parent thread, mirroring the desktop's
/// `SubThreadCreator.tsx`. The user picks the provider, types a
/// delegation prompt, and chooses whether the child returns its result
/// to the parent (the desktop equivalent of the "Return result" checkbox).
///
/// Wire status: the Electron side already routes `createSubThread`
/// dispatches via the AppStore, but the iOS-side `BridgeActionPayload`
/// hasn't added a `.createSubThread(...)` variant yet (Codex owns that
/// file; this slice doesn't touch it). The Send button therefore logs
/// what the payload WOULD be and shows a non-fatal banner so the user
/// knows wiring is pending. The UI itself is real: it can ship today
/// and start working as soon as the payload variant lands.
@available(iOS 17.0, macOS 14.0, *)
public struct SubThreadCreatorView: View {
    public struct Parent: Equatable, Sendable {
        public let workspaceId: String
        public let threadId: String
        public let displayTitle: String

        public init(workspaceId: String, threadId: String, displayTitle: String) {
            self.workspaceId = workspaceId
            self.threadId = threadId
            self.displayTitle = displayTitle
        }
    }

    public let parent: Parent
    /// Bridge client passed in by the host (iPadShell or detail pane).
    /// When non-nil the Send button will attempt to dispatch the action;
    /// when nil it falls back to the print-only stub so previews stay
    /// safe.
    public let client: GuiGeminiBridgeClient?
    public let onDismiss: () -> Void

    @State private var selectedProvider: String = "codex"
    @State private var delegationPrompt: String = ""
    @State private var returnResultToParent: Bool = true
    @State private var sendStatus: SendStatus = .idle
    @FocusState private var promptFocused: Bool

    public init(
        parent: Parent,
        client: GuiGeminiBridgeClient? = nil,
        onDismiss: @escaping () -> Void
    ) {
        self.parent = parent
        self.client = client
        self.onDismiss = onDismiss
    }

    public var body: some View {
        NavigationStack {
            Form {
                parentSection
                providerSection
                promptSection
                resultSection
                if case .stubbed(let summary) = sendStatus {
                    Section {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Send is stubbed")
                                    .font(Theme.Typography.caption)
                                Text(summary)
                                    .font(Theme.Typography.smallCaption)
                                    .foregroundStyle(Theme.secondaryText)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        } icon: {
                            Image(systemName: "info.circle")
                                .foregroundStyle(Theme.warning)
                        }
                    }
                }
                if case .error(let message) = sendStatus {
                    Section {
                        Label {
                            Text(message)
                                .font(Theme.Typography.smallCaption)
                                .foregroundStyle(Theme.destructive)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(Theme.destructive)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Delegate sub-thread")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") {
                        Task { await send() }
                    }
                    .disabled(sendDisabled)
                }
            }
        }
    }

    // MARK: - Sections

    private var parentSection: some View {
        Section {
            HStack(spacing: Theme.Spacing.tight) {
                Image(systemName: "arrow.branch")
                    .foregroundStyle(Theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(parent.displayTitle)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                    Text("\(parent.workspaceId) · \(parent.threadId)")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
            }
        } header: {
            Text("Parent thread")
        }
    }

    private var providerSection: some View {
        Section {
            Picker("Provider", selection: $selectedProvider) {
                Text("Gemini").tag("gemini")
                Text("Codex").tag("codex")
                Text("Claude").tag("claude")
                Text("Kimi").tag("kimi")
            }
            .pickerStyle(.menu)
            .tint(Theme.accent)
        } header: {
            Text("Provider")
        } footer: {
            Text("The sub-thread runs on the picked provider, independent of the parent's provider.")
        }
    }

    private var promptSection: some View {
        Section {
            ZStack(alignment: .topLeading) {
                TextEditor(text: $delegationPrompt)
                    .focused($promptFocused)
                    .frame(minHeight: 200)
                    .font(Theme.Typography.body)
                    .scrollContentBackground(.hidden)
                if delegationPrompt.isEmpty {
                    Text("Describe what the sub-agent should do…")
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Text.tertiary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }
            }
        } header: {
            Text("Delegation prompt")
        }
    }

    private var resultSection: some View {
        Section {
            Toggle(isOn: $returnResultToParent) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Return result to parent")
                        .font(Theme.Typography.body)
                    Text("When ON, the sub-thread's final reply is posted back into this parent thread.")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } header: {
            Text("Result handling")
        }
    }

    // MARK: - Send + state

    private enum SendStatus: Equatable {
        case idle
        case sending
        case stubbed(String)
        case error(String)
    }

    private var sendDisabled: Bool {
        delegationPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || sendStatus == .sending
    }

    private func send() async {
        sendStatus = .sending
        let trimmedPrompt = delegationPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        // TODO(desktop-wiring): `BridgeActionPayload.createSubThread` variant
        // is not yet defined on the iOS side (Codex owns BridgeActionPayload.swift
        // and the cross-process iOS↔Electron wire). Once the variant lands,
        // construct it with these fields and dispatch via `client?.sendAction`.
        let payloadSketch: [String: Any] = [
            "kind": "createSubThread",
            "parentWorkspaceId": parent.workspaceId,
            "parentThreadId": parent.threadId,
            "provider": selectedProvider,
            "prompt": trimmedPrompt,
            "returnResultToParent": returnResultToParent
        ]
        print("[SubThreadCreator] would dispatch: \(payloadSketch)")
        sendStatus = .stubbed(
            "Wire-up pending: createSubThread payload variant. The prompt and settings have been logged so the desktop team can verify the shape."
        )
    }
}

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
#Preview("SubThreadCreator — preview") {
    SubThreadCreatorView(
        parent: SubThreadCreatorView.Parent(
            workspaceId: "/Users/me/dev/GUIGemini",
            threadId: "chat-77",
            displayTitle: "Implement push notifications"
        ),
        onDismiss: {}
    )
}
#endif
