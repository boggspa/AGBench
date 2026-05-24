import Foundation
import AppKit
import CoreGraphics
import CoreMedia
import CoreVideo
// ScreenCaptureKit predates Swift 6 strict concurrency. Same `@preconcurrency`
// trick we use for the single-shot capture path (see `AttachedWindow.swift`)
// downgrades the strict-mode warnings without papering over real races; we
// only mutate stream state from inside the actor, and the `SCStreamOutput`
// delegate hand-offs go through a `@unchecked Sendable` shim below.
@preconcurrency import ScreenCaptureKit

// MARK: - Public surface

/// One frame stored in the ring buffer. Bytes are kept as raw BGRA8 so the
/// stream output path stays cheap (no per-frame PNG encode). Encoding to PNG
/// happens lazily inside `appwatch.latestFrame` when the agent actually asks
/// for pixels. `@unchecked Sendable` because `Data` is value-type but the
/// compiler can't prove our value-copy intent across actor boundaries.
struct RingFrame: @unchecked Sendable {
    let capturedAt: Date
    let bgra: Data
    let width: Int
    let height: Int
    let bytesPerRow: Int
}

/// The resolved configuration after a successful `start` — what the agent
/// gets back so it can tell whether the daemon clamped its requested values.
/// All fields are echoed verbatim from the start call; the daemon only
/// rejects out-of-budget configs (it does not silently rewrite them).
struct AppwatchStreamConfig: Sendable, Encodable {
    let fps: Int
    let bufferSeconds: Int
    let maxDimensionPx: Int
    let frameCapacity: Int
    let estimatedMemoryMB: Double
    let startedAt: Date
}

/// Status snapshot — surfaced via `appwatch.status` for the renderer pill
/// and any agent polling the stream. `streaming = false` means the stream is
/// either never-started or torn down; the rest of the fields are best-effort
/// snapshots from inside the actor and may be slightly stale by the time the
/// caller deserialises them.
struct AppwatchStatus: Sendable, Encodable {
    let streaming: Bool
    let fps: Int
    let bufferSeconds: Int
    let frameCount: Int
    let frameCapacity: Int
    let oldestAt: Date?
    let newestAt: Date?
    let estimatedMemoryMB: Double
    let memoryBudgetMB: Double
    let lastPullAt: Date?
    let startedAt: Date?
}

struct AppwatchBufferedFrames: Sendable {
    let frames: [RingFrame]
    let availableCapturedAt: [Date]
    let nextSince: Date?
}

enum AppwatchError: LocalizedError, Sendable {
    case alreadyStreaming
    case notStreaming
    case invalidConfig(String)
    /// Estimated buffer footprint exceeds the daemon's 350 MB cap. The
    /// number reported is the estimate at start time so the agent can
    /// retune (smaller buffer / lower fps / smaller maxDimensionPx) and
    /// retry. The cap itself is a constant on `AttachedWindowStream`.
    case memoryBudgetExceeded(estimatedMB: Double, budgetMB: Double)
    case streamSetupFailed(String)
    case pngEncodingFailed

    var errorDescription: String? {
        switch self {
        case .alreadyStreaming:
            return "Appwatch is already streaming this window."
        case .notStreaming:
            return "Appwatch is not streaming (call appwatch.start first)."
        case .invalidConfig(let reason):
            return "Invalid Appwatch config: \(reason)"
        case .memoryBudgetExceeded(let estimated, let budget):
            return String(
                format: "Appwatch buffer would use ~%.1f MB, above the %.0f MB cap. Reduce bufferSeconds, fps, or maxDimensionPx.",
                estimated, budget
            )
        case .streamSetupFailed(let reason):
            return "Appwatch stream setup failed: \(reason)"
        case .pngEncodingFailed:
            return "Failed to encode the latest Appwatch frame as PNG."
        }
    }
}

// MARK: - Stream actor

