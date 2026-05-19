import Foundation

/// Raw RGB constants for the per-provider color palette, shared between
/// the main app's `ProviderPalette` (in `GuiGeminiCompanionCore`) and the
/// Live Activity widget extension target.
///
/// Why these live in `AGBenchRunActivityShared`:
///   - The widget extension only links `AGBenchRunActivityShared` (not
///     `GuiGeminiCompanionCore`) so it can stay small. Sharing the raw
///     numbers here keeps both surfaces visually in sync without pulling
///     SwiftUI / theme machinery into the extension.
///   - Constants are plain `Double` triplets; the consumer wraps them in
///     `SwiftUI.Color` or `UIColor` as needed.
///
/// Source of truth: desktop's `src/renderer/src/styles/theme.css`
/// (`--provider-*-color` and the `provider-*` sidebar overrides in
/// `src/renderer/src/assets/main.css` L444-447). Each pair below carries
/// the desktop hex it derives from in the comment.
public enum ProviderPaletteRGB: Sendable {
    /// `(red, green, blue, alpha)` tuple of sRGB components in 0...1.
    public typealias Components = (red: Double, green: Double, blue: Double, alpha: Double)

    public struct Pair: Sendable, Hashable {
        public let lightHex: String
        public let darkHex: String
        public let light: Components
        public let dark: Components

        public init(lightHex: String, darkHex: String, light: Components, dark: Components) {
            self.lightHex = lightHex
            self.darkHex = darkHex
            self.light = light
            self.dark = dark
        }

        // Components is a tuple so we have to spell out the Hashable
        // requirement; otherwise Swift refuses to synthesise it.
        public static func == (lhs: Pair, rhs: Pair) -> Bool {
            lhs.lightHex == rhs.lightHex && lhs.darkHex == rhs.darkHex
        }

        public func hash(into hasher: inout Hasher) {
            hasher.combine(lightHex)
            hasher.combine(darkHex)
        }
    }

    /// Gemini — desktop `#2563EB` light, `#8EB1FF` dark.
    public static let gemini = Pair(
        lightHex: "#2563EB",
        darkHex: "#8EB1FF",
        light: (0.145, 0.388, 0.922, 1.0),
        dark:  (0.557, 0.694, 1.000, 1.0)
    )
    /// Codex — desktop `#6366F1` light, `#AAA0FF` dark.
    public static let codex = Pair(
        lightHex: "#6366F1",
        darkHex: "#AAA0FF",
        light: (0.388, 0.400, 0.945, 1.0),
        dark:  (0.667, 0.627, 1.000, 1.0)
    )
    /// Claude — desktop `#D97706` light, `#FFAD64` dark.
    public static let claude = Pair(
        lightHex: "#D97706",
        darkHex: "#FFAD64",
        light: (0.851, 0.467, 0.024, 1.0),
        dark:  (1.000, 0.678, 0.392, 1.0)
    )
    /// Kimi — desktop `#84A33B` light, `#BBCF66` dark.
    public static let kimi = Pair(
        lightHex: "#84A33B",
        darkHex: "#BBCF66",
        light: (0.518, 0.639, 0.231, 1.0),
        dark:  (0.733, 0.812, 0.400, 1.0)
    )

    /// Lookup by lowercased provider name as it appears on the wire
    /// (`BridgeRunEvent.provider`, `AGBenchRunActivityAttributes.provider`).
    /// Returns nil for unknown providers; callers fall back to a default
    /// accent.
    public static func pair(for raw: String) -> Pair? {
        switch raw.lowercased() {
        case "gemini": return gemini
        case "codex": return codex
        case "claude": return claude
        case "kimi": return kimi
        default: return nil
        }
    }
}
