import SwiftUI

#if os(iOS)
// `@preconcurrency` suppresses strict-Sendable warnings for AVFoundation
// types. AVCaptureSession is documented thread-safe by Apple but not
// formally Sendable; the recommended pattern is a dedicated session
// queue, which we do below via DispatchQueue.
@preconcurrency import AVFoundation
import UIKit

/// QRScannerView — SwiftUI wrapper around AVCaptureSession for scanning
/// pairing QR codes on iOS.
///
/// What this does:
///   - Configures an AVCaptureSession with the default video device.
///   - Adds an AVCaptureMetadataOutput restricted to `.qr` symbology.
///   - Renders the camera preview via AVCaptureVideoPreviewLayer.
///   - Delivers scanned bytes via the `onScan` callback ONCE per session —
///     after the first valid QR is read, capture stops to prevent a
///     repeated barrage of the same data.
///   - Handles camera-permission UX: when the user has not yet granted
///     access, requests it on first appear; on denial, surfaces a state
///     the caller renders ("Open Settings to enable camera").
///
/// What this does NOT do:
///   - Decode the JSON payload inside the QR — that's the caller's job
///     via `PairingViewModel.scan(bootstrapJSON:)`. This view only delivers
///     the raw scanned bytes.
///   - Validate the QR's content — any string the camera reads gets handed
///     to the caller, even non-pairing payloads. The view model rejects
///     non-pairing JSON via its decode error path.
///
/// On macOS (where this library still builds for unit tests), the entire
/// view is omitted; the `PairingView` falls back to the paste-the-JSON
/// path. The `#if os(iOS)` boundary keeps the cross-platform build green.
public struct QRScannerView: UIViewControllerRepresentable {
    /// Fired once when a QR is read. The caller typically transitions
    /// to a confirmation screen and stops the scanner.
    public let onScan: (Data) -> Void
    /// Fired when permission denial blocks the scanner from running.
    /// Caller renders an "Open Settings" affordance.
    public let onPermissionDenied: () -> Void
    /// Fired on hardware errors (no camera, AVCaptureSession failed).
    public let onError: (String) -> Void

    public init(
        onScan: @escaping (Data) -> Void,
        onPermissionDenied: @escaping () -> Void = {},
        onError: @escaping (String) -> Void = { _ in }
    ) {
        self.onScan = onScan
        self.onPermissionDenied = onPermissionDenied
        self.onError = onError
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    public func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.coordinator = context.coordinator
        return controller
    }

    public func updateUIViewController(_ controller: QRScannerViewController, context: Context) {
        // No-op — the controller manages its own lifecycle.
    }

    public final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        let parent: QRScannerView
        private var didDeliver = false

        init(parent: QRScannerView) { self.parent = parent }

        public func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard !didDeliver else { return }
            for metadata in metadataObjects {
                guard
                    let machineReadable = metadata as? AVMetadataMachineReadableCodeObject,
                    machineReadable.type == .qr,
                    let string = machineReadable.stringValue,
                    let bytes = string.data(using: .utf8)
                else { continue }
                didDeliver = true
                parent.onScan(bytes)
                return
            }
        }
    }
}

/// UIViewController hosting the AVCaptureSession. Owns the preview layer
/// and runs the session start/stop on viewDidAppear/viewDidDisappear so
/// the camera is released when the view goes off-screen.
public final class QRScannerViewController: UIViewController {
    weak var coordinator: QRScannerView.Coordinator?
    private let captureSession = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var didConfigure = false
    /// Apple-recommended pattern: a dedicated serial queue for session
    /// configuration + start/stop calls so `startRunning()` doesn't
    /// block the main thread.
    private let sessionQueue = DispatchQueue(label: "com.example.AGBench.companion.qrScanner.session")

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
    }

    public override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        Task { await configureIfNeeded() }
    }

    public override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if captureSession.isRunning {
            // Stop on the session queue per Apple's guidance.
            sessionQueue.async { [captureSession] in
                captureSession.stopRunning()
            }
        }
    }

    public override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    @MainActor
    private func configureIfNeeded() async {
        guard !didConfigure else { return }

        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            break
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            if !granted {
                coordinator?.parent.onPermissionDenied()
                return
            }
        case .denied, .restricted:
            coordinator?.parent.onPermissionDenied()
            return
        @unknown default:
            coordinator?.parent.onPermissionDenied()
            return
        }

        didConfigure = true

        guard
            let device = AVCaptureDevice.default(for: .video),
            let input = try? AVCaptureDeviceInput(device: device)
        else {
            coordinator?.parent.onError("No video capture device available")
            return
        }

        if captureSession.canAddInput(input) {
            captureSession.addInput(input)
        } else {
            coordinator?.parent.onError("Capture session refused video input")
            return
        }

        let metadataOutput = AVCaptureMetadataOutput()
        if captureSession.canAddOutput(metadataOutput) {
            captureSession.addOutput(metadataOutput)
            metadataOutput.setMetadataObjectsDelegate(coordinator, queue: .main)
            metadataOutput.metadataObjectTypes = [.qr]
        } else {
            coordinator?.parent.onError("Capture session refused metadata output")
            return
        }

        let preview = AVCaptureVideoPreviewLayer(session: captureSession)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)
        previewLayer = preview

        sessionQueue.async { [captureSession] in
            captureSession.startRunning()
        }
    }
}

#endif
