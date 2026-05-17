import Foundation
import Observation
import BridgeCore
import AGBenchRunActivityShared

/// TranscriptViewModel — consumes a `GuiGeminiBridgeClient.runEvents`
/// stream and renders an append-only list of events for the UI.
///
/// Today's shape is intentionally simple: every BridgeRunEvent that
/// arrives gets appended. The view shows them in chronological order.
/// When iOS-side filtering (subscribe to specific chats / runs) is added,
/// the filter goes here so the underlying stream stays generic.
///
/// Memory: capped to `maxRetained` events (default 500). Older events
/// drop off the front when the cap is exceeded. UI consumers can hold a
/// per-chat / per-run scroll position via the event identifiers since
/// each carries a `publishedAt` timestamp that orders monotonically per
/// stream.
@Observable
@MainActor
public final class TranscriptViewModel {
    public private(set) var events: [BridgeRunEvent] = []
    /// Latest connection status seen on the client's `status` stream.
    /// nil until first observed.
    public private(set) var lastStatus: String?
    /// Human-readable direct route currently carrying the bridge.
    public private(set) var activeRouteLabel: String?

    public let maxRetained: Int

    private var runEventsTask: Task<Void, Never>?
    private var statusTask: Task<Void, Never>?
    private var routeTask: Task<Void, Never>?
    private let liveActivityController: AGBenchLiveActivityController?
    private var liveActivityReducer = AGBenchRunActivityEventReducer()

    public init(
        maxRetained: Int = 500,
        liveActivityController: AGBenchLiveActivityController? = nil
    ) {
        self.maxRetained = maxRetained
        self.liveActivityController = liveActivityController
    }

    /// Subscribe to a client's streams. Cancels any previous
    /// subscription. The view model retains the subscription tasks; call
    /// `detach()` when the view goes away.
    public func attach(to client: GuiGeminiBridgeClient) {
        detach()
        let runEvents = client.runEvents
        let status = client.status
        runEventsTask = Task { [weak self] in
            for await event in runEvents {
                self?.append(event)
            }
        }
        statusTask = Task { [weak self] in
            for await status in status {
                self?.update(status: status)
            }
        }
        let activeRoute = client.activeRoute
        routeTask = Task { [weak self] in
            for await route in activeRoute {
                self?.update(route: route)
            }
        }
    }

    public func detach() {
        runEventsTask?.cancel()
        runEventsTask = nil
        statusTask?.cancel()
        statusTask = nil
        routeTask?.cancel()
        routeTask = nil
        liveActivityReducer = AGBenchRunActivityEventReducer()
    }

    /// Wipe the buffer — usually wired to a "clear transcript" button.
    public func clear() {
        events.removeAll()
    }

    // MARK: - Private

    private func append(_ event: BridgeRunEvent) {
        // Workspace + thread summary broadcasts are sidebar-store data,
        // not transcript log lines — skip them so the transcript stays
        // focused on agent output / error / exit. The dedicated subscriber
        // in AppState routes them via BridgeWorkspaceSummariesDecoder.
        switch event.channel {
        case .workspaceList, .workspaceUpdated, .threadList, .threadUpdated:
            return
        case .agentOutput, .agentError, .agentExit,
             .geminiOutput, .geminiError, .geminiExit:
            break
        }
        events.append(event)
        if events.count > maxRetained {
            events.removeFirst(events.count - maxRetained)
        }
        guard let effect = liveActivityReducer.apply(event),
              let liveActivityController
        else { return }
        Task {
            await liveActivityController.apply(effect)
        }
    }

    private func update(status: BridgeTransportStatus) {
        // BridgeTransportStatus is a struct with a diagnostic shape; we
        // surface a short single-line summary for the view's status pill.
        if status.reachable {
            activeRouteLabel = GuiGeminiBridgeClient.activeRoute(for: status.kind)?.rawValue
        }
        lastStatus = "\(status)"
    }

    private func update(route: GuiGeminiBridgeClient.ActiveRoute) {
        activeRouteLabel = route.rawValue
    }
}
