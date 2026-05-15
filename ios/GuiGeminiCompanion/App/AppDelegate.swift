import SwiftUI
import UIKit
import UserNotifications
import GuiGeminiCompanionCore

/// AppDelegate — iOS-only shim for APNs registration callbacks.
///
/// SwiftUI's `@main` App protocol doesn't natively wire the
/// `UIApplicationDelegate` lifecycle. We use `@UIApplicationDelegateAdaptor`
/// in `GuiGeminiCompanionApp` to bridge.
///
/// Responsibilities:
///   - Request user notification permission on first launch.
///   - Hand the OS-issued APNs device token to `AppState.handleAPNsToken(...)`.
///   - Surface registration errors via the same path.
///
/// Token bytes are forwarded to `PushNotificationRegistrar` (in the
/// library), which encodes hex + ships a `BridgeActionPayload.registerApnsToken`
/// action via `GuiGeminiBridgeClient`. The Mac side's
/// `BridgeApnsTokenStore` is the persistent record.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    /// Shared reference so the SwiftUI hierarchy can route token
    /// events into AppState. Set by `GuiGeminiCompanionApp` at launch.
    weak var appState: AppState?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Request notification permission. The user gets a one-time
        // system prompt. We register for remote notifications regardless
        // of the answer — silent pushes can fire even without alert
        // permission. Lock-screen alerts require .alert; we ask for the
        // full set so the UX is best when granted.
        Task {
            let center = UNUserNotificationCenter.current()
            _ = try? await center.requestAuthorization(options: [.alert, .badge, .sound])
            await MainActor.run {
                application.registerForRemoteNotifications()
            }
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        guard let appState else { return }
        Task { await appState.handleAPNsToken(deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Surface to AppState so the UI can show a "push registration
        // failed" affordance. Non-fatal — the app still works without
        // push (just no wake-on-approval).
        Task { @MainActor [weak appState] in
            appState?.recordPushError(error.localizedDescription)
        }
    }
}
