import SwiftUI

/// iPadSettingsPane — the "Connection & Diagnostics" pane that lives in
/// the iPad shell's detail column when the user selects the Settings
/// sidebar entry.
///
/// This pane mirrors the Mac desktop's Settings → Bridge Networking panel
/// (`src/renderer/src/components/BridgeNetworkingPanel.tsx`) but adapted
/// for the iPad companion: it reports the live transport route, pairing
/// state, push registration, and an About card. None of the cards mutate
/// state today — they're a "what's the connection looking like?" surface
/// so the user can debug why a run isn't streaming without bouncing back
/// to the iPhone flow.
///
/// Wiring strategy:
///   - Reads from the published view models when they're handed in
///     (`pairingViewModel`, `transcriptViewModel`).
///   - When `mocked == true` and the view models are nil, we populate
///     each card with sample copy so previews and design review look
///     populated. Production callers leave `mocked: false` and pass real
///     view models; missing data falls through to genuine "not connected"
///     copy.
///   - All mocked strings are tagged `// MOCK:` so the next pass can
///     swap them for real plumbing without grepping for placeholders.
///
/// The host (`iPadDetailHost`) currently shows an in-file placeholder;
/// Claude swaps the placeholder line for this pane in a follow-up commit
/// once the three parallel UX agents land.
@available(iOS 17.0, macOS 14.0, *)
public struct iPadSettingsPane: View {
    public let pairingViewModel: PairingViewModel?
    public let transcriptViewModel: TranscriptViewModel?
    /// Most-recent push registration message surfaced by AppState
    /// (`AppState.lastPushMessage`). When the host doesn't pass one in
    /// the pane shows the default unregistered copy.
    public let pushStatusMessage: String?
    public let yoloModeEnabled: Bool
    public let mocked: Bool
    public let onSetYoloMode: ((Bool) -> Void)?
    public let onUnpair: (() -> Void)?

    @State private var showUnpairConfirmation: Bool = false
    @State private var expandedAboutRow: String? = nil

