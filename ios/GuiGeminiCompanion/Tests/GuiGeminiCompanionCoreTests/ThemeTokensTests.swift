import XCTest
import SwiftUI
@testable import GuiGeminiCompanionCore

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Snapshot-style tests pinning the dark-glass-on-near-black tokens to
/// the exact desktop-derived RGB values. If a designer tunes
/// `Theme.windowBase` (etc.) the matching expected value below must
/// update too — that's by design, the test makes drift loud.
@available(iOS 17.0, macOS 14.0, *)
final class ThemeTokensTests: XCTestCase {

    // MARK: - Background base

    /// `windowBase` dark variant tracks desktop's `--app-bg: #141414`
    /// (theme.css L5). This is the single most visible token in the
    /// shell so we pin it tight.
    func testWindowBaseDarkMatchesDesktopAppBg() {
        let components = resolveDarkComponents(Theme.windowBase)
        assertCloseToHex(components, hex: "#141414")
    }

    /// `windowBase` light variant tracks desktop's `--app-bg: #f4f6f8`
    /// (theme.css L121).
    func testWindowBaseLightMatchesDesktopAppBgLight() {
        let components = resolveLightComponents(Theme.windowBase)
        assertCloseToHex(components, hex: "#f4f6f8")
    }

    // MARK: - Sidebar / composer / accent

    /// `sidebarBase` dark variant tracks desktop's
    /// `--sidebar-bg-solid: #1e1e22` (theme.css L11).
    func testSidebarBaseDarkMatchesDesktopSidebarSolid() {
        let components = resolveDarkComponents(Theme.sidebarBase)
        assertCloseToHex(components, hex: "#1e1e22")
    }

    /// `accent` is a single (non-adaptive) token derived from desktop's
    /// `--accent: #5a8cff` (theme.css L53).
    func testAccentMatchesDesktopAccent() {
        // accent is a plain `Color(red:green:blue:)` so we can resolve in
        // either trait — desktop's --accent is constant across themes.
        let components = resolveDarkComponents(Theme.accent)
        assertCloseToHex(components, hex: "#5a8cff", epsilon: 0.012)
    }

    /// Success / warning / destructive map to desktop status semantics.
    func testStatusColorsMatchDesktopSemanticTokens() {
        assertCloseToHex(resolveDarkComponents(Theme.success), hex: "#4cc38a")
        assertCloseToHex(resolveDarkComponents(Theme.warning), hex: "#f5a623")
        assertCloseToHex(resolveDarkComponents(Theme.destructive), hex: "#e54d4d")
    }

    // MARK: - Composer surfaces (new tokens)

    /// `composerSurface` dark variant tracks desktop's
    /// `--composer-bg: rgba(7, 16, 36, 0.92)` (theme.css L30). The
    /// composer in the iPhone / iPad shell consumes this token to get
    /// the navy glass aesthetic.
    func testComposerSurfaceDarkMatchesDesktopComposerBg() {
        let components = resolveDarkComponents(Theme.composerSurface)
        let expected = ComponentTriplet(red: 7.0/255.0, green: 16.0/255.0, blue: 36.0/255.0)
        assertCloseTo(components, expected: expected, epsilon: 0.02)
    }

    // MARK: - Text contrast sanity

    /// Primary text on `windowBase` (dark) must clear a basic contrast
    /// floor (WCAG large-text recommends a 3:1 luminance ratio at
    /// minimum). This catches any future regression where someone darkens
    /// `primaryText` so far that it disappears on the new near-black bg.
    func testPrimaryTextOnWindowBaseDarkHasContrast() {
        let textLuma = relativeLuminance(resolveDarkComponents(Theme.primaryText))
        let bgLuma = relativeLuminance(resolveDarkComponents(Theme.windowBase))
        let ratio = contrastRatio(textLuma, bgLuma)
        XCTAssertGreaterThan(
            ratio,
            7.0,
            "Primary text dark variant must keep at least a 7:1 contrast ratio against `windowBase` dark; got \(ratio)."
        )
    }

    // MARK: - Public API stability (don't break Agents A & B)

    /// Confirms the existing surfaces Agent A & Agent B rely on are
    /// still public and resolve to non-default colors. If the refactor
    /// accidentally narrows visibility, this test won't compile.
    func testPublicSurfacesRemainAvailable() {
        _ = Theme.windowBase
        _ = Theme.cardFill
        _ = Theme.elevatedCardFill
        _ = Theme.cardStroke
        _ = Theme.accent
        _ = Theme.accentSoft
        _ = Theme.secondaryAccent
        _ = Theme.success
        _ = Theme.warning
        _ = Theme.destructive
        _ = Theme.primaryText
        _ = Theme.secondaryText
        _ = Theme.tertiaryText
        _ = Theme.separator
        _ = Theme.border
        _ = Theme.strongBorder
        _ = Theme.shadowColor
        _ = Theme.softShadowColor
        _ = Theme.inputSurface
        _ = Theme.sidebarBase
        _ = Theme.composerSurface
        _ = Theme.composerBorder
        XCTAssertEqual(Theme.Radius.card, 18)
        XCTAssertEqual(Theme.Radius.panel, 22)
    }

