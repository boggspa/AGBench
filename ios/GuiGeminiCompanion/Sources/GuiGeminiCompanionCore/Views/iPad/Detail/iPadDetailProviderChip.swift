import SwiftUI

/// Compact provider chip used across the detail host for thread rows,
/// workspace cards, and the K1-mirrored timeline. Color is derived from
/// a tiny lookup so each provider has a stable, recognizable tint.
@available(iOS 17.0, macOS 14.0, *)
struct iPadDetailProviderChip: View {
    let provider: String?
    var compact: Bool = false

    var body: some View {
        if let provider = trimmedProvider {
            HStack(spacing: 4) {
                Circle()
                    .fill(tint)
                    .frame(width: 6, height: 6)
                Text(provider)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(tint)
                    .textCase(.lowercase)
            }
            .padding(.horizontal, compact ? 6 : 8)
            .padding(.vertical, compact ? 2 : 3)
            .background(tint.opacity(0.12), in: Capsule(style: .continuous))
            .accessibilityLabel("Provider \(provider)")
        }
    }

    private var trimmedProvider: String? {
        let provider = (provider ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return provider.isEmpty ? nil : provider
    }

    private var tint: Color {
        Self.tint(for: trimmedProvider)
    }

    /// Stable per-provider color tint. Returns `Theme.accent` for unknown
    /// providers so new desktop additions still get a visible chip.
    static func tint(for provider: String?) -> Color {
        switch provider?.lowercased() {
        case "claude":
            return Color(red: 0.84, green: 0.49, blue: 0.20)
        case "codex":
            return Color(red: 0.10, green: 0.58, blue: 0.36)
        case "gemini":
            return Color(red: 0.40, green: 0.39, blue: 0.96)
        case "kimi":
            return Color(red: 0.18, green: 0.66, blue: 0.86)
        default:
            return Theme.accent
        }
    }
}