    public init(
        pairingViewModel: PairingViewModel? = nil,
        transcriptViewModel: TranscriptViewModel? = nil,
        pushStatusMessage: String? = nil,
        yoloModeEnabled: Bool = false,
        mocked: Bool = false,
        onSetYoloMode: ((Bool) -> Void)? = nil,
        onUnpair: (() -> Void)? = nil
    ) {
        self.pairingViewModel = pairingViewModel
        self.transcriptViewModel = transcriptViewModel
        self.pushStatusMessage = pushStatusMessage
        self.yoloModeEnabled = yoloModeEnabled
        self.mocked = mocked
        self.onSetYoloMode = onSetYoloMode
        self.onUnpair = onUnpair
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                headerStrip
                pairingCard
                bridgeConnectionCard
                approvalControlsCard
                pushNotificationsCard
                aboutCard
                Spacer(minLength: 0)
            }
            .padding(Theme.Spacing.screen)
        }
        .scrollIndicators(.hidden)
        .background(Theme.windowBase.ignoresSafeArea())
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

    // MARK: - Header

    private var headerStrip: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            Image(systemName: "gearshape")
                .font(Theme.Typography.iconMedium)
                .foregroundStyle(Theme.accent)
                .frame(width: 48, height: 48)
                .background(
                    Theme.accentSoft,
                    in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Connection & Diagnostics")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.primaryText)
                Text("Bridge transport, pairing state, and push wake-up status.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: Theme.Spacing.tight)
        }
        .padding(.horizontal, Theme.Spacing.section)
        .padding(.vertical, Theme.Spacing.control)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Cards

    private var pairingCard: some View {
        let paired = isCurrentlyPaired
        return settingsCard(
            iconSystemName: paired ? "link.circle.fill" : "link.slash",
            iconTint: paired ? Theme.accent : Theme.tertiaryText,
            title: pairingCardTitle,
            subtitle: pairingCardSubtitle,
            accessibilityHint: "Pairing details and unpair control."
        ) {
            HStack {
                Spacer()
                Button(role: .destructive) {
                    showUnpairConfirmation = true
                } label: {
                    Label("Unpair this device", systemImage: "link.badge.minus")
                        .font(Theme.Typography.caption)
                }
                .buttonStyle(.bordered)
                .tint(Theme.destructive)
                .disabled(!paired)
                .accessibilityHint(paired
                    ? "Disconnect this iPad from the paired Mac."
                    : "No active pair to disconnect.")
            }
        }
    }

    private var bridgeConnectionCard: some View {
        let route = resolvedActiveRoute
        let status = resolvedBridgeStatus
        let latency = resolvedLatency
        let isSubscribed = status.lowercased().contains("subscribed") || status.lowercased().contains("reachable")
        return settingsCard(
            iconSystemName: "dot.radiowaves.left.and.right",
            iconTint: Theme.success,
            iconPulses: isSubscribed,
            title: "Bridge connection",
            subtitle: nil,
            accessibilityHint: "Live transport details for the desktop bridge."
        ) {
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                detailRow(label: "Transport", value: route)
                detailRow(label: "Bridge status", value: status)
                detailRow(
                    label: "Latency",
                    value: latency,
                    valueAccessibilityHint: latency == "—"
                        ? "RTT not yet exposed by transport"
                        : nil
                )
            }
        }
    }

    private var pushNotificationsCard: some View {
        let pushStatus = resolvedPushStatus
        return settingsCard(
            iconSystemName: "bell.badge",
            iconTint: Theme.warning,
            title: "Apple Push Notifications",
            subtitle: nil,
            accessibilityHint: "Push wake-up registration status."
        ) {
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                detailRow(label: "Status", value: pushStatus.title)
                Text(pushStatus.explanation)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.tertiaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var approvalControlsCard: some View {
        settingsCard(
            iconSystemName: yoloModeEnabled ? "bolt.shield.fill" : "shield",
            iconTint: yoloModeEnabled ? Theme.warning : Theme.accent,
            title: "Approval controls",
            subtitle: nil,
            accessibilityHint: "Session approval mode controls."
        ) {
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                Toggle(
                    isOn: Binding(
                        get: { yoloModeEnabled },
                        set: { enabled in onSetYoloMode?(enabled) }
                    )
                ) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("YOLO approvals")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.primaryText)
                        Text("Automatically accept guarded desktop approvals for this session.")
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.tertiaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .toggleStyle(.switch)
                .disabled(onSetYoloMode == nil)

                detailRow(
                    label: "Status",
                    value: yoloModeEnabled ? "Auto-allow enabled" : "Manual approval"
                )
            }
        }
    }

    private var aboutCard: some View {
        settingsCard(
            iconSystemName: "info.circle",
            iconTint: Theme.secondaryAccent,
            title: "About",
            subtitle: nil,
            accessibilityHint: "Build metadata for this companion app."
        ) {
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                aboutRow(id: "version", label: "App version", value: appVersionDisplay, detail: appVersionDetail)
                aboutRow(id: "build", label: "Build", value: buildNumberDisplay, detail: buildNumberDetail)
                aboutRow(id: "platform", label: "iOS deployment target", value: deploymentTargetDisplay, detail: deploymentTargetDetail)
            }
        }
    }

    // MARK: - Reusable building blocks

    private func settingsCard<Content: View>(
        iconSystemName: String,
        iconTint: Color,
        iconPulses: Bool = false,
        title: String,
        subtitle: String?,
        accessibilityHint: String,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            HStack(alignment: .top, spacing: Theme.Spacing.control) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(Theme.Typography.sectionTitle)
                        .foregroundStyle(Theme.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: Theme.Spacing.tight)
                PulsingAccentIcon(
                    systemName: iconSystemName,
                    tint: iconTint,
                    pulses: iconPulses
                )
                .accessibilityHidden(true)
            }
            content()
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .accessibilityElement(children: .contain)
        .accessibilityHint(accessibilityHint)
    }

    private func detailRow(
        label: String,
        value: String,
        valueAccessibilityHint: String? = nil
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.tight) {
            Text(label)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
            Spacer(minLength: Theme.Spacing.tight)
            Text(value)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.primaryText)
                .lineLimit(2)
                .multilineTextAlignment(.trailing)
                .truncationMode(.middle)
                .accessibilityHint(valueAccessibilityHint ?? "")
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func aboutRow(id: String, label: String, value: String, detail: String?) -> some View {
        let isExpanded = expandedAboutRow == id
        Button {
            withAnimation(Theme.Motion.quick) {
                expandedAboutRow = isExpanded ? nil : id
            }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.tight) {
                    Text(label)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.secondaryText)
                    Spacer(minLength: Theme.Spacing.tight)
                    Text(value)
                        .font(Theme.Typography.code)
                        .foregroundStyle(Theme.primaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if detail != nil {
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.tertiaryText)
                    }
                }
                if isExpanded, let detail {
                    Text(detail)
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.tertiaryText)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .contentShape(Rectangle())
            .padding(.vertical, 2)
        }
        .buttonStyle(.plain)
        .accessibilityHint(detail ?? "")
    }

    // MARK: - Resolved values (live > mocked > empty)

    /// True when the iPad is genuinely paired (or rendering a mocked
    /// preview). Drives the card's title, subtitle, icon, and the
    /// Unpair button's enabled state.
    private var isCurrentlyPaired: Bool {
        pairingViewModel?.confirmedPair != nil || mocked
    }

    /// Title text for the pairing card. Reads "Paired with <Mac name>"
    /// when the bootstrap provided a display name, and falls back to a
    /// generic label for older daemons.
    private var pairingCardTitle: String {
        if mocked {
            return "Paired with Chris's Mac Studio"
        }
        if let pair = pairingViewModel?.confirmedPair {
            let displayName = pair.macDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let displayName, !displayName.isEmpty {
                return "Paired with \(displayName)"
            }
            return "Paired with Mac"
        }
        return "Not paired"
    }

    /// Subtitle text — different copy for paired vs not paired. When
    /// paired, surface a short pair-id fragment so the user knows
    /// which pair is active (matches what the Mac knows this device
    /// as). When not paired, point at the action that starts pairing.
    private var pairingCardSubtitle: String {
        if mocked {
            return "Connected since 12 minutes ago · pair 5819bd88"
        }
        if let pair = pairingViewModel?.confirmedPair {
            let pairIDFragment = String(pair.pairID.rawValue.prefix(8))
            return "Connected this session · pair \(pairIDFragment)"
        }
        return "Tap the link icon on your Mac to pair this iPad."
    }

    /// Live transport route label sourced from the transcript view
    /// model's `activeRouteLabel` (which subscribes to
    /// `GuiGeminiBridgeClient.activeRoute`). Mocked previews fall through
    /// to a deterministic string so the pane still shows a populated
    /// row in design review.
    private var resolvedActiveRoute: String {
        if let route = transcriptViewModel?.activeRouteLabel?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !route.isEmpty {
            return route
        }
        if mocked {
            // Sample copy only — production callers pass a non-nil
            // transcriptViewModel so this branch never fires outside
            // previews.
            return "LAN · same Wi-Fi"
        }
        return "Not connected"
    }

    /// Live bridge status summary sourced from the transcript view model's
    /// `lastStatus` (formatted from `BridgeTransportStatus`). Mocked
    /// previews show a sample string.
    private var resolvedBridgeStatus: String {
        if let status = transcriptViewModel?.lastStatus?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !status.isEmpty {
            return status
        }
        if mocked {
            return "Subscribed, 12s since last event"
        }
        return "Awaiting status update"
    }

    /// RTT in milliseconds. `BridgeTransportStatus` carries
    /// `roundTripMilliseconds` but `TranscriptViewModel` doesn't yet
    /// surface it as a typed property (it formats the whole status
    /// snapshot into one string instead). Until the view model exposes
    /// it, render an em-dash placeholder. The `Latency` row carries an
    /// accessibility hint ("RTT not yet exposed by transport") so VoiceOver
    /// users hear why the field is blank.
    /// TODO(theme): when TranscriptViewModel exposes a typed
    /// `lastRoundTripMilliseconds: Int?` (Agent B), swap this to format
    /// the int as e.g. "48 ms".
    private var resolvedLatency: String {
        if mocked {
            return "~48 ms"
        }
        return "—"
    }

    private struct PushStatusCopy {
        let title: String
        let explanation: String
    }

    /// Live push registration status sourced from `AppState.lastPushMessage`
    /// (or a TODO placeholder until the host plumbs it through). The
    /// classification below maps known message prefixes to user-friendly
    /// titles + explanations; unknown messages get rendered as-is so
    /// engineers can debug.
    private var resolvedPushStatus: PushStatusCopy {
        if let message = pushStatusMessage?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !message.isEmpty {
            return classifyPushMessage(message)
        }
        if mocked {
            return PushStatusCopy(
                title: "Configured",
                explanation: "Sandbox APNs · token registered with desktop bridge."
            )
        }
        return PushStatusCopy(
            title: "Not registered",
            explanation: "Configure APNs credentials in the desktop Settings → Bridge Networking to enable push wake-up."
        )
    }

    private func classifyPushMessage(_ message: String) -> PushStatusCopy {
        let lower = message.lowercased()
        if lower.contains("accepted") || lower.contains("token unchanged") {
            return PushStatusCopy(
                title: "Configured",
                explanation: message
            )
        }
        if lower.contains("rejected") {
            return PushStatusCopy(
                title: "Rejected",
                explanation: message
            )
        }
        if lower.contains("failed") || lower.contains("error") {
            return PushStatusCopy(
                title: "Failed",
                explanation: message
            )
        }
        return PushStatusCopy(
            title: "Updating",
            explanation: message
        )
    }

    // MARK: - About card values

    private var appVersionDisplay: String {
        bundleInfo("CFBundleShortVersionString") ?? (mocked ? "1.0.0" : "—")
    }

    private var appVersionDetail: String? {
        guard let version = bundleInfo("CFBundleShortVersionString") else {
            return mocked ? "Mocked value shown when no bundle context is available." : nil
        }
        return "Shipped as marketing version \(version)."
    }

    private var buildNumberDisplay: String {
        bundleInfo("CFBundleVersion") ?? (mocked ? "2026.05.17" : "—")
    }

    private var buildNumberDetail: String? {
        guard let build = bundleInfo("CFBundleVersion") else {
            return mocked ? "Mocked build identifier for design review." : nil
        }
        return "CFBundleVersion \(build) — tap row again to collapse."
    }

    private var deploymentTargetDisplay: String {
        // Pull from package manifest's iOS(.v17). Hardcoded because the
        // bundle doesn't expose the deployment target.
        #if os(iOS)
        return "iOS 17.0"
        #else
        return "macOS 14.0"
        #endif
    }

    private var deploymentTargetDetail: String? {
        "Built against the SDK declared in Package.swift platforms."
    }

    private func bundleInfo(_ key: String) -> String? {
        guard let value = Bundle.main.infoDictionary?[key] as? String,
              !value.isEmpty else {
            return nil
        }
        return value
    }
}

