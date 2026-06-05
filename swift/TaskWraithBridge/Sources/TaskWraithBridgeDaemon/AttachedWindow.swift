import Foundation
import AppKit
import CoreGraphics
// See main.swift for rationale — ScreenCaptureKit is pre-Swift-6, our
// flow doesn't actually race on its types, `@preconcurrency` downgrades
// the strict-mode complaints to warnings.
@preconcurrency import ScreenCaptureKit

/// Per-window metadata returned to the Electron side after a successful pick.
/// Sourced from `SCShareableContent` correlation against the picker's filter
/// (see `AttachedWindowMetaResolver`) because `SCContentFilter.includedWindows`
/// is macOS 15.2+ only and the daemon targets macOS 14.
struct AttachedWindowMeta: Sendable {
    let windowID: CGWindowID
    let title: String
    let bundleID: String
    let applicationName: String
    let pid: Int

    func toJSONObject() -> [String: Any] {
        return [
            "windowID": Int(windowID),
            "title": title,
            "bundleID": bundleID,
            "applicationName": applicationName,
            "pid": pid
        ]
    }
}

/// Stored entry in the in-memory handle table. UUID is opaque to callers — the
/// AI side only ever sees the handle string, never an enumeration of windows.
/// The `filter` is the picker's grant and is what `SCScreenshotManager` needs
/// for capture; we hold on to it for the handle's lifetime so we don't have
/// to re-correlate window metadata on every refresh.
///
/// `stream` is the optional Appwatch SCStream owned by this entry. M1 ships
/// at most one stream per entry; detaching the handle (or replacing it via a
/// new pick) must tear the stream down so we never leak an SCStream past the
/// user's intent. Reference type so the store can hand callers a stable
/// pointer without copying the actor.
final class AttachedWindowEntry: @unchecked Sendable {
    let handleID: String
    let meta: AttachedWindowMeta
    let filter: SCContentFilter
    let createdAt: Date
    /// Lazily populated by `appwatch.start`. Nil until the first start call;
    /// reset to nil when the handle detaches or the entry is replaced.
    var stream: AttachedWindowStream?

    init(handleID: String, meta: AttachedWindowMeta, filter: SCContentFilter, createdAt: Date) {
        self.handleID = handleID
        self.meta = meta
        self.filter = filter
        self.createdAt = createdAt
    }
}

/// In-memory handle table. Lives for the daemon process lifetime — never
/// persisted to disk, dropped on process exit. Kept simple because the table
/// is small and ephemeral by design.
actor AttachedWindowStore {
    private var entries: [String: AttachedWindowEntry] = [:]
    private var currentHandle: String?

    func attach(meta: AttachedWindowMeta, filter: SCContentFilter) -> AttachedWindowEntry {
        let entry = AttachedWindowEntry(
            handleID: UUID().uuidString.lowercased(),
            meta: meta,
            filter: filter,
            createdAt: Date()
        )
        entries[entry.handleID] = entry
        currentHandle = entry.handleID
        return entry
    }

    /// Detach a single handle. Any Appwatch stream owned by the entry is
    /// stopped first — leaving a streaming SCStream alive after the user
    /// detached would silently keep the camera-like indicator running and
    /// would slowly leak frames into a buffer no one can drain.
    @discardableResult
    func detach(handleID: String) async -> Bool {
        guard let entry = entries.removeValue(forKey: handleID) else {
            if currentHandle == handleID { currentHandle = nil }
            return false
        }
        if let stream = entry.stream {
            await stream.stop()
            entry.stream = nil
        }
        if currentHandle == handleID { currentHandle = nil }
        return true
    }

    func detachAll() async {
        for (_, entry) in entries {
            if let stream = entry.stream {
                await stream.stop()
                entry.stream = nil
            }
        }
        entries.removeAll()
        currentHandle = nil
    }

    func entry(handleID: String) -> AttachedWindowEntry? {
        return entries[handleID]
    }

    func current() -> AttachedWindowEntry? {
        guard let id = currentHandle else { return nil }
        return entries[id]
    }

    func count() -> Int {
        return entries.count
    }

    /// Set (or replace) the stream associated with a handle. The caller is
    /// expected to have just constructed the stream and called `start`; we
    /// keep this method on the store so the handle ↔ stream wiring stays
    /// behind one isolation boundary. If a stream was already present we
    /// stop it before swapping — a second `appwatch.start` is idempotent
    /// at the JSON-RPC level, so this code path only fires when a caller
    /// genuinely wants to replace the stream (e.g. a test rig).
    func setStream(_ stream: AttachedWindowStream, for handleID: String) async {
        guard let entry = entries[handleID] else { return }
        if let existing = entry.stream, existing !== stream {
            await existing.stop()
        }
        entry.stream = stream
    }

    /// Clear the stream associated with a handle. Does NOT stop the stream
    /// itself — callers stop and then clear separately so the JSON-RPC
    /// `appwatch.stop` handler can return the final status before the entry
    /// loses its reference.
    func clearStream(for handleID: String) {
        if let entry = entries[handleID] {
            entry.stream = nil
        }
    }
}

