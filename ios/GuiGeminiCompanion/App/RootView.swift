import SwiftUI
import GuiGeminiCompanionCore

/// Decides whether to show the pairing flow or the main TabView based
/// on whether the user has completed pairing. Watches the pairing view
/// model's `confirmedPair` and transitions the AppState to "connected"
/// once available.
struct RootView: View {
    @Bindable var appState: AppState
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        let palette = appState.companionThemePalette
        Group {
            if appState.isPaired {
                pairedContent
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .scale(scale: 0.98).combined(with: .opacity)
                    ))
            } else {
                NavigationStack {
                    PairingView(viewModel: appState.pairingViewModel)
                        .navigationTitle("AGBench")
                        .toolbarBackground(Theme.chromeBlur, for: .navigationBar)
                        .toolbarBackground(.visible, for: .navigationBar)
                }
                .transition(.asymmetric(
                    insertion: .scale(scale: 0.98).combined(with: .opacity),
                    removal: .move(edge: .leading).combined(with: .opacity)
                ))
            }
        }
        .environment(\.companionThemePalette, palette)
        .tint(palette.accent)
        .background(palette.background.ignoresSafeArea())
        .preferredColorScheme(palette.preferredColorScheme)
        .animation(Theme.Motion.handoff, value: appState.isPaired)
        .onChange(of: appState.pairingViewModel.confirmedPair?.pairID.rawValue) { _, _ in
            if let pair = appState.pairingViewModel.confirmedPair {
                Task { await appState.connect(with: pair) }
            }
        }
    }

    @ViewBuilder
    private var pairedContent: some View {
        if horizontalSizeClass == .regular {
            iPadShell(appState: appState)
        } else {
            MainTabs(appState: appState)
        }
    }
}

@available(iOS 17.0, *)
private extension iPadShell {
    init(appState: AppState) {
        let remoteTaskViewModel = appState.remoteTaskConsoleViewModel
        self.init(
            pairingViewModel: appState.pairingViewModel,
            transcriptViewModel: appState.transcriptViewModel,
            approvalViewModel: appState.approvalViewModel,
            composerViewModel: appState.composerViewModel,
            remoteTaskStore: remoteTaskViewModel?.store,
            ensembleControlActions: remoteTaskViewModel.map { viewModel in
                iPadEnsembleControlActions(
                    cancelRound: { state in
                        await viewModel.ensembleCancelRound(state)
                    },
                    skipActiveParticipant: { state in
                        await viewModel.ensembleSkipActiveParticipant(state)
                    },
                    wakeNow: { state in
                        await viewModel.ensembleWakeNow(state)
                    },
                    cancelWakeup: { state in
                        await viewModel.ensembleCancelWakeup(state)
                    },
                    queuePrompt: { state, text in
                        await viewModel.ensembleQueuePrompt(state, text: text)
                    },
                    steer: { state, text in
                        await viewModel.ensembleSteer(state, text: text)
                    }
                )
            } ?? .disabled,
            pushStatusMessage: appState.lastPushMessage,
            yoloModeEnabled: appState.yoloModeEnabled,
            onSetYoloMode: { enabled in
                Task { await appState.setYoloMode(enabled: enabled) }
            },
            sidebarStore: appState.sidebarStore,
            onUnpair: {
                Task { await appState.unpair() }
            }
        )
    }
}

/// Three-tab main interface: Transcript / Approvals / Compose.
/// The iPad-full variant (Phase D2) would replace this with a
/// SplitView; for iPhone-minimal a TabBar suits the form factor.
struct MainTabs: View {
    @Bindable var appState: AppState
    @Environment(\.companionThemePalette) private var palette

    var body: some View {
        TabView {
            NavigationStack {
                if let viewModel = appState.remoteTaskConsoleViewModel {
                    RemoteTaskConsoleView(viewModel: viewModel)
                        .navigationTitle("Tasks")
                } else {
                    ConnectionEmptyState(
                        icon: "rectangle.stack.badge.person.crop",
                        title: "Task console warming up",
                        message: "Remote task cards, approvals, questions, and diffs will appear here when the bridge starts streaming."
                    )
                    .navigationTitle("Tasks")
                }
            }
            .tabItem { Label("Tasks", systemImage: "rectangle.stack.badge.person.crop") }

            NavigationStack {
                if let viewModel = appState.transcriptViewModel {
                    TranscriptView(
                        viewModel: viewModel,
                        cancelRunBinding: appState.composerViewModel.map { composer in
                            TranscriptView.CancelRunBinding(
                                canCancel: composer.canCancelRun,
                                cancel: { await composer.cancelCurrentRun() }
                            )
                        }
                    )
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
                    ComposerView(viewModel: viewModel, sidebarStore: appState.sidebarStore)
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

            NavigationStack {
                iPhoneSettingsView(
                    pairingViewModel: appState.pairingViewModel,
                    transcriptViewModel: appState.transcriptViewModel,
                    pushStatusMessage: appState.lastPushMessage,
                    yoloModeEnabled: appState.yoloModeEnabled,
                    onSetYoloMode: { enabled in
                        Task { await appState.setYoloMode(enabled: enabled) }
                    },
                    onUnpair: {
                        Task { await appState.unpair() }
                    }
                )
                .navigationTitle("Settings")
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .tint(palette.accent)
        .toolbarBackground(Theme.chromeBlur, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}

private struct ConnectionEmptyState: View {
    let icon: String
    let title: String
    let message: String
    @Environment(\.companionThemePalette) private var palette

    var body: some View {
        ZStack {
            palette.background.ignoresSafeArea()
            VStack(spacing: Theme.Spacing.control) {
                Image(systemName: icon)
                    .font(Theme.Typography.iconLarge)
                    .foregroundStyle(palette.accent)
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
