import SwiftUI
import AGBenchRunActivityShared

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Shared per-provider color tokens.
///
/// Mirrors the desktop's `--provider-*-color` CSS variables defined in
/// `src/renderer/src/styles/theme.css` (lines 47-50) so the iOS shell and
/// the Live Activity widget render the same provider chips / accents as
/// the Mac renderer.
///
/// Why this lives in its own file:
///   - Before this token system, provider tints were re-defined locally
///     in `SidebarActiveRunsSection.providerTint(for:)` and in the Live
///     Activity widget's `providerAccent(_:)` helper, so the two surfaces
///     drifted independently. `ProviderPalette` is the single source.
///   - The Live Activity extension target imports
///     `AGBenchRunActivityShared` (not `GuiGeminiCompanionCore`), so the
///     palette tokens themselves are defined here for the main app and
///     duplicated as raw `Color(red:green:blue:)` values inside the
///     extension; both sides reference the same hex constants documented
///     in this file. Keep the constants in sync if either side changes.
///
/// Light/dark behaviour: each provider has a slightly brighter dark-mode
/// variant so the chip stays legible on the near-black `--app-bg`
/// (#141414). Light-mode tints stay close to the desktop's solid hex so
/// the same hue reads on a white surface.
@available(iOS 17.0, macOS 14.0, *)
public enum ProviderPalette {
    /// Canonical identifier for each provider AGBench can route runs to.
    /// String raw values match the lowercased provider strings the
    /// desktop emits on `BridgeRunEvent.provider`, on iPad summary
    /// payloads (`iPadThreadSummary.provider`), and on the Live Activity
    /// attributes (`AGBenchRunActivityAttributes.provider`).
    public enum Provider: String, CaseIterable, Sendable, Hashable {
        case gemini
        case codex
        case claude
        case kimi
        case grok
        case cursor

        /// Capitalized display label used in chips, badges, and a11y
        /// strings. Mirrors the Mac sidebar's `ActiveRunsSection`
        /// labelling.
        public var displayLabel: String {
            switch self {
            case .gemini: return "Gemini"
            case .codex: return "Codex"
            case .claude: return "Claude"
            case .kimi: return "Kimi"
            case .grok: return "Grok"
            case .cursor: return "Cursor"
            }
        }

        /// First-letter glyph used by the Live Activity badge.
        public var initial: String {
            String(rawValue.prefix(1)).uppercased()
        }
    }

    /// Adaptive SwiftUI `Color` for the given provider. Light + dark
    /// variants chosen so:
    ///   - Light mode matches the desktop's solid `--provider-<name>-color`
    ///     CSS variable when read on a `#ffffff`/`#f4f6f8` surface.
    ///   - Dark mode brightens slightly so the chip stays legible on a
    ///     near-black `--app-bg` (#141414) without losing the hue.
    ///
    /// Raw RGB constants live in `AGBenchRunActivityShared.ProviderPaletteRGB`
    /// so the Live Activity widget extension (which only links the shared
    /// module) renders the same hues.
    public static func color(for provider: Provider) -> Color {
        let pair: ProviderPaletteRGB.Pair = {
            switch provider {
            case .gemini: return ProviderPaletteRGB.gemini
            case .codex:  return ProviderPaletteRGB.codex
            case .claude: return ProviderPaletteRGB.claude
            case .kimi:   return ProviderPaletteRGB.kimi
            case .grok:   return ProviderPaletteRGB.grok
            case .cursor: return ProviderPaletteRGB.cursor
            }
        }()
        return AdaptiveProviderColor.color(light: .from(pair.light), dark: .from(pair.dark))
    }

    /// Soft variant (~14% alpha) used as the background fill of a
    /// provider chip. Matches the `tint.opacity(0.14)` rule the existing
    /// sidebar row uses so the chip surface stays consistent.
    public static func softBackground(for provider: Provider) -> Color {
        color(for: provider).opacity(0.14)
    }

    /// Convenience overload that accepts the raw provider string used on
    /// the wire (`BridgeRunEvent.provider`, `iPadThreadSummary.provider`,
    /// `AGBenchRunActivityAttributes.provider`). Returns nil when the
    /// string doesn't map to a known provider — callers can fall back to
    /// `Theme.accent` for the default "Agent" tint.
    public static func provider(named raw: String?) -> Provider? {
        guard let raw = raw?.lowercased(), !raw.isEmpty else { return nil }
        return Provider(rawValue: raw)
    }

    /// Resolved color for an arbitrary provider string, falling back to
    /// the shell's primary accent when the string isn't recognised. Use
    /// this from view code that already has a `String?` (e.g.
    /// `BridgeRunEvent.provider`) so callers don't repeat the
    /// `provider(named:)` ?? fallback dance.
    public static func color(forRaw raw: String?, fallback: Color = Theme.accent) -> Color {
        guard let provider = provider(named: raw) else { return fallback }
        return color(for: provider)
    }

    /// Display label for an arbitrary provider string. Used by the
    /// sidebar and the Live Activity badge so both surfaces capitalise
    /// the provider name identically.
    public static func displayLabel(forRaw raw: String?) -> String {
        if let provider = provider(named: raw) {
            return provider.displayLabel
        }
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Agent" : trimmed.capitalized
    }
}

// MARK: - Internal adaptive color plumbing
//
// `Theme.swift` has the same helper but private to that file; duplicating
// here keeps `ProviderPalette` self-contained (no cross-file private
// dependency) and avoids accidentally widening `Theme`'s SPI.

private struct ProviderRGBA {
    let red: Double
    let green: Double
    let blue: Double
    let alpha: Double

    static func sRGB(_ red: Double, _ green: Double, _ blue: Double, _ alpha: Double) -> ProviderRGBA {
        ProviderRGBA(red: red, green: green, blue: blue, alpha: alpha)
    }

    /// Bridges from the raw component tuple held in
    /// `AGBenchRunActivityShared.ProviderPaletteRGB`.
    static func from(_ components: ProviderPaletteRGB.Components) -> ProviderRGBA {
        ProviderRGBA(red: components.red, green: components.green, blue: components.blue, alpha: components.alpha)
    }
}

private enum AdaptiveProviderColor {
    static func color(light: ProviderRGBA, dark: ProviderRGBA) -> Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark.uiColor : light.uiColor
        })
        #elseif canImport(AppKit)
        Color(nsColor: NSColor(name: nil) { appearance in
            let bestMatch = appearance.bestMatch(from: [.darkAqua, .aqua])
            return bestMatch == .darkAqua ? dark.nsColor : light.nsColor
        })
        #else
        Color(.sRGB, red: dark.red, green: dark.green, blue: dark.blue, opacity: dark.alpha)
        #endif
    }
}

#if canImport(UIKit)
private extension ProviderRGBA {
    var uiColor: UIColor {
        UIColor(red: red, green: green, blue: blue, alpha: alpha)
    }
}
#elseif canImport(AppKit)
private extension ProviderRGBA {
    var nsColor: NSColor {
        NSColor(srgbRed: red, green: green, blue: blue, alpha: alpha)
    }
}
#endif
