import SwiftUI

/// PairingView — the iPhone-minimal pairing screen.
///
/// iOS flow:
///   - Camera preview reads the QR shown on the Mac.
///   - On first detection, bytes flow to `viewModel.scan(...)`.
///   - View transitions to `.confirmingCode` and shows the 6-digit code.
///   - User verifies the code matches the Mac, taps Confirm / "Codes
///     don't match".
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

    public init(viewModel: PairingViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Pair with Mac")
                .font(.largeTitle.bold())

            switch viewModel.state {
            case .idle, .scanning, .failed:
                scanScreen
            case .confirmingCode(let code, let displayName):
                confirmingScreen(code: code, displayName: displayName)
            case .confirmed:
                Text("Paired ✓")
                    .font(.title2)
                    .foregroundStyle(.green)
            }
        }
        .padding()
    }

    @ViewBuilder
    private var scanScreen: some View {
        #if os(iOS)
        iosScanScreen
        #else
        macPasteScreen
        #endif
        if case .scanning = viewModel.state {
            ProgressView()
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
                viewModel.reset()
            }
            .padding(.top, 8)
        } else if permissionDenied {
            VStack(spacing: 12) {
                Image(systemName: "camera.slash")
                    .font(.largeTitle)
                Text("Camera access is required to scan the pairing QR.")
                    .multilineTextAlignment(.center)
                Text("Open Settings → GUIGemini → Camera, or paste the QR's JSON instead.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Paste JSON instead") { showPasteFallback = true }
                    .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity)
            .padding()
        } else {
            Text("Point your camera at the QR shown on your Mac.")
                .foregroundStyle(.secondary)
            QRScannerView(
                onScan: { bytes in
                    viewModel.scan(bootstrapJSON: bytes)
                },
                onPermissionDenied: { permissionDenied = true },
                onError: { message in scannerError = message }
            )
            .frame(maxWidth: .infinity, minHeight: 280)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.secondary.opacity(0.3), lineWidth: 1)
            )
            if let scannerError {
                Text(scannerError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            if case .failed(let message) = viewModel.state {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.red)
                Button("Try again", action: viewModel.reset)
            }
            Button("Paste JSON instead") { showPasteFallback = true }
                .font(.caption)
                .buttonStyle(.bordered)
        }
    }
    #endif

    @ViewBuilder
    private var macPasteScreen: some View {
        Text("Paste the QR's JSON payload below.")
            .foregroundStyle(.secondary)
        TextEditor(text: $pastedJSON)
            .font(.system(.caption, design: .monospaced))
            .frame(minHeight: 120)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(.secondary.opacity(0.3)))
        Button("Scan") {
            guard let bytes = pastedJSON.data(using: .utf8) else {
                return
            }
            viewModel.scan(bootstrapJSON: bytes)
        }
        .disabled(pastedJSON.isEmpty)
        if case .failed(let message) = viewModel.state {
            Text(message)
                .font(.callout)
                .foregroundStyle(.red)
            Button("Try again", action: viewModel.reset)
        }
    }

    @ViewBuilder
    private func confirmingScreen(code: String, displayName: String) -> some View {
        Text("Verify this code on your Mac")
            .font(.headline)
        Text(code)
            .font(.system(.largeTitle, design: .monospaced).bold())
            .tracking(8)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 12))
        Text("Pairing as: \(displayName)")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        HStack(spacing: 12) {
            Button(role: .destructive, action: viewModel.cancel) {
                Text("Codes don't match")
            }
            .buttonStyle(.bordered)
            Spacer()
            Button(action: viewModel.confirm) {
                Text("Confirm")
                    .font(.headline)
            }
            .buttonStyle(.borderedProminent)
        }
    }
}
