import Foundation
import Observation
import BridgeCore
import AGBenchRunActivityShared

/// TranscriptViewModel — consumes a `GuiGeminiBridgeClient.runEvents`
/// stream and exposes BOTH the raw `events` log (for the legacy iPad
/// timeline and the live-activity reducer) AND a coalesced
/// `TranscriptStore` that groups streaming text deltas into message
/// bubbles (for the new `TranscriptView` rendering).
///
/// Why both shapes side by side: the live-activity reducer downstream
/// in `AGBenchRunActivityEventReducer` consumes raw events one-by-one,
/// and the iPad's `iPadThreadPane` still wants the dense timeline as a
/// secondary tab. The bubble view consumes `TranscriptStore.groups`.
/// Both are derived from the same authoritative event sequence so there
/// is no risk of the two diverging.
///
/// Memory: events are capped at `maxRetained` (default 500); groups at
/// `TranscriptStore.maxRetainedGroups` (default 200). Older entries
/// drop off the front when the cap is exceeded.
@Observable
@MainActor
public final class TranscriptViewModel {
    public private(set) var events: [BridgeRunEvent] = []
    /// Latest connection status seen on the client's `status` stream.
    /// nil until first observed.
    public private(set) var lastStatus: String?
    /// Human-readable direct route currently carrying the bridge.
    public private(set) var activeRouteLabel: String?
    /// Coalesced bubble groups built from `events`. The new transcript
    /// view binds to this directly; the legacy timeline still walks the
    /// raw `events` array.
    public let transcriptStore: TranscriptStore

    public let maxRetained: Int

    private var runEventsTask: Task<Void, Never>?
    private var statusTask: Task<Void, Never>?
    private var routeTask: Task<Void, Never>?
    private let liveActivityController: AGBenchLiveActivityController?
    private var liveActivityReducer = AGBenchRunActivityEventReducer()

    public init(
        maxRetained: Int = 500,
        liveActivityController: AGBenchLiveActivityController? = nil,
        transcriptStore: TranscriptStore? = nil
    ) {
        self.maxRetained = maxRetained
        self.liveActivityController = liveActivityController
        self.transcriptStore = transcriptStore ?? TranscriptStore()
    }

    /// Subscribe to a client's streams. Cancels any previous
    /// subscription. The view model retains the subscription tasks; call
    /// `detach()` when the view goes away.
    public func attach(to client: GuiGeminiBridgeClient, consumeRunEvents: Bool = true) {
        detach()
        let status = client.status
        if consumeRunEvents {
            let runEvents = client.runEvents
            runEventsTask = Task { [weak self] in
                for await event in runEvents {
                    self?.append(event)
                }
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

    /// Wipe both the raw event buffer and the coalesced group array.
    /// Usually wired to a "clear transcript" button.
    public func clear() {
        events.removeAll()
        transcriptStore.clear()
    }

    // MARK: - Test affordance

    /// Inject a synthetic event for unit tests and previews. Goes through
    /// the same path as live events so tests exercise both the raw `events`
    /// append AND the coalesced `transcriptStore` mutation.
    public func ingestForTesting(_ event: BridgeRunEvent) {
        append(event)
    }

    /// Ingest one live bridge event when a higher-level coordinator owns
    /// the `client.runEvents` subscription and fans events out to multiple
    /// consumers. This avoids multiple `AsyncStream` iterators racing each
    /// other in production while preserving the old `attach(to:)` default
    /// for tests and standalone use.
    public func ingest(_ event: BridgeRunEvent) {
        append(event)
    }

    // MARK: - Private

    private func append(_ event: BridgeRunEvent) {
        // Workspace + thread summary broadcasts are sidebar-store data,
        // not transcript log lines — skip them so the transcript stays
        // focused on agent output / error / exit. The dedicated subscriber
        // in AppState routes them via BridgeWorkspaceSummariesDecoder.
        switch event.channel {
        case .workspaceList, .workspaceUpdated, .threadList, .threadUpdated, .remoteProjection:
            return
        case .agentOutput, .agentError, .agentExit,
             .geminiOutput, .geminiError, .geminiExit:
            break
        }
        events.append(event)
        if events.count > maxRetained {
            events.removeFirst(events.count - maxRetained)
        }
        transcriptStore.ingest(event)
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
