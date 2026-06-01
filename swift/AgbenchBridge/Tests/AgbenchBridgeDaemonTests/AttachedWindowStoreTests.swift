import XCTest
import CoreGraphics
@testable import AgbenchBridgeDaemon

/// Metadata-shape tests for the attached-window store. The store's full
/// attach/detach/current behavior is exercised end-to-end during manual
/// verification because `AttachedWindowEntry` carries a real `SCContentFilter`
/// produced by `SCContentSharingPicker` — that filter cannot be synthesised
/// in a unit test without live screen-recording permission and a real
/// macOS window. We pin the small pure-logic surfaces here; the actor
/// itself is thin enough that Swift's value-semantics guarantees do the
/// rest.
final class AttachedWindowStoreTests: XCTestCase {
    func testMetaToJSONObjectShape() {
        let meta = AttachedWindowMeta(
            windowID: 99,
            title: "Hello",
            bundleID: "com.example.app",
            applicationName: "Example",
            pid: 1234
        )
        let json = meta.toJSONObject()
        XCTAssertEqual(json["windowID"] as? Int, 99)
        XCTAssertEqual(json["title"] as? String, "Hello")
        XCTAssertEqual(json["bundleID"] as? String, "com.example.app")
        XCTAssertEqual(json["applicationName"] as? String, "Example")
        XCTAssertEqual(json["pid"] as? Int, 1234)
    }

    func testEmptyMetaJSONShapeStillContainsAllKeys() {
        // Window picked from an app that doesn't expose title / bundle id
        // (rare but legal — e.g. background helper processes). We still
        // emit all keys so the renderer pill renders consistently.
        let meta = AttachedWindowMeta(
            windowID: 1,
            title: "",
            bundleID: "",
            applicationName: "",
            pid: 0
        )
        let json = meta.toJSONObject()
        XCTAssertEqual(json["windowID"] as? Int, 1)
        XCTAssertEqual(json["title"] as? String, "")
        XCTAssertEqual(json["bundleID"] as? String, "")
        XCTAssertEqual(json["applicationName"] as? String, "")
        XCTAssertEqual(json["pid"] as? Int, 0)
    }

    func testAttachedWindowErrorDescriptionsAreUserReadable() {
        // Surfaced through JSON-RPC `error.message` and ultimately the
        // renderer toast, so these strings need to read as English.
        XCTAssertEqual(AttachedWindowError.cancelled.errorDescription, "Window pick was cancelled.")
        XCTAssertEqual(AttachedWindowError.noWindowSelected.errorDescription, "Pick must select a single window.")
        XCTAssertEqual(AttachedWindowError.windowGone.errorDescription, "Attached window is no longer available (likely closed).")
        XCTAssertEqual(AttachedWindowError.pngEncodingFailed.errorDescription, "Failed to encode captured frame as PNG.")
        XCTAssertEqual(
            AttachedWindowError.pickerFailed("nope").errorDescription,
            "Window picker failed: nope"
        )
    }
}
