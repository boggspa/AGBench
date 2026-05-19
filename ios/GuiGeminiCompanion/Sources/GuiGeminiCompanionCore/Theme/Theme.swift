import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Shared visual tokens for the companion app.
///
/// The app target imports this package, so tokens used by app-level views must
/// remain public while the iPad shell can use the same package-safe palette.
@available(iOS 17.0, macOS 14.0, *)
public enum Theme {
    /// App background base. Dark variant matches the desktop's
    /// `--app-bg: #141414` (theme.css L5) so the iOS shell shares the
    /// same near-black canvas as the Mac renderer. Light variant kept
    /// at the previous off-white (matches desktop `--app-bg: #f4f6f8`,
    /// theme.css L121, slightly warmed for legibility on the small
    /// screen).
    public static let windowBase: Color = AdaptiveColor.color(
        light: .sRGB(0.957, 0.965, 0.973, 1.00), // ~#f4f6f8 — desktop --app-bg light
        dark: .sRGB(0.078, 0.078, 0.078, 1.00)   // #141414 — desktop --app-bg dark
    )
    /// Card fill ("Liquid Glass" surface). Dark variant tuned toward the
    /// desktop's `--panel-bg: rgba(28, 28, 32, 0.82)` (theme.css L20) so
    /// cards read as the same "frosted near-black" as the desktop
    /// inspector. Light variant unchanged — desktop's
    /// `rgba(239, 243, 248, 0.68)` already matches this 0.965/0.68 tuple.
    public static let cardFill: Color = AdaptiveColor.color(
        light: .sRGB(0.965, 0.975, 0.985, 0.68),
        dark: .sRGB(0.110, 0.110, 0.125, 0.82)   // desktop --panel-bg dark
    )
    /// Card stroke. Dark variant lifted to match desktop's
    /// `--sidebar-border: rgba(255, 255, 255, 0.06)` (theme.css L12) when
    /// the card sits over the near-black bg, plus a touch more contrast
    /// (0.10 white vs 0.06) so the stroke survives the SwiftUI material
    /// blur.
    public static let cardStroke: Color = AdaptiveColor.color(
        light: .black(0.10),
        dark: .white(0.10)                       // desktop --panel-border / sidebar-border ≈ 6% but readable through .ultraThinMaterial demands ~10%
    )
    /// Elevated card surface — used for the top-most "hero" cards.
    /// Dark variant nudges to the desktop's
    /// `--panel-elevated-bg: rgba(38, 38, 44, 0.88)` (theme.css L23).
    public static let elevatedCardFill: Color = AdaptiveColor.color(
        light: .sRGB(0.985, 0.990, 1.000, 0.78),
        dark: .sRGB(0.149, 0.149, 0.173, 0.88)   // desktop --panel-elevated-bg dark
    )
    /// Primary accent. Matches the desktop's `--accent: #5a8cff`
    /// (theme.css L53) so all the inline tints (badges, focus rings) read
    /// the same on both shells. Previously a slightly darker `#0F6EEB`.
    public static let accent: Color = Color(red: 0.353, green: 0.549, blue: 1.000)
    /// Soft accent backdrop (≈14% alpha) used by sidebar pills and chips.
    /// Mirrors desktop's `--sidebar-pill-bg: rgba(90, 140, 255, 0.15)`
    /// (theme.css L16).
    public static let accentSoft: Color = AdaptiveColor.color(
        light: .sRGB(0.353, 0.549, 1.000, 0.14),
        dark: .sRGB(0.353, 0.549, 1.000, 0.18)
    )
    /// Glow halo for live elements (active runs, focus state). Mirrors
    /// desktop's `--focus-ring`-flavoured glow.
    public static let accentGlow: Color = Color(red: 0.55, green: 0.74, blue: 1.00)
    /// Secondary accent kept as the legacy teal so any prior callers
    /// (status pills, link affordances) don't shift mid-refactor. Light
    /// variant matches the prior token; dark variant slightly brighter
    /// for legibility on `#141414`.
    public static let secondaryAccent: Color = AdaptiveColor.color(
        light: .sRGB(0.000, 0.450, 0.620, 1.00),
        dark: .sRGB(0.420, 0.770, 0.860, 1.00)
    )
    /// Success / warning / destructive — sourced from desktop's
    /// `--success / --warning / --danger` (theme.css L55-57).
    public static let success: Color = Color(red: 0.298, green: 0.765, blue: 0.541)   // #4cc38a — desktop --success
    public static let warning: Color = Color(red: 0.961, green: 0.651, blue: 0.137)   // #f5a623 — desktop --warning
    public static let destructive: Color = Color(red: 0.898, green: 0.302, blue: 0.302) // #e54d4d — desktop --danger
    /// Primary text. Dark variant brightened slightly to match desktop's
    /// `--text-primary: rgba(255, 255, 255, 0.92)` (theme.css L40).
    public static let primaryText: Color = AdaptiveColor.color(
        light: .black(0.88),
        dark: .white(0.92)                       // desktop --text-primary dark
    )
    /// Secondary text. Dark variant matches desktop's
    /// `--text-secondary: rgba(255, 255, 255, 0.55)` (theme.css L41).
    public static let secondaryText: Color = AdaptiveColor.color(
        light: .black(0.62),
        dark: .white(0.55)                       // desktop --text-secondary dark
    )
    /// Tertiary text. Dark variant matches desktop's
    /// `--text-tertiary: rgba(255, 255, 255, 0.35)` (theme.css L42).
    public static let tertiaryText: Color = AdaptiveColor.color(
        light: .black(0.44),
        dark: .white(0.35)                       // desktop --text-tertiary dark
    )
    /// Hairline separator. Dark variant matches desktop's
    /// `--sidebar-border / --panel-border: rgba(255, 255, 255, 0.06)`
    /// (theme.css L12, L22).
    public static let separator: Color = AdaptiveColor.color(
        light: .black(0.09),
        dark: .white(0.06)                       // desktop --sidebar-border dark
    )
    /// Sidebar base. Dark variant a hair lighter than `windowBase` so
    /// the sidebar reads as a subtly-elevated chrome strip — matches
    /// desktop's `--sidebar-bg-solid: #1e1e22` (theme.css L11).
    public static let sidebarBase: Color = AdaptiveColor.color(
        light: .white(0.76),
        dark: .sRGB(0.118, 0.118, 0.133, 1.00)   // #1e1e22 — desktop --sidebar-bg-solid
    )
    /// Composer surface. Dark variant tinted navy to match desktop's
    /// `--composer-bg: rgba(7, 16, 36, 0.92)` (theme.css L30) so the iOS
    /// composer matches the Mac composer's "deep navy glass" look. Light
    /// variant warms slightly toward white.
    public static let composerSurface: Color = AdaptiveColor.color(
        light: .sRGB(1.000, 1.000, 1.000, 0.78),
        dark: .sRGB(0.027, 0.063, 0.141, 0.92)   // desktop --composer-bg dark
    )
    /// Composer hairline border. Dark variant matches desktop's
    /// `--composer-border: rgba(124, 158, 255, 0.16)` (theme.css L32).
    public static let composerBorder: Color = AdaptiveColor.color(
        light: .black(0.12),
        dark: .sRGB(0.486, 0.620, 1.000, 0.22)   // desktop --composer-glass-border dark
    )

