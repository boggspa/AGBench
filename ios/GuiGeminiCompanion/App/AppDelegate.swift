import SwiftUI
import UIKit
@preconcurrency import UserNotifications
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
final class AppDelegate: NSObject, UIApplicationDelegate, @preconcurrency UNUserNotificationCenterDelegate {
    /// Shared reference so the SwiftUI hierarchy can route token
    /// events into AppState. Set by `GuiGeminiCompanionApp` at launch.
    weak var appState: AppState? {
        didSet {
            drainPendingNotificationRoutes()
        }
    }

    private var pendingNotificationDeliveries: [(userInfo: [AnyHashable: Any], trigger: RemoteNotificationResumeTrigger)] = []

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Request notification permission. The user gets a one-time
        // system prompt. We register for remote notifications regardless
        // of the answer — silent pushes can fire even without alert
        // permission. Lock-screen alerts require .alert; we ask for the
        // full set so the UX is best when granted.
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        Task {
            _ = try? await center.requestAuthorization(options: [.alert, .badge, .sound])
            await MainActor.run {
                application.registerForRemoteNotifications()
            }
        }
        if let notification = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            enqueueRemoteNotification(notification, trigger: .launch)
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

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard let appState else {
            enqueueRemoteNotification(userInfo, trigger: .background)
            completionHandler(.noData)
            return
        }
        Task { @MainActor in
            let result = await appState.handleRemoteNotification(userInfo: userInfo, trigger: .background)
            completionHandler(result.backgroundFetchResult)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        guard let appState else {
            enqueueRemoteNotification(userInfo, trigger: .tap)
            completionHandler()
            return
        }
        Task { @MainActor in
            await appState.handleRemoteNotification(userInfo: userInfo, trigger: .tap)
            completionHandler()
        }
    }

    private func enqueueRemoteNotification(
        _ userInfo: [AnyHashable: Any],
        trigger: RemoteNotificationResumeTrigger
    ) {
        pendingNotificationDeliveries.append((userInfo, trigger))
        drainPendingNotificationRoutes()
    }

    private func drainPendingNotificationRoutes() {
        guard let appState, !pendingNotificationDeliveries.isEmpty else { return }
        let deliveries = pendingNotificationDeliveries
        pendingNotificationDeliveries.removeAll()
        for delivery in deliveries {
            Task { @MainActor in
                await appState.handleRemoteNotification(
                    userInfo: delivery.userInfo,
                    trigger: delivery.trigger
                )
            }
        }
    }
}

private extension RemoteNotificationResumeResult {
    var backgroundFetchResult: UIBackgroundFetchResult {
        switch self {
        case .snapshotRequested:
            return .newData
        case .ignored, .noPair:
            return .noData
        case .snapshotUnavailable:
            return .failed
        }
    }
}
