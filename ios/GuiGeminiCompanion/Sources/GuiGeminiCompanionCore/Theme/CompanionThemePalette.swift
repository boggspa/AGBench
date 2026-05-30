import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

@available(iOS 17.0, macOS 14.0, *)
public struct CompanionThemePalette: @unchecked Sendable {
    public let windowBase: Color
    public let sidebarBase: Color
    public let cardFill: Color
    public let cardStroke: Color
    public let elevatedCardFill: Color
    public let inputSurface: Color
    public let composerSurface: Color
    public let composerBorder: Color
    public let primaryText: Color
    public let secondaryText: Color
    public let tertiaryText: Color
    public let separator: Color
    public let accent: Color
    public let accentSoft: Color
    public let secondaryAccent: Color
    public let success: Color
    public let warning: Color
    public let destructive: Color
    public let preferredColorScheme: ColorScheme?
    public let appearanceMode: String
    public let promptSurfaceStyle: String
    public let composerStyle: String
    public let reduceTransparency: Bool
    public let reduceMotion: Bool
    public let compactDensity: Bool

    public static var fallback: CompanionThemePalette {
        CompanionThemePalette(
            windowBase: Theme.windowBase,
            sidebarBase: Theme.sidebarBase,
            cardFill: Theme.cardFill,
            cardStroke: Theme.cardStroke,
            elevatedCardFill: Theme.elevatedCardFill,
            inputSurface: Theme.inputSurface,
            composerSurface: Theme.composerSurface,
            composerBorder: Theme.composerBorder,
            primaryText: Theme.primaryText,
            secondaryText: Theme.secondaryText,
            tertiaryText: Theme.tertiaryText,
            separator: Theme.separator,
            accent: Theme.accent,
            accentSoft: Theme.accentSoft,
            secondaryAccent: Theme.secondaryAccent,
            success: Theme.success,
            warning: Theme.warning,
            destructive: Theme.destructive,
            preferredColorScheme: nil,
            appearanceMode: "soft_glass",
            promptSurfaceStyle: "liquid_glass",
            composerStyle: "default",
            reduceTransparency: false,
            reduceMotion: false,
            compactDensity: false
        )
    }

    public init(
        windowBase: Color,
        sidebarBase: Color,
        cardFill: Color,
        cardStroke: Color,
        elevatedCardFill: Color,
        inputSurface: Color,
        composerSurface: Color,
        composerBorder: Color,
        primaryText: Color,
        secondaryText: Color,
        tertiaryText: Color,
        separator: Color,
        accent: Color,
        accentSoft: Color,
        secondaryAccent: Color,
        success: Color,
        warning: Color,
        destructive: Color,
        preferredColorScheme: ColorScheme?,
        appearanceMode: String,
        promptSurfaceStyle: String,
        composerStyle: String,
        reduceTransparency: Bool,
        reduceMotion: Bool,
        compactDensity: Bool
    ) {
        self.windowBase = windowBase
        self.sidebarBase = sidebarBase
        self.cardFill = cardFill
        self.cardStroke = cardStroke
        self.elevatedCardFill = elevatedCardFill
        self.inputSurface = inputSurface
        self.composerSurface = composerSurface
        self.composerBorder = composerBorder
        self.primaryText = primaryText
        self.secondaryText = secondaryText
        self.tertiaryText = tertiaryText
        self.separator = separator
        self.accent = accent
        self.accentSoft = accentSoft
        self.secondaryAccent = secondaryAccent
        self.success = success
        self.warning = warning
        self.destructive = destructive
        self.preferredColorScheme = preferredColorScheme
        self.appearanceMode = appearanceMode
        self.promptSurfaceStyle = promptSurfaceStyle
        self.composerStyle = composerStyle
        self.reduceTransparency = reduceTransparency
        self.reduceMotion = reduceMotion
        self.compactDensity = compactDensity
    }

    public init(appearance: RemoteShellAppearance?) {
        guard let appearance else {
            self = .fallback
            return
        }
        let fallback = CompanionThemePalette.fallback
        self.init(
            windowBase: Self.adaptive(appearance.colors.windowBase, fallback: fallback.windowBase),
            sidebarBase: Self.adaptive(appearance.colors.sidebarBase, fallback: fallback.sidebarBase),
            cardFill: Self.adaptive(appearance.colors.cardFill, fallback: fallback.cardFill),
            cardStroke: Self.adaptive(appearance.colors.cardStroke, fallback: fallback.cardStroke),
            elevatedCardFill: Self.adaptive(appearance.colors.elevatedCardFill, fallback: fallback.elevatedCardFill),
            inputSurface: Self.adaptive(appearance.colors.inputSurface, fallback: fallback.inputSurface),
            composerSurface: Self.adaptive(appearance.colors.composerSurface, fallback: fallback.composerSurface),
            composerBorder: Self.adaptive(appearance.colors.composerBorder, fallback: fallback.composerBorder),
            primaryText: Self.adaptive(appearance.colors.primaryText, fallback: fallback.primaryText),
            secondaryText: Self.adaptive(appearance.colors.secondaryText, fallback: fallback.secondaryText),
            tertiaryText: Self.adaptive(appearance.colors.tertiaryText, fallback: fallback.tertiaryText),
            separator: Self.adaptive(appearance.colors.separator, fallback: fallback.separator),
            accent: Self.color(appearance.colors.accent, fallback: fallback.accent),
            accentSoft: Self.adaptive(appearance.colors.accentSoft, fallback: fallback.accentSoft),
            secondaryAccent: Self.adaptive(appearance.colors.secondaryAccent, fallback: fallback.secondaryAccent),
            success: Self.color(appearance.colors.success, fallback: fallback.success),
            warning: Self.color(appearance.colors.warning, fallback: fallback.warning),
            destructive: Self.color(appearance.colors.destructive, fallback: fallback.destructive),
            preferredColorScheme: Self.colorScheme(appearance.preferredColorScheme),
            appearanceMode: appearance.appearanceMode,
            promptSurfaceStyle: appearance.promptSurfaceStyle,
            composerStyle: appearance.composerStyle,
            reduceTransparency: appearance.reduceTransparency,
            reduceMotion: appearance.reduceMotion,
            compactDensity: appearance.compactDensity
        )
    }