enum AttachedWindowError: LocalizedError {
    case cancelled
    case noWindowSelected
    case windowGone
    case pickerFailed(String)
    case pngEncodingFailed

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "Window pick was cancelled."
        case .noWindowSelected:
            return "Pick must select a single window."
        case .windowGone:
            return "Attached window is no longer available (likely closed)."
        case .pickerFailed(let reason):
            return "Window picker failed: \(reason)"
        case .pngEncodingFailed:
            return "Failed to encode captured frame as PNG."
        }
    }
}

/// Presents `SCContentSharingPicker` on the main thread and produces a single
/// `AttachedWindowMeta` + the picker's `SCContentFilter`. The picker is the
/// security boundary: Apple decides what windows are shown, the user clicks
/// one, and we receive a filter we can immediately use for `SCScreenshotManager`.
///
/// Concurrency model: SCContentSharingPicker delivers observer callbacks on
/// the main queue (per Apple's docs). The methods themselves are declared
/// `nonisolated` on the protocol, so we leave them as plain methods and rely
/// on Apple's delivery contract plus an internal `NSLock` for state safety
/// rather than dragging in actor isolation that fights the protocol.
final class AttachedWindowPicker: NSObject, @unchecked Sendable, SCContentSharingPickerObserver {
    typealias Completion = (Result<(meta: AttachedWindowMeta, filter: SCContentFilter), AttachedWindowError>) -> Void

    private let stateLock = NSLock()
    private var completion: Completion?
    private var fired = false

    /// Present the picker. Must be invoked from the main thread because
    /// `SCContentSharingPicker.present` shows UI.
    @MainActor
    func pick(completion: @escaping Completion) {
        stateLock.lock()
        self.completion = completion
        stateLock.unlock()

        let picker = SCContentSharingPicker.shared
        var config = SCContentSharingPickerConfiguration()
        config.allowedPickerModes = [.singleWindow]
        config.allowsChangingSelectedContent = true
        picker.defaultConfiguration = config
        picker.maximumStreamCount = 1
        picker.add(self)
        picker.isActive = true
        picker.present()
    }

    private func finish(_ result: Result<(meta: AttachedWindowMeta, filter: SCContentFilter), AttachedWindowError>) {
        stateLock.lock()
        if fired {
            stateLock.unlock()
            return
        }
        fired = true
        let cb = completion
        completion = nil
        stateLock.unlock()

        // Deactivate the picker on main — SCContentSharingPicker.shared is
        // a singleton owned by the WindowServer-connected app context, and
        // toggling `isActive` from a background queue is unsupported.
        DispatchQueue.main.async {
            let picker = SCContentSharingPicker.shared
            picker.isActive = false
            picker.remove(self)
        }
        cb?(result)
    }

    // MARK: SCContentSharingPickerObserver

    // The protocol declares these as nonisolated. Apple delivers them on the
    // main queue today, but we don't lean on that — the lock + atomic-fire
    // guard inside `finish` keeps state safe regardless.
    func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didUpdateWith filter: SCContentFilter,
        for stream: SCStream?
    ) {
        Task { [filter] in
            do {
                let meta = try await AttachedWindowMetaResolver.resolve(filter: filter)
                finish(.success((meta, filter)))
            } catch let err as AttachedWindowError {
                finish(.failure(err))
            } catch {
                finish(.failure(.pickerFailed(error.localizedDescription)))
            }
        }
    }

    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        finish(.failure(.cancelled))
    }

    func contentSharingPickerStartDidFailWithError(_ error: any Error) {
        finish(.failure(.pickerFailed(error.localizedDescription)))
    }
}