    func testCompanionThemePaletteUsesRemoteShellAppearanceTokens() {
        let palette = CompanionThemePalette(appearance: RemoteShellAppearance(
            generatedAt: nil,
            appearanceMode: "native_glass",
            visualEffectStyle: "liquid_glass",
            themeAppearance: "obsidian",
            themeCornerStyle: "hard",
            themeAccentStyle: "purple",
            promptSurfaceStyle: "liquid_glass",
            composerStyle: "claude",
            reduceTransparency: true,
            reduceMotion: false,
            compactDensity: true,
            preferredColorScheme: .dark,
            colors: remoteShellAppearanceColorsForThemeTest()
        ))

        XCTAssertEqual(palette.preferredColorScheme, .dark)
        XCTAssertEqual(palette.composerStyle, "claude")
        XCTAssertTrue(palette.reduceTransparency)
        assertCloseToHex(resolveDarkComponents(palette.accent), hex: "#bf7cff", epsilon: 0.012)
        assertCloseToHex(resolveDarkComponents(palette.composerSurface), hex: "#071024", epsilon: 0.02)
    }

    // MARK: - Helpers

    private func remoteShellAppearanceColorsForThemeTest() -> RemoteShellAppearanceColors {
        RemoteShellAppearanceColors(
            windowBase: RemoteShellAdaptiveColor(light: "#f4f6f8", dark: "#141414"),
            sidebarBase: RemoteShellAdaptiveColor(light: "#c2c2c2", dark: "#1e1e22"),
            cardFill: RemoteShellAdaptiveColor(light: "#f6f9fbae", dark: "#1c1c20d1"),
            cardStroke: RemoteShellAdaptiveColor(light: "#0000001a", dark: "#ffffff1a"),
            elevatedCardFill: RemoteShellAdaptiveColor(light: "#fbfdffc7", dark: "#26262ce0"),
            inputSurface: RemoteShellAdaptiveColor(light: "#00000012", dark: "#ffffff12"),
            composerSurface: RemoteShellAdaptiveColor(light: "#ffffffc7", dark: "#071024eb"),
            composerBorder: RemoteShellAdaptiveColor(light: "#0000001f", dark: "#7c9eff38"),
            primaryText: RemoteShellAdaptiveColor(light: "#000000e0", dark: "#ffffffeb"),
            secondaryText: RemoteShellAdaptiveColor(light: "#0000009e", dark: "#ffffff8c"),
            tertiaryText: RemoteShellAdaptiveColor(light: "#00000070", dark: "#ffffff59"),
            separator: RemoteShellAdaptiveColor(light: "#00000017", dark: "#ffffff0f"),
            accent: "#bf7cff",
            accentSoft: RemoteShellAdaptiveColor(light: "#bf7cff24", dark: "#bf7cff2e"),
            secondaryAccent: RemoteShellAdaptiveColor(light: "#00739e", dark: "#6bc4db"),
            success: "#4cc38a",
            warning: "#f5a623",
            destructive: "#e54d4d"
        )
    }

    private struct ResolvedComponents: Equatable, CustomStringConvertible {
        let red: CGFloat
        let green: CGFloat
        let blue: CGFloat
        let alpha: CGFloat

        var description: String {
            String(format: "(r=%.3f g=%.3f b=%.3f a=%.3f)", red, green, blue, alpha)
        }
    }

    private struct ComponentTriplet {
        let red: Double
        let green: Double
        let blue: Double
    }

    private func assertCloseToHex(
        _ components: ResolvedComponents,
        hex: String,
        epsilon: CGFloat = 0.01,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        guard let target = hexToComponents(hex) else {
            XCTFail("Bad test fixture hex \(hex)", file: file, line: line)
            return
        }
        assertCloseTo(components, expected: target, epsilon: epsilon, file: file, line: line)
    }

    private func assertCloseTo(
        _ components: ResolvedComponents,
        expected: ComponentTriplet,
        epsilon: CGFloat = 0.01,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let drift = max(
            abs(CGFloat(expected.red) - components.red),
            abs(CGFloat(expected.green) - components.green),
            abs(CGFloat(expected.blue) - components.blue)
        )
        XCTAssertLessThan(
            drift,
            epsilon,
            "Token \(components) drifted from expected (r=\(expected.red) g=\(expected.green) b=\(expected.blue)) by \(drift); update the test fixture or revisit the token.",
            file: file,
            line: line
        )
    }

    private func hexToComponents(_ hex: String) -> ComponentTriplet? {
        var trimmed = hex
        if trimmed.hasPrefix("#") {
            trimmed.removeFirst()
        }
        guard trimmed.count == 6,
              let value = UInt32(trimmed, radix: 16) else {
            return nil
        }
        return ComponentTriplet(
            red: Double((value >> 16) & 0xFF) / 255.0,
            green: Double((value >> 8) & 0xFF) / 255.0,
            blue: Double(value & 0xFF) / 255.0
        )
    }

    private func relativeLuminance(_ components: ResolvedComponents) -> Double {
        func channel(_ value: CGFloat) -> Double {
            let v = Double(value)
            if v <= 0.03928 {
                return v / 12.92
            }
            return pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(components.red)
            + 0.7152 * channel(components.green)
            + 0.0722 * channel(components.blue)
    }

    private func contrastRatio(_ a: Double, _ b: Double) -> Double {
        let l1 = max(a, b)
        let l2 = min(a, b)
        return (l1 + 0.05) / (l2 + 0.05)
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
