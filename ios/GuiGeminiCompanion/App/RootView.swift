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
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .scale(scale: 0.98).combined(with: .opacity)
                    ))
            } else {
                NavigationStack {
                    PairingView(viewModel: appState.pairingViewModel)
                        .navigationTitle("GUIGemini")
                        .toolbarBackground(Theme.chromeBlur, for: .navigationBar)
                        .toolbarBackground(.visible, for: .navigationBar)
                }
                .transition(.asymmetric(
                    insertion: .scale(scale: 0.98).combined(with: .opacity),
                    removal: .move(edge: .leading).combined(with: .opacity)
                ))
            }
        }
        .tint(Theme.accent)
        .background(Theme.background.ignoresSafeArea())
        .animation(Theme.Motion.handoff, value: appState.isPaired)
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
                    ConnectionEmptyState(
                        icon: "text.bubble",
                        title: "Transcript warming up",
                        message: "Live run events from your paired Mac will appear here as soon as the bridge starts streaming."
                    )
                    .navigationTitle("Transcript")
                }
            }
            .tabItem { Label("Transcript", systemImage: "text.bubble") }

            NavigationStack {
                if let viewModel = appState.approvalViewModel {
                    ApprovalCardsView(viewModel: viewModel)
                        .navigationTitle("Approvals")
                } else {
                    ConnectionEmptyState(
                        icon: "checkmark.shield",
                        title: "Approval desk opening",
                        message: "Tool requests that need your decision will stack here once the desktop session is ready."
                    )
                    .navigationTitle("Approvals")
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
                    ConnectionEmptyState(
                        icon: "square.and.pencil",
                        title: "Composer getting ready",
                        message: "When the bridge finishes connecting, you can start a new turn from this screen."
                    )
                    .navigationTitle("Compose")
                }
            }
            .tabItem { Label("Compose", systemImage: "square.and.pencil") }
        }
        .tint(Theme.accent)
        .toolbarBackground(Theme.chromeBlur, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}

private struct ConnectionEmptyState: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(spacing: Theme.Spacing.control) {
                Image(systemName: icon)
                    .font(Theme.Typography.iconLarge)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 72, height: 72)
                    .background(Theme.cardBlur, in: Circle())
                    .overlay(Circle().stroke(Theme.strongBorder, lineWidth: 1))
                    .shadow(
                        color: Theme.softShadowColor,
                        radius: Theme.Shadow.softRadius,
                        y: Theme.Shadow.softY
                    )
                Text(title)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Text.primary)
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Text.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(Theme.Spacing.screen)
            .frame(maxWidth: 340)
        }
    }
}
