import SwiftUI

/// iPhoneSettingsView — the iPhone counterpart to `iPadSettingsPane`. The
/// iPad shell already had a Settings pane in its detail column; iPhone's
/// 3-tab TabView shipped without one, so the user had no way to flip
/// YOLO mode, see push status, or unpair from the phone. This view is
/// the 4th tab.
///
/// Layout: a SwiftUI `Form` (the native iOS settings idiom) split into
/// three sections — Connection, Behavior, About — that mirror the same
/// data the iPad pane surfaces. Sections intentionally read narrower
/// than the iPad cards: a Form's grouped-list style is the convention
/// for an iPhone settings screen and avoids re-implementing the
/// glassmorphism of the iPad cards on a small form factor where they
/// would feel oversized.
@available(iOS 17.0, macOS 14.0, *)
public struct iPhoneSettingsView: View {
    public let pairingViewModel: PairingViewModel?
    public let transcriptViewModel: TranscriptViewModel?
    public let pushStatusMessage: String?
    public let yoloModeEnabled: Bool
    public let onSetYoloMode: ((Bool) -> Void)?
    public let onUnpair: (() -> Void)?

    @State private var showUnpairConfirmation: Bool = false
    /// Fallback toggle storage used only when the host hasn't wired an
    /// `onSetYoloMode` callback. Keeps the UI control responsive in
    /// preview / disconnected states.
    @State private var localYoloToggleFallback: Bool = false

    public init(
        pairingViewModel: PairingViewModel? = nil,
        transcriptViewModel: TranscriptViewModel? = nil,
        pushStatusMessage: String? = nil,
        yoloModeEnabled: Bool = false,
        onSetYoloMode: ((Bool) -> Void)? = nil,
        onUnpair: (() -> Void)? = nil
    ) {
        self.pairingViewModel = pairingViewModel
        self.transcriptViewModel = transcriptViewModel
        self.pushStatusMessage = pushStatusMessage
        self.yoloModeEnabled = yoloModeEnabled
        self.onSetYoloMode = onSetYoloMode
        self.onUnpair = onUnpair
    }

    public var body: some View {
        Form {
            connectionSection
            behaviorSection
            aboutSection
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .confirmationDialog(
            "Disconnect from Mac?",
            isPresented: $showUnpairConfirmation,
            titleVisibility: .visible
        ) {
            Button("Unpair", role: .destructive) {
                onUnpair?()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll lose access to live runs and need to re-pair to reconnect.")
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        Section {
            HStack {
                Image(systemName: pairedMacName != nil ? "link.circle.fill" : "link.slash")
                    .foregroundStyle(pairedMacName != nil ? Theme.accent : Theme.tertiaryText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(pairedMacName ?? "Not paired")
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.primaryText)
                    if let subtitle = pairedSubtitle {
                        Text(subtitle)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                Spacer()
            }
            HStack {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .foregroundStyle(Theme.success)
                Text("Transport")
                    .font(Theme.Typography.body)
                Spacer()
                Text(resolvedRoute)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.accentSoft, in: Capsule())
            }
            if let pushMessage = pushStatusMessage, !pushMessage.isEmpty {
                HStack(alignment: .top) {
                    Image(systemName: "bell.badge")
                        .foregroundStyle(Theme.warning)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Push notifications")
                            .font(Theme.Typography.body)
                        Text(pushMessage)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            Button(role: .destructive) {
                showUnpairConfirmation = true
            } label: {
                Label("Unpair this iPhone", systemImage: "link.badge.minus")
            }
            .disabled(pairedMacName == nil)
        } header: {
            Text("Connection")
        } footer: {
            Text("Pairing data lives in the iOS Keychain. Unpairing clears it; you'll need to scan the QR again to reconnect.")
        }
    }

    // MARK: - Behavior

    private var behaviorSection: some View {
        Section {
            Toggle(isOn: yoloBinding) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("YOLO approvals", systemImage: yoloIcon)
                        .foregroundStyle(yoloModeEnabled ? Theme.warning : Theme.primaryText)
                    Text("Automatically accept guarded desktop approvals for this session.")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Theme.warning)
            if onSetYoloMode == nil {
                // TODO: wire `AppState.setYoloMode(enabled:)` through the
                // host (RootView passes this view its callback). When the
                // callback is nil the toggle drives an inert @State binding
                // so the UI is still responsive; switching this branch on
                // means the desktop won't actually receive the change.
                Text("Disconnected — toggle has no effect until the bridge reconnects.")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.tertiaryText)
            }
        } header: {
            Text("Behavior")
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        Section {
            LabeledContent("Version", value: appVersionDisplay)
            LabeledContent("Build", value: buildNumberDisplay)
            LabeledContent("Platform", value: deploymentTargetDisplay)
            // Desktop deep-link: AGBench doesn't expose a custom URL
            // scheme today, so this is a "Coming soon" stub. When the
            // desktop ships `agbench://` (see desktop-side TODO in
            // `src/main/index.ts` registerProtocolHandler), flip the
            // disabled flag and point UIApplication.open at the scheme.
            Button {
                // intentional no-op until the desktop registers the scheme
            } label: {
                Label("Open AGBench desktop (coming soon)", systemImage: "macwindow")
            }
            .disabled(true)
        } header: {
            Text("About")
        } footer: {
            Text("Build info is read from the bundle. The desktop deep-link wakes the paired Mac and focuses the active workspace once AGBench registers the agbench:// scheme.")
        }
    }

    // MARK: - Resolved values

    private var pairedMacName: String? {
        let raw = pairingViewModel?.confirmedPair?.macDisplayName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (raw?.isEmpty == false) ? raw : nil
    }

    private var pairedSubtitle: String? {
        guard let pair = pairingViewModel?.confirmedPair else { return nil }
        return "pair \(String(pair.pairID.rawValue.prefix(8)))"
    }

    private var resolvedRoute: String {
        if let route = transcriptViewModel?.activeRouteLabel?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !route.isEmpty {
            return route
        }
        return "—"
    }

    private var yoloIcon: String {
        yoloModeEnabled ? "bolt.shield.fill" : "shield"
    }

    private var yoloBinding: Binding<Bool> {
        Binding(
            get: {
                onSetYoloMode == nil ? localYoloToggleFallback : yoloModeEnabled
            },
            set: { newValue in
                if let onSetYoloMode {
                    onSetYoloMode(newValue)
                } else {
                    localYoloToggleFallback = newValue
                }
            }
        )
    }

    private var appVersionDisplay: String {
        bundleInfo("CFBundleShortVersionString") ?? "—"
    }

    private var buildNumberDisplay: String {
        bundleInfo("CFBundleVersion") ?? "—"
    }

    private var deploymentTargetDisplay: String {
        #if os(iOS)
        return "iOS 17.0"
        #else
        return "macOS 14.0"
        #endif
    }

    private func bundleInfo(_ key: String) -> String? {
        guard let value = Bundle.main.infoDictionary?[key] as? String,
              !value.isEmpty else {
            return nil
        }
        return value
    }
}

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
#Preview("iPhone Settings — disconnected") {
    NavigationStack {
        iPhoneSettingsView()
            .navigationTitle("Settings")
    }
}
#endif
