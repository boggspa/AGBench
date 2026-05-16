import Foundation
import AGBenchRunActivityShared

#if os(iOS) && canImport(ActivityKit)
import ActivityKit
#endif

public enum AGBenchLiveActivityDismissalPolicy: Sendable, Equatable {
    case immediate
    case `default`
    case after(TimeInterval)
}

public protocol AGBenchLiveActivityAuthorizationProviding: Sendable {
    func areLiveActivitiesEnabled() -> Bool
}

public struct SystemAGBenchLiveActivityAuthorization: AGBenchLiveActivityAuthorizationProviding {
    public init() {}

    public func areLiveActivitiesEnabled() -> Bool {
        #if os(iOS) && canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            return ActivityAuthorizationInfo().areActivitiesEnabled
        }
        #endif
        return false
    }
}

public protocol AGBenchLiveActivityBackend: Sendable {
    func start(
        attributes: AGBenchRunActivityAttributes,
        state: AGBenchRunActivityAttributes.ContentState
    ) async throws
    func update(
        runId: String,
        state: AGBenchRunActivityAttributes.ContentState
    ) async
    func end(
        runId: String,
        finalState: AGBenchRunActivityAttributes.ContentState,
        dismissalPolicy: AGBenchLiveActivityDismissalPolicy
    ) async
}

public actor AGBenchLiveActivityController {
    private let authorization: any AGBenchLiveActivityAuthorizationProviding
    private let backend: any AGBenchLiveActivityBackend
    private var activeRunIds: Set<String> = []

    public init(
        authorization: any AGBenchLiveActivityAuthorizationProviding = SystemAGBenchLiveActivityAuthorization(),
        backend: (any AGBenchLiveActivityBackend)? = nil
    ) {
        self.authorization = authorization
        self.backend = backend ?? Self.defaultBackend()
    }

    public func start(
        runId: String,
        provider: String,
        workspaceName: String,
        threadTitle: String
    ) async {
        let state = AGBenchRunActivityAttributes.ContentState(
            status: .running,
            lastEventSummary: "Run started"
        )
        await start(
            attributes: AGBenchRunActivityAttributes(
                runId: runId,
                provider: provider,
                workspaceName: workspaceName,
                threadTitle: threadTitle
            ),
            state: state
        )
    }

    public func start(
        attributes: AGBenchRunActivityAttributes,
        state: AGBenchRunActivityAttributes.ContentState
    ) async {
        guard authorization.areLiveActivitiesEnabled() else { return }
        if activeRunIds.contains(attributes.runId) {
            await backend.update(runId: attributes.runId, state: state)
            return
        }
        do {
            try await backend.start(attributes: attributes, state: state)
            activeRunIds.insert(attributes.runId)
        } catch {
            #if DEBUG
            print("AGBench Live Activity start failed: \(error)")
            #endif
        }
    }

    public func update(runId: String, state: AGBenchRunActivityAttributes.ContentState) async {
        guard authorization.areLiveActivitiesEnabled(),
              activeRunIds.contains(runId)
        else { return }
        await backend.update(runId: runId, state: state)
    }

    public func end(
        runId: String,
        finalState: AGBenchRunActivityAttributes.ContentState,
        dismissalPolicy: AGBenchLiveActivityDismissalPolicy
    ) async {
        guard authorization.areLiveActivitiesEnabled(),
              activeRunIds.contains(runId)
        else { return }
        await backend.end(runId: runId, finalState: finalState, dismissalPolicy: dismissalPolicy)
        activeRunIds.remove(runId)
    }

    public func apply(_ effect: AGBenchRunActivityEffect) async {
        switch effect {
        case .start(let attributes, let state):
            await start(attributes: attributes, state: state)
        case .update(let runId, let state):
            await update(runId: runId, state: state)
        case .end(let runId, let finalState, let dismissalPolicy):
            await end(runId: runId, finalState: finalState, dismissalPolicy: dismissalPolicy)
        }
    }

    public func isTracking(runId: String) -> Bool {
        activeRunIds.contains(runId)
    }

    private static func defaultBackend() -> any AGBenchLiveActivityBackend {
        #if os(iOS) && canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            return ActivityKitAGBenchLiveActivityBackend()
        }
        #endif
        return NoopAGBenchLiveActivityBackend()
    }
}

private struct NoopAGBenchLiveActivityBackend: AGBenchLiveActivityBackend {
    func start(
        attributes: AGBenchRunActivityAttributes,
        state: AGBenchRunActivityAttributes.ContentState
    ) async throws {}

    func update(
        runId: String,
        state: AGBenchRunActivityAttributes.ContentState
    ) async {}

    func end(
        runId: String,
        finalState: AGBenchRunActivityAttributes.ContentState,
        dismissalPolicy: AGBenchLiveActivityDismissalPolicy
    ) async {}
}

#if os(iOS) && canImport(ActivityKit)
@available(iOS 16.2, *)
private struct ActivityKitAGBenchLiveActivityBackend: AGBenchLiveActivityBackend {
    func start(
        attributes: AGBenchRunActivityAttributes,
        state: AGBenchRunActivityAttributes.ContentState
    ) async throws {
        let known = knownActivities(for: attributes.runId)
        if let existing = known.first {
            await existing.update(ActivityContent(state: state, staleDate: nil))
            for duplicate in known.dropFirst() {
                await duplicate.end(nil, dismissalPolicy: .immediate)
            }
            return
        }
        _ = try Activity.request(
            attributes: attributes,
            content: ActivityContent(state: state, staleDate: nil),
            pushType: nil
        )
    }

    func update(
        runId: String,
        state: AGBenchRunActivityAttributes.ContentState
    ) async {
        guard let activity = activity(for: runId) else { return }
        await activity.update(ActivityContent(state: state, staleDate: nil))
    }

    func end(
        runId: String,
        finalState: AGBenchRunActivityAttributes.ContentState,
        dismissalPolicy: AGBenchLiveActivityDismissalPolicy
    ) async {
        guard let activity = activity(for: runId) else { return }
        await activity.end(
            ActivityContent(state: finalState, staleDate: nil),
            dismissalPolicy: dismissalPolicy.activityKitValue
        )
    }

    private func activity(for runId: String) -> Activity<AGBenchRunActivityAttributes>? {
        knownActivities(for: runId).first
    }

    private func knownActivities(for runId: String) -> [Activity<AGBenchRunActivityAttributes>] {
        Activity<AGBenchRunActivityAttributes>.activities.filter { $0.attributes.runId == runId }
    }
}

@available(iOS 16.2, *)
private extension AGBenchLiveActivityDismissalPolicy {
    var activityKitValue: ActivityUIDismissalPolicy {
        switch self {
        case .immediate:
            return .immediate
        case .default:
            return .default
        case .after(let seconds):
            return .after(Date().addingTimeInterval(seconds))
        }
    }
}
#endif