/// One singleton SCStream per attached window, owning a small ring of recent
/// frames. Designed for M1: agents can pull "the most recent frame" without
/// per-call ScreenCaptureKit overhead. M2 extends this with batch-since
/// retrieval and per-frame OCR; the ring shape already supports the former.
///
/// The stream runs at low fps (5 default) into a fixed-size ring sized by
/// `bufferSeconds × fps`. On overflow we evict from the front — newest frame
/// always wins. Idle-timeout: 60s without a pull tears the stream down so a
/// crashed/hung agent doesn't keep the camera-like SCStream warm forever.
///
/// Concurrency:
///   - Actor isolation handles the ring's read/write protection.
///   - `SCStreamOutput` callbacks land on whatever queue we hand SCStream;
///     they hop into the actor via a `@Sendable` Task. The hop is cheap (in-
///     process, single-thread actor) and lets us keep the BGRA copy off the
///     SCStream's hot delivery thread.
///   - The idle-timeout poller is a single `Task` that wakes every 5s and
///     calls back into the actor to check / tear down.
actor AttachedWindowStream {
    /// Hard cap on the ring footprint. Set at the daemon-product level — the
    /// agent doesn't pick this. 350 MB is well within macOS process limits
    /// (Electron alone often sits at ~600 MB) and bounds the buffer at e.g.
    /// 8s × 5fps × 1280px BGRA = ~33 MB; the cap forgives a 10× misconfig
    /// before rejecting.
    static let memoryBudgetMB: Double = 350.0

    /// How long an idle stream (no `latestFrame` pulls) stays alive before
    /// auto-stop. 60s is short enough to keep stale streams from leaking
    /// when an agent crashes mid-loop, long enough to survive a long LLM
    /// turn between pulls.
    static let idleTimeoutSeconds: TimeInterval = 60.0

    /// How often the idle-timeout poller checks. 5s gives at most a 5s
    /// shutdown jitter relative to the 60s ideal — fine for a non-realtime
    /// signal.
    static let idlePollIntervalSeconds: TimeInterval = 5.0

    private var stream: SCStream?
    private var output: StreamOutput?
    private var streamQueue: DispatchQueue?
    private var ring: [RingFrame] = []
    private var frameCapacity: Int = 0
    private var fps: Int = 0
    private var bufferSeconds: Int = 0
    private var maxDimensionPx: Int = 0
    private var startedAt: Date?
    private var lastPullAt: Date?
    private var idleTimeoutTask: Task<Void, Never>?
    private var currentConfig: AppwatchStreamConfig?

    /// Capacity of the actor's ring buffer at the configured fps × bufferSeconds.
    /// Internal so tests can read it without poking into ring directly.
    var ringCapacity: Int { frameCapacity }

    /// Whether `start` has been called and the SCStream is live. Used by the
    /// JSON-RPC handlers to make `appwatch.start` idempotent.
    var isStreaming: Bool { stream != nil }

    /// Memory cost (in megabytes) for a single full-size BGRA frame at the
    /// given max-dimension. Used by both the start-time budget check and the
    /// status snapshot. The longer side is capped at `maxDimensionPx`; the
    /// other axis is estimated as equal (worst-case square window).
    static func estimatedFrameBytes(maxDimensionPx: Int) -> Int {
        let dim = max(1, maxDimensionPx)
        return dim * dim * 4 // BGRA8 = 4 bytes per pixel
    }

    /// Convenience for the start-time budget check and status output.
    static func estimatedBufferMB(fps: Int, bufferSeconds: Int, maxDimensionPx: Int) -> Double {
        let frameBytes = Double(estimatedFrameBytes(maxDimensionPx: maxDimensionPx))
        let totalBytes = frameBytes * Double(max(0, fps)) * Double(max(0, bufferSeconds))
        return totalBytes / (1024.0 * 1024.0)
    }

    // MARK: Lifecycle

    @discardableResult
    func start(
        filter: SCContentFilter,
        fps requestedFps: Int,
        bufferSeconds requestedBufferSeconds: Int,
        maxDimensionPx requestedMaxDimension: Int
    ) async throws -> AppwatchStreamConfig {
        if let existing = currentConfig, isStreaming {
            // Idempotent — second `start` with whatever config returns the
            // existing config. We don't tear down + restart because the
            // agent's reasoning is: "ensure a stream is up", not "force a
            // restart". The renderer state machine relies on this so it
            // can call start on attach without worrying about double-start.
            return existing
        }
        guard requestedFps > 0, requestedFps <= 30 else {
            throw AppwatchError.invalidConfig("fps must be between 1 and 30 (got \(requestedFps))")
        }
        guard requestedBufferSeconds > 0, requestedBufferSeconds <= 60 else {
            throw AppwatchError.invalidConfig("bufferSeconds must be between 1 and 60 (got \(requestedBufferSeconds))")
        }
        guard requestedMaxDimension >= 240, requestedMaxDimension <= 4096 else {
            throw AppwatchError.invalidConfig("maxDimensionPx must be between 240 and 4096 (got \(requestedMaxDimension))")
        }

        let estimatedMB = Self.estimatedBufferMB(
            fps: requestedFps,
            bufferSeconds: requestedBufferSeconds,
            maxDimensionPx: requestedMaxDimension
        )
        if estimatedMB > Self.memoryBudgetMB {
            throw AppwatchError.memoryBudgetExceeded(
                estimatedMB: estimatedMB,
                budgetMB: Self.memoryBudgetMB
            )
        }

        // Size the output texture using the same filter-rect math the single-
        // shot capture path uses. We scale the longer side to maxDimensionPx
        // and let scalesToFit preserve aspect ratio.
        let filterRect = filter.contentRect
        let baseWidth = max(1.0, Double(filterRect.size.width))
        let baseHeight = max(1.0, Double(filterRect.size.height))
        let longest = max(baseWidth, baseHeight)
        let cap = Double(requestedMaxDimension)
        let scale = min(1.0, cap / longest)
        let targetWidth = max(1, Int((baseWidth * scale).rounded()))
        let targetHeight = max(1, Int((baseHeight * scale).rounded()))

        let config = SCStreamConfiguration()
        config.width = targetWidth
        config.height = targetHeight
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(requestedFps))
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.queueDepth = 3
        config.scalesToFit = true
        config.showsCursor = false
        config.capturesAudio = false

        let queue = DispatchQueue(
            label: "com.example.AGBench.daemon.appwatch.stream",
            qos: .userInitiated
        )
        // Strong reference held inside `output`. The delegate hand-off uses
        // a weak self capture into the Task hop so we don't form a cycle.
        let output = StreamOutput { [weak self] frame in
            guard let self else { return }
            Task { await self.ingestFrame(frame) }
        }
        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        do {
            try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: queue)
        } catch {
            throw AppwatchError.streamSetupFailed(error.localizedDescription)
        }

        let capacity = max(1, requestedFps * requestedBufferSeconds)
        self.ring = []
        self.ring.reserveCapacity(capacity)
        self.frameCapacity = capacity
        self.fps = requestedFps
        self.bufferSeconds = requestedBufferSeconds
        self.maxDimensionPx = requestedMaxDimension
        self.stream = stream
        self.output = output
        self.streamQueue = queue
        let started = Date()
        self.startedAt = started
        // First "pull" anchor is the start time — so an agent that calls
        // `appwatch.start` and then forgets the stream still triggers the
        // 60s idle timeout from the start moment, not from frame #1.
        self.lastPullAt = started

        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                stream.startCapture { error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume()
                    }
                }
            }
        } catch {
            // Roll back the actor state so a failed start doesn't poison
            // the next attempt.
            self.stream = nil
            self.output = nil
            self.streamQueue = nil
            self.ring.removeAll()
            self.frameCapacity = 0
            self.fps = 0
            self.bufferSeconds = 0
            self.maxDimensionPx = 0
            self.startedAt = nil
            self.lastPullAt = nil
            throw AppwatchError.streamSetupFailed(error.localizedDescription)
        }

        let resolvedConfig = AppwatchStreamConfig(
            fps: requestedFps,
            bufferSeconds: requestedBufferSeconds,
            maxDimensionPx: requestedMaxDimension,
            frameCapacity: capacity,
            estimatedMemoryMB: estimatedMB,
            startedAt: started
        )
        self.currentConfig = resolvedConfig
        startIdleTimeoutPoller()
        return resolvedConfig
    }

    func stop() {
        idleTimeoutTask?.cancel()
        idleTimeoutTask = nil
        if let stream {
            // Best-effort stop — SCStream's stopCapture is async and we don't
            // need to block the caller. Errors get logged to stderr for
            // diagnosis but don't propagate (the renderer has already moved
            // on by the time stop is invoked).
            stream.stopCapture { error in
                if let error {
                    FileHandle.standardError.write(Data(
                        "[Appwatch] stop: stopCapture error \(error.localizedDescription)\n".utf8
                    ))
                }
            }
            if let output {
                try? stream.removeStreamOutput(output, type: .screen)
            }
        }
        stream = nil
        output = nil
        streamQueue = nil
        ring.removeAll()
        frameCapacity = 0
        fps = 0
        bufferSeconds = 0
        maxDimensionPx = 0
        startedAt = nil
        lastPullAt = nil
        currentConfig = nil
    }

    /// Returns the most recent frame and bumps `lastPullAt`. Returning nil
    /// means the stream is up but hasn't produced a frame yet (rare — the
    /// first frame typically lands within ~200ms of start).
    func latestFrame() -> RingFrame? {
        lastPullAt = Date()
        return ring.last
    }

    /// Return a chronological batch of frames. With `since`, this returns the
    /// first `count` frames newer than that timestamp so callers can page
    /// through the ring using `nextSince`. Without `since`, it returns the
    /// latest `count` frames, still in chronological order.
    func frames(since: Date?, count requestedCount: Int) -> AppwatchBufferedFrames {
        lastPullAt = Date()
        let count = max(1, min(20, requestedCount))
        let available = ring.map(\.capturedAt)
        let candidates: [RingFrame]
        if let since {
            candidates = ring.filter { $0.capturedAt > since }
        } else {
            candidates = Array(ring.suffix(count))
        }
        let selected = Array(candidates.prefix(count))
        return AppwatchBufferedFrames(
            frames: selected,
            availableCapturedAt: available,
            nextSince: selected.last?.capturedAt ?? since ?? ring.last?.capturedAt
        )
    }

    /// Read-only status. Does NOT bump lastPullAt — the renderer pill polls
    /// this and we don't want a UI poll to reset the idle clock.
    func status() -> AppwatchStatus {
        let estimatedMB = Self.estimatedBufferMB(
            fps: fps,
            bufferSeconds: bufferSeconds,
            maxDimensionPx: maxDimensionPx
        )
        return AppwatchStatus(
            streaming: isStreaming,
            fps: fps,
            bufferSeconds: bufferSeconds,
            frameCount: ring.count,
            frameCapacity: frameCapacity,
            oldestAt: ring.first?.capturedAt,
            newestAt: ring.last?.capturedAt,
            estimatedMemoryMB: estimatedMB,
            memoryBudgetMB: Self.memoryBudgetMB,
            lastPullAt: lastPullAt,
            startedAt: startedAt
        )
    }

    // MARK: Test-only ingestion path
    //
    // `start(filter:...)` requires a real SCContentFilter produced by
    // SCContentSharingPicker, which can't be synthesised in a unit test (no
    // window, no TCC grant in the test process). The ring-buffer eviction
    // policy and the memory-budget math are pure logic, so we expose a
    // mock-only `appendFrame` that lets tests drive the ring directly.
    //
    // Internal so it can't leak into the production code path.
    #if DEBUG
    func _appendFrameForTesting(_ frame: RingFrame) {
        ingestFrameSync(frame)
    }

    func _configureForTesting(fps: Int, bufferSeconds: Int, maxDimensionPx: Int) {
        self.fps = fps
        self.bufferSeconds = bufferSeconds
        self.maxDimensionPx = maxDimensionPx
        self.frameCapacity = max(1, fps * bufferSeconds)
        self.startedAt = Date()
        self.lastPullAt = Date()
        self.ring = []
        self.ring.reserveCapacity(frameCapacity)
    }
    #endif

    // MARK: Internals

    private func ingestFrame(_ frame: RingFrame) {
        ingestFrameSync(frame)
    }

    private func ingestFrameSync(_ frame: RingFrame) {
        guard frameCapacity > 0 else { return }
        // Append-then-evict-from-front keeps "newest wins" semantics. With
        // capacity 40 the linear remove is a constant-time small-N copy —
        // not worth a Deque dependency.
        ring.append(frame)
        if ring.count > frameCapacity {
            ring.removeFirst(ring.count - frameCapacity)
        }
    }

    private func startIdleTimeoutPoller() {
        idleTimeoutTask?.cancel()
        idleTimeoutTask = Task { [weak self] in
            while !Task.isCancelled {
                let interval = AttachedWindowStream.idlePollIntervalSeconds
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await self?.tickIdleTimeout()
            }
        }
    }

    private func tickIdleTimeout() {
        guard isStreaming, let lastPull = lastPullAt else { return }
        if Date().timeIntervalSince(lastPull) >= Self.idleTimeoutSeconds {
            FileHandle.standardError.write(Data(
                "[Appwatch] idle timeout (\(Int(Self.idleTimeoutSeconds))s without pull) — auto-stop\n".utf8
            ))
            stop()
        }
    }

    // MARK: SCStream output bridge

    /// `SCStreamOutput`-conforming shim. The actor itself can't conform —
    /// `SCStreamOutput` declares methods that aren't `async` (so they can't
    /// be actor-isolated). We hop the delivered sample into the actor via a
    /// detached Task.
    ///
    /// `@unchecked Sendable` because the closure capture is the actor's
    /// `ingestFrame` (which is itself thread-safe by definition). The only
    /// state on this shim is the closure ref.
    private final class StreamOutput: NSObject, SCStreamOutput, @unchecked Sendable {
        private let onFrame: @Sendable (RingFrame) -> Void

        init(onFrame: @escaping @Sendable (RingFrame) -> Void) {
            self.onFrame = onFrame
            super.init()
        }

        func stream(
            _ stream: SCStream,
            didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
            of type: SCStreamOutputType
        ) {
            guard type == .screen, sampleBuffer.isValid else { return }
            guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
            // Per Apple's SCStreamOutput contract: the BGRA bytes live in the
            // SCStream's pool. We copy them into a Data so the actor's ring
            // doesn't hold an SCStream-owned buffer across frame intervals
            // (which would block delivery once the pool is exhausted).
            CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

            let width = CVPixelBufferGetWidth(imageBuffer)
            let height = CVPixelBufferGetHeight(imageBuffer)
            let bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer)
            guard let baseAddress = CVPixelBufferGetBaseAddress(imageBuffer) else { return }

            let byteCount = bytesPerRow * height
            let data = Data(bytes: baseAddress, count: byteCount)
            let frame = RingFrame(
                capturedAt: Date(),
                bgra: data,
                width: width,
                height: height,
                bytesPerRow: bytesPerRow
            )
            onFrame(frame)
        }
    }
}