    public static var backgroundBase: Color { windowBase }
    public static var surface: Color { cardFill }
    public static var elevatedSurface: Color { elevatedCardFill }

    /// Input surface (text fields, in-card controls). Light/dark kept
    /// neutral so it reads against any of the panel surfaces.
    public static let inputSurface: Color = AdaptiveColor.color(
        light: .black(0.07),
        dark: .white(0.07)
    )
    /// Border. Dark variant aligned with desktop's `--panel-border`
    /// (rgba(255, 255, 255, 0.06)) plus a touch more contrast for chips.
    public static let border: Color = AdaptiveColor.color(
        light: .black(0.09),
        dark: .white(0.10)                       // desktop --panel-border dark ≈ 6%, nudged for chip strokes
    )
    public static let strongBorder: Color = AdaptiveColor.color(
        light: .black(0.14),
        dark: .white(0.20)
    )
    /// Shadow plate under cards. Dark variant deepened to match the
    /// stronger shadow desktop uses against `#141414`
    /// (`--shadow-lg: 0 12px 40px rgba(0,0,0,0.40)`, theme.css L81).
    public static let shadowColor: Color = AdaptiveColor.color(
        light: .black(0.14),
        dark: .black(0.40)                       // desktop --shadow-lg alpha
    )
    public static let softShadowColor: Color = AdaptiveColor.color(
        light: .black(0.08),
        dark: .black(0.24)
    )
    public static let cardBlur: Material = .thinMaterial
    public static let panelBlur: Material = .regularMaterial
    public static let chromeBlur: Material = .ultraThinMaterial

