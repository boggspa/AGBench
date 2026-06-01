import XCTest
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
@testable import AgbenchBridgeDaemon

/// OCR plumbing tests. We don't exercise Vision's text-recognition accuracy
/// here — that's Apple's responsibility and unit tests with synthetic glyphs
/// would be brittle. We do pin down the wire shape: an empty / textless PNG
/// returns an empty `OcrResult`, and the JSON envelope matches what the main
/// process expects when forwarding via `attached_window_capture`.
final class AttachedWindowOCRTests: XCTestCase {
    func testEmptyPNGProducesEmptyResultWithoutThrowing() async throws {
        let png = makeBlankPNG(width: 32, height: 32, gray: 1.0)
        let result = try await AttachedWindowOCR.recognize(pngData: png)
        XCTAssertEqual(result.text, "")
        XCTAssertTrue(result.blocks.isEmpty)
    }

    func testJSONShapeContainsTextAndBlocksKeys() async throws {
        let png = makeBlankPNG(width: 16, height: 16, gray: 0.0)
        let result = try await AttachedWindowOCR.recognize(pngData: png)
        let json = result.toJSONObject()
        XCTAssertNotNil(json["text"] as? String)
        XCTAssertNotNil(json["blocks"] as? [[String: Any]])
    }

    func testCorruptInputResolvesToEmptyResultRatherThanThrowing() async throws {
        // makeCGImage returns nil for garbage data, and the recognizer
        // short-circuits to an empty result — the OCR layer never throws
        // on bad pixels, so callers can safely treat "no text" the same
        // as "could not decode".
        let garbage = Data([0x00, 0x01, 0x02, 0x03])
        let result = try await AttachedWindowOCR.recognize(pngData: garbage)
        XCTAssertEqual(result.text, "")
        XCTAssertTrue(result.blocks.isEmpty)
    }

    // MARK: - Helpers

    private func makeBlankPNG(width: Int, height: Int, gray: CGFloat) -> Data {
        let colorSpace = CGColorSpaceCreateDeviceGray()
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else {
            return Data()
        }
        context.setFillColor(gray: gray, alpha: 1.0)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        guard let cgImage = context.makeImage() else { return Data() }

        let mutableData = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            mutableData,
            UTType.png.identifier as CFString,
            1,
            nil
        ) else {
            return Data()
        }
        CGImageDestinationAddImage(destination, cgImage, nil)
        CGImageDestinationFinalize(destination)
        return mutableData as Data
    }
}
