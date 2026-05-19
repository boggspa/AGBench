import XCTest
import SwiftUI
import AGBenchRunActivityShared
@testable import GuiGeminiCompanionCore

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

@available(iOS 17.0, macOS 14.0, *)
final class ProviderPaletteTests: XCTestCase {

    // MARK: - Distinct provider colors

    func testProviderPaletteReturnsDistinctColorsForEachProvider() {
        // Resolve each provider's color in dark mode (where the chips
        // mostly render) and assert the four colors are all different.
        // Two colors are "different" if any sRGB channel disagrees by
        // more than a perceptual epsilon (0.01 — well within JND).
        let providers = ProviderPalette.Provider.allCases
        let components = providers.map { resolveDarkComponents(ProviderPalette.color(for: $0)) }
        XCTAssertEqual(components.count, 4, "Expected exactly 4 known providers")

        for i in 0..<components.count {
            for j in (i + 1)..<components.count {
                XCTAssertFalse(
                    componentsAreClose(components[i], components[j]),
                    "Providers \(providers[i]) and \(providers[j]) resolve to nearly-identical colors \(components[i]) vs \(components[j]); each provider must own a distinct hue."
                )
            }
        }
    }

    // MARK: - Light/dark adaptation

    func testProviderPaletteAdaptsToLightAndDarkTraits() {
        // Spot-check Gemini and Codex. Both have different light vs dark
        // hex values in `ProviderPaletteRGB` so the resolved components
        // must differ across traits. If this assertion fails, the
        // adaptive plumbing isn't reaching the trait collection.
        for provider in [ProviderPalette.Provider.gemini, .codex] {
            let lightComponents = resolveLightComponents(ProviderPalette.color(for: provider))
            let darkComponents = resolveDarkComponents(ProviderPalette.color(for: provider))
            XCTAssertFalse(
                componentsAreClose(lightComponents, darkComponents),
                "Provider \(provider) light \(lightComponents) and dark \(darkComponents) resolved identically — the adaptive UIColor/NSColor closure must be returning different values per trait collection."
            )
        }
    }

    // MARK: - Raw string fallbacks

    func testProviderNamedHandlesCaseAndUnknown() {
        XCTAssertEqual(ProviderPalette.provider(named: "Gemini"), .gemini)
        XCTAssertEqual(ProviderPalette.provider(named: "CLAUDE"), .claude)
        XCTAssertEqual(ProviderPalette.provider(named: "codex"), .codex)
        XCTAssertEqual(ProviderPalette.provider(named: "kimi"), .kimi)
        XCTAssertNil(ProviderPalette.provider(named: "anthropic"))
        XCTAssertNil(ProviderPalette.provider(named: ""))
        XCTAssertNil(ProviderPalette.provider(named: nil))
    }

    func testDisplayLabelFallsBackToCapitalisedRaw() {
        XCTAssertEqual(ProviderPalette.displayLabel(forRaw: "gemini"), "Gemini")
        XCTAssertEqual(ProviderPalette.displayLabel(forRaw: "openai"), "Openai")
        XCTAssertEqual(ProviderPalette.displayLabel(forRaw: "  "), "Agent")
        XCTAssertEqual(ProviderPalette.displayLabel(forRaw: nil), "Agent")
    }

    // MARK: - Shared RGB table is the single source

    func testProviderPaletteRGBExposesAllFourProviders() {
        // Defensive: if someone adds a fifth provider to the enum but
        // forgets the matching `ProviderPaletteRGB.pair(for:)` arm, this
        // test (and any future Live Activity render that depends on the
        // shared module) will start returning `nil` for that provider.
        for provider in ProviderPalette.Provider.allCases {
            XCTAssertNotNil(
                ProviderPaletteRGB.pair(for: provider.rawValue),
                "Missing `ProviderPaletteRGB.pair(for: \"\(provider.rawValue)\")` — the Live Activity widget will fall back to the default accent for this provider."
            )
        }
    }