// MARK: - PNG encoding for the wire surface

/// Helper for the JSON-RPC handlers: take the latest BGRA frame and produce
/// PNG bytes the renderer can show. Kept here (rather than on `RingFrame`
/// itself) so the actor stays pure data + ring management — the bridge to
/// AppKit/Vision lives outside the isolation boundary.
enum AppwatchFrameEncoder {
    static func encodePNG(frame: RingFrame) throws -> Data {
        let rep = try bitmapRep(frame: frame)
        guard let png = rep.representation(using: .png, properties: [:]) else {
            throw AppwatchError.pngEncodingFailed
        }
        return png
    }

    static func encodeJPEG(frame: RingFrame, compressionFactor: Double = 0.82) throws -> Data {
        let rep = try bitmapRep(frame: frame)
        guard let jpeg = rep.representation(
            using: .jpeg,
            properties: [.compressionFactor: compressionFactor]
        ) else {
            throw AppwatchError.pngEncodingFailed
        }
        return jpeg
    }

    private static func bitmapRep(frame: RingFrame) throws -> NSBitmapImageRep {
        // Build a CGImage from the BGRA bytes; NSBitmapImageRep then emits
        // PNG/JPEG using the same code path AttachedWindowCapture uses for the
        // single-shot Appshots flow, so the renderer's image decoder doesn't
        // need a separate fast-path.
        let bitsPerComponent = 8
        let bitsPerPixel = 32
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        // BGRA8888 byte order on a little-endian host: byteOrder32Little +
        // premultipliedFirst = (B, G, R, A) in memory. Matches the
        // kCVPixelFormatType_32BGRA SCStream output.
        let bitmapInfo = CGBitmapInfo(rawValue:
            CGImageAlphaInfo.premultipliedFirst.rawValue
            | CGBitmapInfo.byteOrder32Little.rawValue
        )

        // CGDataProvider needs a CFData; Data → NSData → CFData is the
        // standard bridge. Holding a strong ref through the provider keeps
        // the bytes alive until the CGImage is consumed.
        let nsData = frame.bgra as NSData
        guard let dataProvider = CGDataProvider(data: nsData as CFData) else {
            throw AppwatchError.pngEncodingFailed
        }
        guard let cgImage = CGImage(
            width: frame.width,
            height: frame.height,
            bitsPerComponent: bitsPerComponent,
            bitsPerPixel: bitsPerPixel,
            bytesPerRow: frame.bytesPerRow,
            space: colorSpace,
            bitmapInfo: bitmapInfo,
            provider: dataProvider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        ) else {
            throw AppwatchError.pngEncodingFailed
        }
        return NSBitmapImageRep(cgImage: cgImage)
    }
}
