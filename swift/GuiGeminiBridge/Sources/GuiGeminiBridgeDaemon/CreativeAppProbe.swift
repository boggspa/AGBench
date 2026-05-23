import Foundation
import AppKit

/// Probes for the running-state of bundle IDs the renderer cares about
/// (Final Cut Pro, Logic Pro, Blender at time of writing — but the probe
/// is bundle-id agnostic and works for anything macOS knows about).
///
/// Phase K1 — replaces the renderer's naive `fileExists("/Applications/
/// Final Cut Pro.app")` heuristic with a real running-process check via
/// `NSRunningApplication.runningApplications(withBundleIdentifier:)`.
/// That distinction matters for the creative-app integration tools:
/// "installed" is necessary but not sufficient to dispatch a control
/// message; the agent should know whether the app is actually open
/// before suggesting a workflow that needs it focused.
///
/// Concurrency: `NSRunningApplication` is documented as safe to call
/// off the main thread for read-only queries, and the daemon already
/// dispatches RPC handlers off the main run-loop. No locking required
/// here — each call is a fresh snapshot of the running-apps table.
enum CreativeAppProbe {
    /// Map each requested bundle id to whether at least one process
    /// with that bundle id is currently running. Caller is expected
    /// to keep the bundle-id list short (the renderer asks about
    /// roughly half a dozen at most); this loop is O(n × m) where n
    /// is the requested list and m is the system's running-apps
    /// count, both small.
    static func runningBundleIds(_ bundleIds: [String]) -> [String: Bool] {
        var result: [String: Bool] = [:]
        for bundleId in bundleIds {
            // `runningApplications(withBundleIdentifier:)` returns an
            // empty array for unknown / not-running bundle ids. A
            // non-empty array means at least one process with that
            // bundle id is up (FCP can launch multiple instances under
            // weird configurations; we treat "≥1" as running for the
            // agent's purposes).
            let matches = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            result[bundleId] = !matches.isEmpty
        }
        return result
    }
}