    public var background: LinearGradient {
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

    private static func colorScheme(_ scheme: RemoteShellColorScheme) -> ColorScheme? {
        switch scheme {
        case .system:
            return nil
        case .light:
            return .light
        case .dark:
            return .dark
        }
    }

    private static func adaptive(_ token: RemoteShellAdaptiveColor, fallback: Color) -> Color {
        guard let light = CompanionRGBA(hex: token.light),
              let dark = CompanionRGBA(hex: token.dark)
        else { return fallback }
        return CompanionAdaptiveColor.color(light: light, dark: dark)
    }

    private static func color(_ raw: String, fallback: Color) -> Color {
        guard let rgba = CompanionRGBA(hex: raw) else { return fallback }
        return Color(.sRGB, red: rgba.red, green: rgba.green, blue: rgba.blue, opacity: rgba.alpha)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct CompanionThemePaletteKey: EnvironmentKey {
    static let defaultValue: CompanionThemePalette = .fallback
}

@available(iOS 17.0, macOS 14.0, *)
public extension EnvironmentValues {
    var companionThemePalette: CompanionThemePalette {
        get { self[CompanionThemePaletteKey.self] }
        set { self[CompanionThemePaletteKey.self] = newValue }
    }
}

@available(iOS 17.0, macOS 14.0, *)
public extension View {
    func companionCardBackground(cornerRadius: CGFloat = Theme.Radius.panel) -> some View {
        modifier(CompanionCardBackgroundModifier(cornerRadius: cornerRadius))
    }

    func companionInputBackground(cornerRadius: CGFloat = Theme.Radius.control) -> some View {
        modifier(CompanionInputBackgroundModifier(cornerRadius: cornerRadius))
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct CompanionCardBackgroundModifier: ViewModifier {
    let cornerRadius: CGFloat
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.companionThemePalette) private var palette

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content
            .background {
                ZStack {
                    if reduceTransparency || palette.reduceTransparency {
                        shape.fill(palette.elevatedCardFill)
                    } else {
                        shape.fill(.ultraThinMaterial)
                        shape.fill(palette.cardFill)
                    }
                }
            }
            .overlay {
                shape.stroke(palette.cardStroke, lineWidth: 1)
            }
            .clipShape(shape)
            .shadow(color: Theme.shadowColor, radius: Theme.Shadow.cardRadius, y: Theme.Shadow.cardY)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct CompanionInputBackgroundModifier: ViewModifier {
    let cornerRadius: CGFloat
    @Environment(\.companionThemePalette) private var palette

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content
            .background(palette.inputSurface, in: shape)
            .overlay {
                shape.stroke(palette.cardStroke, lineWidth: 1)
            }
    }
}

private struct CompanionRGBA {
    let red: Double
    let green: Double
    let blue: Double
    let alpha: Double

    init?(hex raw: String) {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard value.count == 6 || value.count == 8,
              let integer = UInt64(value, radix: 16)
        else { return nil }

        if value.count == 6 {
            red = Double((integer >> 16) & 0xff) / 255.0
            green = Double((integer >> 8) & 0xff) / 255.0
            blue = Double(integer & 0xff) / 255.0
            alpha = 1.0
        } else {
            red = Double((integer >> 24) & 0xff) / 255.0
            green = Double((integer >> 16) & 0xff) / 255.0
            blue = Double((integer >> 8) & 0xff) / 255.0
            alpha = Double(integer & 0xff) / 255.0
        }
    }
}

private enum CompanionAdaptiveColor {
    static func color(light: CompanionRGBA, dark: CompanionRGBA) -> Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor { traits in
            let rgba = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: rgba.red, green: rgba.green, blue: rgba.blue, alpha: rgba.alpha)
        })
        #elseif canImport(AppKit)
        Color(nsColor: NSColor(name: nil) { appearance in
            let bestMatch = appearance.bestMatch(from: [.darkAqua, .aqua])
            let rgba = bestMatch == .darkAqua ? dark : light
            return NSColor(srgbRed: rgba.red, green: rgba.green, blue: rgba.blue, alpha: rgba.alpha)
        })
        #else
        Color(.sRGB, red: dark.red, green: dark.green, blue: dark.blue, opacity: dark.alpha)
        #endif
    }
}