    public static var background: LinearGradient {
        LinearGradient(
            colors: [
                windowBase,
                sidebarBase,
                accentSoft,
                secondaryAccent.opacity(0.10)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    @MainActor
    public static func cardGlassBackground(
        cornerRadius: CGFloat = Radius.card
    ) -> CardGlassBackgroundModifier {
        CardGlassBackgroundModifier(cornerRadius: cornerRadius)
    }

    public struct CardGlassBackgroundModifier: ViewModifier {
        public let cornerRadius: CGFloat
        @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

        public init(cornerRadius: CGFloat = Theme.Radius.card) {
            self.cornerRadius = cornerRadius
        }

        public func body(content: Content) -> some View {
            let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            content
                .background {
                    ZStack {
                        if reduceTransparency {
                            shape.fill(Theme.elevatedCardFill)
                        } else {
                            shape.fill(.ultraThinMaterial)
                            shape.fill(Theme.cardFill)
                        }
                    }
                }
                .overlay {
                    shape.stroke(Theme.cardStroke, lineWidth: 1)
                }
                .clipShape(shape)
                .shadow(color: Theme.shadowColor, radius: Theme.Shadow.cardRadius, y: Theme.Shadow.cardY)
        }
    }

    public enum Text {
        public static let primary: Color = Theme.primaryText
        public static let secondary: Color = Theme.secondaryText
        public static let tertiary: Color = Theme.tertiaryText
        public static let inverted: Color = Color.white
    }

    public enum Typography {
        public static let appTitle: Font = .system(size: 34, weight: .bold, design: .rounded)
        public static let screenTitle: Font = .system(size: 26, weight: .bold, design: .rounded)
        public static let sectionTitle: Font = .system(size: 17, weight: .semibold, design: .rounded)
        public static let headline: Font = .system(size: 20, weight: .semibold, design: .rounded)
        public static let body: Font = .system(size: 16, weight: .regular, design: .default)
        public static let callout: Font = .system(size: 15, weight: .regular, design: .default)
        public static let caption: Font = .system(size: 13, weight: .medium, design: .default)
        public static let smallCaption: Font = .system(size: 11, weight: .medium, design: .default)
        public static let code: Font = .system(size: 12, weight: .medium, design: .monospaced)
        public static let codeDisplay: Font = .system(size: 38, weight: .bold, design: .monospaced)
        public static let iconMedium: Font = .system(size: 30, weight: .semibold, design: .rounded)
        public static let iconLarge: Font = .system(size: 34, weight: .semibold, design: .rounded)
        public static let iconHero: Font = .system(size: 42, weight: .semibold, design: .rounded)
    }

    public enum Radius {
        public static let panel: CGFloat = 22
        public static let card: CGFloat = 18
        public static let control: CGFloat = 12
        public static let small: CGFloat = 8
    }

    public enum Spacing {
        public static let screen: CGFloat = 20
        public static let section: CGFloat = 16
        public static let control: CGFloat = 12
        public static let tight: CGFloat = 8
    }

    public enum Shadow {
        public static let cardRadius: CGFloat = 18
        public static let cardY: CGFloat = 10
        public static let softRadius: CGFloat = 12
        public static let softY: CGFloat = 6
    }

    public enum Motion {
        public static let handoff: Animation = .spring(response: 0.46, dampingFraction: 0.88)
        public static let quick: Animation = .easeOut(duration: 0.18)
    }
}

@available(iOS 17.0, macOS 14.0, *)
public extension View {
    @MainActor
    func cardGlassBackground(cornerRadius: CGFloat = Theme.Radius.card) -> some View {
        modifier(Theme.cardGlassBackground(cornerRadius: cornerRadius))
    }
}

private struct ThemeRGBA {
    let red: Double
    let green: Double
    let blue: Double
    let alpha: Double

    static func sRGB(_ red: Double, _ green: Double, _ blue: Double, _ alpha: Double) -> ThemeRGBA {
        ThemeRGBA(red: red, green: green, blue: blue, alpha: alpha)
    }

    static func white(_ alpha: Double) -> ThemeRGBA {
        ThemeRGBA(red: 1, green: 1, blue: 1, alpha: alpha)
    }

    static func black(_ alpha: Double) -> ThemeRGBA {
        ThemeRGBA(red: 0, green: 0, blue: 0, alpha: alpha)
    }
}

private enum AdaptiveColor {
    static func color(light: ThemeRGBA, dark: ThemeRGBA) -> Color {
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
private extension ThemeRGBA {
    var uiColor: UIColor {
        UIColor(red: red, green: green, blue: blue, alpha: alpha)
    }
}
#elseif canImport(AppKit)
private extension ThemeRGBA {
    var nsColor: NSColor {
        NSColor(srgbRed: red, green: green, blue: blue, alpha: alpha)
    }
}
#endif
