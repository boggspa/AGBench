import ActivityKit
import AGBenchRunActivityShared
import SwiftUI
import WidgetKit

struct AGBenchRunActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AGBenchRunActivityAttributes.self) { context in
            LockScreenRunView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color(red: 0.07, green: 0.09, blue: 0.13).opacity(0.82))
                .activitySystemActionForegroundColor(providerAccent(context.attributes.provider))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ProviderBadge(provider: context.attributes.provider, status: context.state.status)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(durationText(context.state.durationS))
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.threadTitle)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                        Text(context.attributes.workspaceName)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    StatusLine(attributes: context.attributes, state: context.state)
                }
            } compactLeading: {
                ProviderBadge(provider: context.attributes.provider, status: context.state.status, size: 22)
            } compactTrailing: {
                if context.state.pendingApprovalCount > 0 {
                    Image(systemName: "hand.raised.fill")
                        .foregroundStyle(.orange)
                } else {
                    Text(durationText(context.state.durationS))
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                }
            } minimal: {
                ProviderBadge(provider: context.attributes.provider, status: context.state.status, size: 18)
            }
            .keylineTint(providerAccent(context.attributes.provider))
        }
    }
}

private struct LockScreenRunView: View {
    let attributes: AGBenchRunActivityAttributes
    let state: AGBenchRunActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            ProviderBadge(provider: attributes.provider, status: state.status, size: 38)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Text(providerLabel(attributes.provider))
                        .font(.caption2.weight(.bold))
                        .textCase(.uppercase)
                        .foregroundStyle(providerAccent(attributes.provider))
                    Text(statusLabel(state.status))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(statusColor(state.status))
                    if state.pendingApprovalCount > 0 {
                        Label("\(state.pendingApprovalCount)", systemImage: "hand.raised.fill")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.orange)
                    }
                }
                Text(attributes.threadTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                StatusLine(attributes: attributes, state: state)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 3) {
                Text(durationText(state.durationS))
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.primary)
                Text(attributes.workspaceName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(14)
        .background {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(.ultraThinMaterial)
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color(red: 0.09, green: 0.12, blue: 0.18).opacity(0.56))
                Rectangle()
                    .fill(providerAccent(attributes.provider))
                    .frame(width: 4)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.white.opacity(0.13), lineWidth: 0.75)
        }
    }
}

private struct StatusLine: View {
    let attributes: AGBenchRunActivityAttributes
    let state: AGBenchRunActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 5) {
            Text(statusLabel(state.status))
                .font(.caption.weight(.semibold))
                .foregroundStyle(statusColor(state.status))
            if state.toolCallsCount > 0 {
                Text("· \(state.toolCallsCount) tools")
                    .foregroundStyle(.secondary)
            }
            if let summary = state.lastEventSummary, !summary.isEmpty {
                Text("· \(summary)")
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .font(.caption)
        .lineLimit(1)
    }
}

private struct ProviderBadge: View {
    let provider: String
    let status: AGBenchRunActivityStatus
    var size: CGFloat = 30

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                .fill(providerAccent(provider).opacity(0.20))
                .overlay {
                    RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                        .stroke(providerAccent(provider).opacity(0.62), lineWidth: 1)
                }
            Text(providerInitial(provider))
                .font(.system(size: size * 0.46, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            Image(systemName: statusGlyph(status))
                .font(.system(size: size * 0.26, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: size * 0.42, height: size * 0.42)
                .background(statusColor(status), in: Circle())
                .offset(x: size * 0.12, y: size * 0.12)
        }
        .frame(width: size, height: size)
        .accessibilityLabel("\(providerLabel(provider)) \(statusLabel(status))")
    }
}

private func providerInitial(_ provider: String) -> String {
    provider.trimmingCharacters(in: .whitespacesAndNewlines).first.map { String($0).uppercased() } ?? "A"
}

private func providerLabel(_ provider: String) -> String {
    switch provider.lowercased() {
    case "gemini": return "Gemini"
    case "codex": return "Codex"
    case "claude": return "Claude"
    case "kimi": return "Kimi"
    case "grok": return "Grok"
    case "cursor": return "Cursor"
    default:
        return provider.isEmpty ? "AGBench" : provider.capitalized
    }
}

/// Provider accent for the Live Activity widget. Sourced from
/// `AGBenchRunActivityShared.ProviderPaletteRGB` so the widget and the
/// main app (`ProviderPalette` in `GuiGeminiCompanionCore`) draw chips
/// from the same desktop-derived `--provider-*-color` hex values.
///
/// The widget targets dark surfaces almost exclusively (lock screen,
/// dynamic island, always-on display) so we pick the `.dark` component
/// regardless of trait collection — even on a light home-screen wallpaper
/// the activity background tints the chrome dark enough that the brighter
/// dark hue stays readable.
private func providerAccent(_ provider: String) -> Color {
    let components = ProviderPaletteRGB.pair(for: provider)?.dark
        ?? (red: 0.48, green: 0.76, blue: 0.94, alpha: 1.0)
    return Color(.sRGB, red: components.red, green: components.green, blue: components.blue, opacity: components.alpha)
}

private func statusLabel(_ status: AGBenchRunActivityStatus) -> String {
    switch status {
    case .running: return "Running"
    case .completed: return "Done"
    case .failed: return "Failed"
    case .cancelled: return "Cancelled"
    }
}

private func statusGlyph(_ status: AGBenchRunActivityStatus) -> String {
    switch status {
    case .running: return "arrow.triangle.2.circlepath"
    case .completed: return "checkmark"
    case .failed: return "exclamationmark"
    case .cancelled: return "xmark"
    }
}

private func statusColor(_ status: AGBenchRunActivityStatus) -> Color {
    switch status {
    case .running: return .cyan
    case .completed: return .green
    case .failed: return .red
    case .cancelled: return .secondary
    }
}

private func durationText(_ seconds: Int) -> String {
    let clamped = max(0, seconds)
    let minutes = clamped / 60
    let remainder = clamped % 60
    if minutes >= 60 {
        let hours = minutes / 60
        return "\(hours)h \(minutes % 60)m"
    }
    return "\(minutes):" + String(format: "%02d", remainder)
}