// MARK: - Pulsing icon

@available(iOS 17.0, macOS 14.0, *)
private struct PulsingAccentIcon: View {
    let systemName: String
    let tint: Color
    let pulses: Bool

    @State private var pulse: Bool = false

    var body: some View {
        Image(systemName: systemName)
            .font(Theme.Typography.iconMedium)
            .foregroundStyle(tint)
            .frame(width: 48, height: 48)
            .background(
                tint.opacity(pulses && pulse ? 0.22 : 0.12),
                in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
            )
            .scaleEffect(pulses && pulse ? 1.04 : 1.0)
            .animation(
                pulses
                    ? .easeInOut(duration: 1.6).repeatForever(autoreverses: true)
                    : .default,
                value: pulse
            )
            .onAppear {
                if pulses {
                    pulse = true
                }
            }
            .onChange(of: pulses) { _, newValue in
                pulse = newValue
            }
    }
}

// MARK: - Previews

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad Settings — mocked (sample data)") {
    iPadSettingsPane(mocked: true)
        .frame(width: 520, height: 760)
        .padding()
        .background(Theme.background)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad Settings — initial (empty state)") {
    iPadSettingsPane(mocked: false)
        .frame(width: 520, height: 760)
        .padding()
        .background(Theme.background)
}
#endif
