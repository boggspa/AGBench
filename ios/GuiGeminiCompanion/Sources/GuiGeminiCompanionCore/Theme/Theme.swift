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
    public static let windowBase: Color = AdaptiveColor.color(
        light: .white(0.94),
        dark: .black(0.96)
    )
    public static let cardFill: Color = AdaptiveColor.color(
        light: .sRGB(0.965, 0.975, 0.985, 0.68),
        dark: .sRGB(0.030, 0.037, 0.046, 0.72)
    )
    public static let cardStroke: Color = AdaptiveColor.color(
        light: .black(0.10),
        dark: .white(0.13)
    )
    public static let elevatedCardFill: Color = AdaptiveColor.color(
        light: .sRGB(0.985, 0.990, 1.000, 0.78),
        dark: .sRGB(0.040, 0.047, 0.058, 0.82)
    )
    public static let accent: Color = Color(red: 0.060, green: 0.430, blue: 0.920)
    public static let accentSoft: Color = AdaptiveColor.color(
        light: .sRGB(0.060, 0.430, 0.920, 0.14),
        dark: .sRGB(0.040, 0.220, 0.520, 0.42)
    )
    public static let accentGlow: Color = Color(red: 0.35, green: 0.72, blue: 1.0)
    public static let secondaryAccent: Color = AdaptiveColor.color(
        light: .sRGB(0.000, 0.450, 0.620, 1.00),
        dark: .sRGB(0.360, 0.730, 0.820, 1.00)
    )
    public static let success: Color = Color(red: 0.10, green: 0.58, blue: 0.36)
    public static let warning: Color = Color(red: 0.93, green: 0.48, blue: 0.16)
    public static let destructive: Color = Color(red: 0.86, green: 0.16, blue: 0.18)
    public static let primaryText: Color = AdaptiveColor.color(
        light: .black(0.88),
        dark: .white(0.96)
    )
    public static let secondaryText: Color = AdaptiveColor.color(
        light: .black(0.62),
        dark: .white(0.66)
    )
    public static let tertiaryText: Color = AdaptiveColor.color(
        light: .black(0.44),
        dark: .white(0.44)
    )
    public static let separator: Color = AdaptiveColor.color(
        light: .black(0.09),
        dark: .white(0.09)
    )
    public static let sidebarBase: Color = AdaptiveColor.color(
        light: .white(0.76),
        dark: .black(0.94)
    )

    public static var backgroundBase: Color { windowBase }
    public static var surface: Color { cardFill }
    public static var elevatedSurface: Color { elevatedCardFill }

    public static let inputSurface: Color = AdaptiveColor.color(
        light: .black(0.07),
        dark: .white(0.07)
    )
    public static let border: Color = AdaptiveColor.color(
        light: .black(0.09),
        dark: .white(0.12)
    )
    public static let strongBorder: Color = AdaptiveColor.color(
        light: .black(0.14),
        dark: .white(0.20)
    )
    public static let shadowColor: Color = AdaptiveColor.color(
        light: .black(0.14),
        dark: .black(0.28)
    )
    public static let softShadowColor: Color = AdaptiveColor.color(
        light: .black(0.08),
        dark: .black(0.18)
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
