import SwiftUI
import GuiGeminiCompanionCore

/// Decides whether to show the pairing flow or the main TabView based
/// on whether the user has completed pairing. Watches the pairing view
/// model's `confirmedPair` and transitions the AppState to "connected"
/// once available.
struct RootView: View {
    @Bindable var appState: AppState

    var body: some View {
        Group {
            if appState.isPaired {
                MainTabs(appState: appState)
            } else {
                NavigationStack {
                    PairingView(viewModel: appState.pairingViewModel)
                        .navigationTitle("GUIGemini")
                }
            }
        }
        .onChange(of: appState.pairingViewModel.confirmedPair?.pairID.rawValue) { _, _ in
            if let pair = appState.pairingViewModel.confirmedPair {
                Task { await appState.connect(with: pair) }
            }
        }
    }
}

/// Three-tab main interface: Transcript / Approvals / Compose.
/// The iPad-full variant (Phase D2) would replace this with a
/// SplitView; for iPhone-minimal a TabBar suits the form factor.
struct MainTabs: View {
    @Bindable var appState: AppState

    var body: some View {
        TabView {
            NavigationStack {
                if let viewModel = appState.transcriptViewModel {
                    TranscriptView(viewModel: viewModel)
                        .navigationTitle("Transcript")
                } else {
                    Text("Connecting…").foregroundStyle(.secondary)
                }
            }
            .tabItem { Label("Transcript", systemImage: "text.bubble") }

            NavigationStack {
                if let viewModel = appState.approvalViewModel {
                    ApprovalCardsView(viewModel: viewModel)
                        .navigationTitle("Approvals")
                } else {
                    Text("Connecting…").foregroundStyle(.secondary)
                }
            }
            .tabItem { Label("Approvals", systemImage: "checkmark.shield") }

            NavigationStack {
                if let viewModel = appState.composerViewModel {
                    ComposerView(viewModel: viewModel)
                        .navigationTitle("Compose")
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button("Disconnect") {
                                    Task { await appState.disconnect() }
                                }
                            }
                        }
                } else {
                    Text("Connecting…").foregroundStyle(.secondary)
                }
            }
            .tabItem { Label("Compose", systemImage: "square.and.pencil") }
        }
    }
}