/// Resolves a picker-produced `SCContentFilter` back to a concrete `SCWindow`
/// so we can return its title / bundle id / application name to the UI.
/// `SCContentFilter.includedWindows` would do this directly but is macOS 15.2+
/// only, so on macOS 14 we enumerate `SCShareableContent` and correlate by
/// frame rectangle. The first call also serves as our Screen Recording TCC
/// probe — the picker grants per-window access, but `SCShareableContent`
/// requires the standard permission and will surface a clean error if not
/// granted.
enum AttachedWindowMetaResolver {
    static func resolve(filter: SCContentFilter) async throws -> AttachedWindowMeta {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let window = bestMatch(for: filter, in: content.windows) else {
            // Filter doesn't correlate to any visible window — the most
            // likely cause is that the user closed it between picking and
            // our enumeration. Surface as "window gone" so the renderer
            // sees a clean reset rather than a partial attach.
            throw AttachedWindowError.windowGone
        }
        return AttachedWindowMeta(
            windowID: window.windowID,
            title: window.title ?? "",
            bundleID: window.owningApplication?.bundleIdentifier ?? "",
            applicationName: window.owningApplication?.applicationName ?? "",
            pid: Int(window.owningApplication?.processID ?? 0)
        )
    }

    /// Best-effort correlation. `filter.contentRect` is in pixel coordinates
    /// (relative to the captured content's display); `window.frame` is in
    /// points (relative to the screen). We project window frames into pixel
    /// space via `filter.pointPixelScale` and pick the window whose pixel
    /// dimensions and origin best match the filter rect — typically there
    /// is exactly one matching window.
    private static func bestMatch(for filter: SCContentFilter, in windows: [SCWindow]) -> SCWindow? {
        let filterRect = filter.contentRect
        let scale = max(0.0001, Double(filter.pointPixelScale))

        var bestWindow: SCWindow?
        var bestScore = Double.infinity
        for window in windows {
            let frame = window.frame
            let pixelWidth = Double(frame.size.width) * scale
            let pixelHeight = Double(frame.size.height) * scale

            // Score against size first — origin matching is unreliable
            // across screen-coordinate vs display-relative differences.
            let widthDelta = abs(pixelWidth - Double(filterRect.size.width))
            let heightDelta = abs(pixelHeight - Double(filterRect.size.height))
            let score = widthDelta + heightDelta
            if score < bestScore {
                bestScore = score
                bestWindow = window
            }
        }

        // Tolerate up to ~4 px slop on each axis (combined). Beyond that we
        // probably don't have the right window — better to surface as "gone"
        // than to silently attach to the wrong one.
        return bestScore < 8 ? bestWindow : nil
    }
}

/// One-shot window capture. Uses the picker-derived `SCContentFilter`
/// directly — no re-enumeration, no window-id lookup, so capture survives
/// even when the user moves or resizes the window between snapshots.
struct CapturedWindowFrame: @unchecked Sendable {
    let pngData: Data
    let width: Int
    let height: Int
}

enum AttachedWindowCapture {
    static func captureWindow(
        filter: SCContentFilter,
        maxDimensionPx: Int
    ) async throws -> CapturedWindowFrame {
        let filterRect = filter.contentRect
        let baseWidth = max(1.0, Double(filterRect.size.width))
        let baseHeight = max(1.0, Double(filterRect.size.height))
        let longest = max(baseWidth, baseHeight)
        let cap = max(1, maxDimensionPx)
        let scale = min(1.0, Double(cap) / longest)
        let targetWidth = max(1, Int((baseWidth * scale).rounded()))
        let targetHeight = max(1, Int((baseHeight * scale).rounded()))

        let config = SCStreamConfiguration()
        config.width = targetWidth
        config.height = targetHeight
        config.scalesToFit = true
        config.showsCursor = false
        config.capturesAudio = false

        let cgImage: CGImage
        do {
            cgImage = try await SCScreenshotManager.captureImage(
                contentFilter: filter,
                configuration: config
            )
        } catch {
            // ScreenCaptureKit raises when the target window has gone away.
            // Surface as a structured "window gone" so the JSON-RPC layer
            // can self-heal (clear the handle) and the renderer pill clears.
            throw AttachedWindowError.windowGone
        }

        let bitmap = NSBitmapImageRep(cgImage: cgImage)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw AttachedWindowError.pngEncodingFailed
        }
        return CapturedWindowFrame(
            pngData: png,
            width: cgImage.width,
            height: cgImage.height
        )
    }
}
