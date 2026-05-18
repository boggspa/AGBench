import SwiftUI
import GuiGeminiCompanionCore

/// App entry point for the GUIGemini iOS companion.
///
/// Uses `@UIApplicationDelegateAdaptor` to wire `AppDelegate` for APNs
/// registration callbacks; the SwiftUI `@main` App protocol doesn't
/// natively expose `UIApplicationDelegate` methods.
///
/// The app is a thin SwiftUI App that hosts a `RootView` deciding what
/// to show based on whether a pair has been established. On first run
/// the user sees `PairingView`; after pairing, the main `TabView` with
/// transcript / approvals / composer.
@main
struct GuiGeminiCompanionApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var appState: AppState

    init() {
        // CRITICAL: install the GUIGemini-flavoured BridgeProductConfiguration
        // BEFORE any transport spins up. Without this the default
        // CodexBridge config wins, so the iPad's QUIC ALPN is
        // "codexbridge-live-v1" while the Mac daemon expects
        // "guigemini-live-v1" — TLS handshake fails silently,
        // NWConnection never reaches `.ready`, and broadcasts get
        // delivered to zero subscribers.
        GuiGeminiBridgeProductConfiguration.install()
        _appState = State(initialValue: AppState())
    }

    var body: some Scene {
        WindowGroup {
            RootView(appState: appState)
                .onAppear {
                    // Tie the delegate to AppState so APNs callbacks
                    // can route into the registrar.
                    appDelegate.appState = appState
                }
        }
    }
}
