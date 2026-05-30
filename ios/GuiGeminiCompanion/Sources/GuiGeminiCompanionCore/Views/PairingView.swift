import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// PairingView — the device-neutral pairing screen.
///
/// iOS flow:
///   - Camera preview reads the QR shown on the Mac.
///   - On first detection, bytes flow to `viewModel.scan(...)`.
///   - View shows the 6-digit code while the response is sent to the Mac.
///   - After the Mac echoes the same code, user taps Confirm / "Codes
///     don't match"; final success waits for desktop approval.
///   - A "Paste JSON instead" fallback covers developer testing and
///     phones without working cameras.
///
/// macOS flow (used by SwiftPM tests + early dev runs):
///   - Paste-the-JSON field only — no AVFoundation on macOS for the
///     scanner is wired today.
@available(iOS 17.0, macOS 14.0, *)
public struct PairingView: View {
    @Bindable public var viewModel: PairingViewModel
    @State private var pastedJSON: String = ""
    @State private var showPasteFallback: Bool = false
    @State private var permissionDenied: Bool = false
    @State private var scannerError: String?
    @State private var wantsCameraScanner: Bool = false
    @State private var diagnosticsCopied: Bool = false
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    public init(viewModel: PairingViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                    pairingHeader

                    switch viewModel.state {
                    case .idle, .scanning, .failed:
                        scanScreen
                    case .awaitingDesktopVerification(let code, let displayName):
                        confirmingScreen(code: code, displayName: displayName, mode: .waitingForMac)
                    case .confirmingCode(let code, let displayName):
                        confirmingScreen(code: code, displayName: displayName, mode: .ready)
                    case .finalizing(let code, let displayName):
                        confirmingScreen(code: code, displayName: displayName, mode: .finalizing)
                    case .confirmed:
                        confirmedScreen
                    }
                }
                .padding(Theme.Spacing.screen)
            }
            .scrollIndicators(.hidden)
        }
        .onChange(of: viewModel.state) { _, _ in
            diagnosticsCopied = false
        }
    }

    @ViewBuilder
    private var pairingHeader: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            Image(systemName: "iphone.and.arrow.forward")
                .font(Theme.Typography.iconLarge)
                .foregroundStyle(Theme.accent)
                .frame(width: 68, height: 68)
                .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .stroke(Theme.strongBorder, lineWidth: 1)
                )
            Text("Pair with Mac")
                .font(Theme.Typography.appTitle)
                .foregroundStyle(Theme.Text.primary)
            Text("Connect this iPhone or iPad to the desktop bridge with the QR code or manual setup payload shown on your Mac.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var scanScreen: some View {
        #if os(iOS)
        iosScanScreen
        #else
        macPasteScreen
        #endif
        failureMessage
        if case .scanning = viewModel.state {
            ProgressView()
                .tint(Theme.accent)
                .frame(maxWidth: .infinity)
        }
    }

    #if os(iOS)
    @ViewBuilder
    private var iosScanScreen: some View {
        if showPasteFallback {
            macPasteScreen
            Button("Use camera instead") {
                showPasteFallback = false
                scannerError = nil
                wantsCameraScanner = false
                viewModel.reset()
            }
            .font(Theme.Typography.caption)
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity, alignment: .center)
        } else if permissionDenied {
            permissionDeniedCard
        } else if wantsCameraScanner {
            cameraScannerSurface
        } else {
            iosPairingOptions
        }
    }

    @ViewBuilder
    private var iosPairingOptions: some View {
        if horizontalSizeClass == .regular {
            VStack(spacing: Theme.Spacing.section) {
                macPasteScreen
                cameraPermissionCTA
            }
        } else {
            VStack(spacing: Theme.Spacing.section) {
                cameraPermissionCTA
                macPasteScreen
            }
        }
    }

    @ViewBuilder
    private var cameraPermissionCTA: some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: "camera.viewfinder")
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.accent)
                .frame(width: 90, height: 90)
                .background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                        .stroke(Theme.accent.opacity(0.24), lineWidth: 1)
                )
            Text("Scan the pairing QR")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Text.primary)
            Text("Camera scanning is optional. If this device cannot scan reliably, paste the setup payload below instead.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                withAnimation(Theme.Motion.quick) {
                    wantsCameraScanner = true
                }
            } label: {
                Label("Grant camera access", systemImage: "camera.fill")
                    .font(Theme.Typography.sectionTitle)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            Button("Focus manual setup") { showPasteFallback = true }
                .font(Theme.Typography.caption)
                .buttonStyle(.bordered)
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: Theme.shadowColor, radius: Theme.Shadow.cardRadius, y: Theme.Shadow.cardY)
    }

    @ViewBuilder
    private var cameraScannerSurface: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            Text("Point your camera at the QR shown on your Mac.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
            ZStack {
                QRScannerView(
                    onScan: { bytes in
                        viewModel.scan(bootstrapJSON: bytes)
                    },
                    onPermissionDenied: { permissionDenied = true },
                    onError: { message in scannerError = message }
                )
                .frame(maxWidth: .infinity, minHeight: 300)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.accent.opacity(0.72), style: StrokeStyle(lineWidth: 2, dash: [10, 8]))
                    .padding(52)
                    .allowsHitTesting(false)
            }
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .stroke(Theme.strongBorder, lineWidth: 1)
            )
            if let scannerError {
                InlineMessage(icon: "exclamationmark.triangle.fill", message: scannerError, color: Theme.destructive)
            }
            failureMessage
            Button("Paste JSON instead") { showPasteFallback = true }
                .font(Theme.Typography.caption)
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(Theme.Spacing.section)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: Theme.shadowColor, radius: Theme.Shadow.cardRadius, y: Theme.Shadow.cardY)
    }

    @ViewBuilder
    private var permissionDeniedCard: some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: "camera.slash")
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.destructive)
                .frame(width: 90, height: 90)
                .background(Theme.destructive.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
            Text("Camera access is required to scan the pairing QR.")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Text.primary)
                .multilineTextAlignment(.center)
            Text("Open Settings -> AGBench -> Camera, or use manual setup. Manual setup does not require a working camera.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Use manual setup") { showPasteFallback = true }
                .font(Theme.Typography.sectionTitle)
                .buttonStyle(.borderedProminent)
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.destructive.opacity(0.24), lineWidth: 1)
        )
        .shadow(color: Theme.shadowColor, radius: Theme.Shadow.cardRadius, y: Theme.Shadow.cardY)
    }
    #endif

    @ViewBuilder
    private var macPasteScreen: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            Label("Manual setup payload", systemImage: "doc.on.clipboard")
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.Text.primary)
            Text("Paste the setup payload copied from the Mac pairing screen. This is separate from the 6-digit verification code.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
            TextEditor(text: $pastedJSON)
                .font(Theme.Typography.code)
                .frame(minHeight: 132)
                .padding(8)
                .scrollContentBackground(.hidden)
                .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .stroke(Theme.border, lineWidth: 1)
                )
            Button {
                guard let bytes = pastedJSON.data(using: .utf8) else {
                    return
                }
                viewModel.scan(bootstrapJSON: bytes)
            } label: {
                Label("Start pairing", systemImage: "arrow.right.circle.fill")
                    .font(Theme.Typography.sectionTitle)
            }
            .buttonStyle(.borderedProminent)
            .disabled(pastedJSON.isEmpty)
        }
        .padding(Theme.Spacing.section)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: Theme.softShadowColor, radius: Theme.Shadow.softRadius, y: Theme.Shadow.softY)
    }

    private enum ConfirmationMode {
        case waitingForMac
        case ready
        case finalizing
    }

    @ViewBuilder
    private func confirmingScreen(code: String, displayName: String, mode: ConfirmationMode) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.section) {
            Label(confirmationTitle(for: mode), systemImage: confirmationIcon(for: mode))
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.Text.primary)
            Text(code)
                .font(Theme.Typography.codeDisplay)
                .tracking(8)
                .padding(.vertical, Theme.Spacing.control)
                .frame(maxWidth: .infinity)
                .background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .stroke(Theme.accent.opacity(0.26), lineWidth: 1)
                )
            Text("Pairing as: \(displayName)")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
                .lineLimit(2)
            if mode != .ready {
                HStack(spacing: Theme.Spacing.tight) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(Theme.accent)
                    Text(confirmationStatus(for: mode))
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Text.secondary)
                }
            }
            HStack(spacing: Theme.Spacing.control) {
                Button(role: .destructive, action: viewModel.cancel) {
                    Label("Codes don't match", systemImage: "xmark")
                }
                .buttonStyle(.bordered)
                .disabled(mode == .finalizing)
                Spacer()
                Button(action: viewModel.confirm) {
                    Label("Confirm", systemImage: "checkmark")
                        .font(Theme.Typography.sectionTitle)
                }
                .buttonStyle(.borderedProminent)
                .disabled(mode != .ready)
            }
        }
        .padding(Theme.Spacing.section)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: Theme.shadowColor, radius: Theme.Shadow.cardRadius, y: Theme.Shadow.cardY)
    }

    private func confirmationTitle(for mode: ConfirmationMode) -> String {
        switch mode {
        case .waitingForMac:
            return "Waiting for Mac verification"
        case .ready:
            return "Verify this code on your Mac"
        case .finalizing:
            return "Finishing pairing"
        }
    }

    private func confirmationIcon(for mode: ConfirmationMode) -> String {
        switch mode {
        case .waitingForMac:
            return "antenna.radiowaves.left.and.right"
        case .ready:
            return "lock.shield"
        case .finalizing:
            return "checkmark.shield"
        }
    }

    private func confirmationStatus(for mode: ConfirmationMode) -> String {
        switch mode {
        case .waitingForMac:
            return "Sending response to the desktop bridge"
        case .ready:
            return ""
        case .finalizing:
            return "Waiting for desktop confirmation"
        }
    }

    @ViewBuilder
    private var confirmedScreen: some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: "checkmark.seal.fill")
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.success)
            Text("Paired")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Text.primary)
            Text("The companion is ready to receive transcript events, approvals, and composer actions.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.success.opacity(0.24), lineWidth: 1)
        )
        .shadow(color: Theme.shadowColor, radius: Theme.Shadow.cardRadius, y: Theme.Shadow.cardY)
    }

    @ViewBuilder
    private var failureMessage: some View {
        if case .failed(let message) = viewModel.state {
            InlineMessage(icon: "exclamationmark.triangle.fill", message: message, color: Theme.destructive)
            HStack(spacing: Theme.Spacing.tight) {
                Button("Try again", action: viewModel.reset)
                    .font(Theme.Typography.caption)
                    .buttonStyle(.bordered)
                if viewModel.lastDiagnostics != nil {
                    Button(diagnosticsCopied ? "Diagnostics copied" : "Copy diagnostics") {
                        copyDiagnostics()
                    }
                    .font(Theme.Typography.caption)
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private func copyDiagnostics() {
        guard let diagnostics = viewModel.lastDiagnostics else { return }
        #if os(iOS)
        UIPasteboard.general.string = diagnostics
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(diagnostics, forType: .string)
        #endif
        diagnosticsCopied = true
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct InlineMessage: View {
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
    }
}