    func testProviderPaletteRGBHexesMatchDesktopVariables() {
        // Snapshot-style assertion. Pins the exact desktop hex values
        // ProviderPalette inherits from `theme.css`. If the desktop
        // changes a `--provider-*-color` variable, this test fails
        // loudly so we re-derive the iOS palette in lockstep.
        XCTAssertEqual(ProviderPaletteRGB.gemini.lightHex, "#2563EB")
        XCTAssertEqual(ProviderPaletteRGB.gemini.darkHex, "#8EB1FF")
        XCTAssertEqual(ProviderPaletteRGB.codex.lightHex, "#6366F1")
        XCTAssertEqual(ProviderPaletteRGB.codex.darkHex, "#AAA0FF")
        XCTAssertEqual(ProviderPaletteRGB.claude.lightHex, "#D97706")
        XCTAssertEqual(ProviderPaletteRGB.claude.darkHex, "#FFAD64")
        XCTAssertEqual(ProviderPaletteRGB.kimi.lightHex, "#84A33B")
        XCTAssertEqual(ProviderPaletteRGB.kimi.darkHex, "#BBCF66")
    }

    func testProviderPaletteRGBComponentsMatchHexes() {
        for provider in ProviderPalette.Provider.allCases {
            guard let pair = ProviderPaletteRGB.pair(for: provider.rawValue) else {
                XCTFail("Missing RGB pair for \(provider.rawValue)")
                continue
            }
            assertComponents(pair.light, match: pair.lightHex, provider: provider.rawValue, variant: "light")
            assertComponents(pair.dark, match: pair.darkHex, provider: provider.rawValue, variant: "dark")
        }
    }

    // MARK: - Helpers

    private struct ResolvedComponents: Equatable, CustomStringConvertible {
        let red: CGFloat
        let green: CGFloat
        let blue: CGFloat
        let alpha: CGFloat

        var description: String {
            String(format: "(r=%.3f g=%.3f b=%.3f a=%.3f)", red, green, blue, alpha)
        }
    }

    private func assertComponents(
        _ components: ProviderPaletteRGB.Components,
        match hex: String,
        provider: String,
        variant: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let expected = rgbComponents(from: hex) else {
            XCTFail("Bad hex fixture \(hex)", file: file, line: line)
            return
        }
        XCTAssertEqual(components.alpha, 1.0, accuracy: 0.001, file: file, line: line)
        XCTAssertEqual(components.red, expected.red, accuracy: 0.001, "\(provider) \(variant) red", file: file, line: line)
        XCTAssertEqual(components.green, expected.green, accuracy: 0.001, "\(provider) \(variant) green", file: file, line: line)
        XCTAssertEqual(components.blue, expected.blue, accuracy: 0.001, "\(provider) \(variant) blue", file: file, line: line)
    }

    private func rgbComponents(from hex: String) -> (red: Double, green: Double, blue: Double)? {
        var trimmed = hex
        if trimmed.hasPrefix("#") {
            trimmed.removeFirst()
        }
        guard trimmed.count == 6,
              let value = UInt32(trimmed, radix: 16) else {
            return nil
        }
        return (
            red: Double((value >> 16) & 0xFF) / 255.0,
            green: Double((value >> 8) & 0xFF) / 255.0,
            blue: Double(value & 0xFF) / 255.0
        )
    }

    private func componentsAreClose(
        _ lhs: ResolvedComponents,
        _ rhs: ResolvedComponents,
        epsilon: CGFloat = 0.01
    ) -> Bool {
        abs(lhs.red - rhs.red) < epsilon
            && abs(lhs.green - rhs.green) < epsilon
            && abs(lhs.blue - rhs.blue) < epsilon
            && abs(lhs.alpha - rhs.alpha) < epsilon
    }

    private func resolveLightComponents(_ color: Color) -> ResolvedComponents {
        resolveComponents(color, scheme: .light)
    }

    private func resolveDarkComponents(_ color: Color) -> ResolvedComponents {
        resolveComponents(color, scheme: .dark)
    }

    private func resolveComponents(_ color: Color, scheme: ColorScheme) -> ResolvedComponents {
        var environment = EnvironmentValues()
        environment.colorScheme = scheme
        let resolved = color.resolve(in: environment)
        return ResolvedComponents(
            red: CGFloat(resolved.red),
            green: CGFloat(resolved.green),
            blue: CGFloat(resolved.blue),
            alpha: CGFloat(resolved.opacity)
        )
    }
}
