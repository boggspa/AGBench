import SwiftUI

/// TranscriptView — append-only list of BridgeRunEvents from the
/// paired Mac. The desktop's transcript fans out here via the
/// `RunEventBus → BridgeRunEventSink → daemon → QUIC → iOS` pipeline.
///
/// Today's rendering: a vertically-stacked list with one row per
/// event, showing channel + provider + a compact JSON preview of the
/// payload. The view auto-scrolls to the latest event.
@available(iOS 17.0, macOS 14.0, *)
public struct TranscriptView: View {
    @Bindable public var viewModel: TranscriptViewModel

    public init(viewModel: TranscriptViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                header
                if viewModel.events.isEmpty {
                    EmptyTranscriptState()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollViewReader { scrollProxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: Theme.Spacing.control) {
                                ForEach(Array(viewModel.events.enumerated()), id: \.offset) { offset, event in
                                    row(for: event)
                                        .id(offset)
                                }
                            }
                            .padding(.bottom, Theme.Spacing.screen)
                        }
                        .scrollIndicators(.hidden)
                        .onChange(of: viewModel.events.count) { _, newCount in
                            guard newCount > 0 else { return }
                            withAnimation(Theme.Motion.quick) {
                                scrollProxy.scrollTo(newCount - 1, anchor: .bottom)
                            }
                        }
                    }
                }
            }
            .padding(Theme.Spacing.screen)
        }
    }

    @ViewBuilder
    private var header: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Live Transcript")
                    .font(Theme.Typography.screenTitle)
                    .foregroundStyle(Theme.Text.primary)
                Text("Mirrors provider output and run status from your Mac.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.secondary)
            }
            Spacer()
            if let route = viewModel.activeRouteLabel {
                statusPill(route)
            } else if let status = viewModel.lastStatus {
                statusPill(status)
            }
            Button(action: viewModel.clear) {
                Label("Clear", systemImage: "trash")
                    .labelStyle(.iconOnly)
            }
                .font(Theme.Typography.caption)
                .buttonStyle(.bordered)
                .accessibilityLabel("Clear transcript")
        }
        .padding(Theme.Spacing.section)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: Theme.softShadowColor, radius: Theme.Shadow.softRadius, y: Theme.Shadow.softY)
    }

    @ViewBuilder
    private func statusPill(_ status: String) -> some View {
        Text(status)
            .font(Theme.Typography.code)
            .foregroundStyle(Theme.accent)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Theme.accent.opacity(0.12), in: Capsule())
    }

    @ViewBuilder
    private func row(for event: BridgeRunEvent) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.control) {
            Image(systemName: glyph(for: event.channel))
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(color(for: event.channel))
                .frame(width: 28, height: 28)
                .background(color(for: event.channel).opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(event.channel.rawValue)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Text.primary)
                    Text(event.provider)
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.Text.secondary)
                    Spacer()
                    Text(event.publishedAt.formatted(date: .omitted, time: .standard))
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.Text.tertiary)
                }
                payloadPreview(for: event)
            }
        }
        .padding(Theme.Spacing.section)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
        .shadow(color: Theme.softShadowColor, radius: Theme.Shadow.softRadius, y: Theme.Shadow.softY)
    }

    @ViewBuilder
    private func payloadPreview(for event: BridgeRunEvent) -> some View {
        if let dict = event.payloadDictionary(),
           let text = dict["text"] as? String ?? dict["error"] as? String {
            // Provider output / error events carry a `text` field —
            // surface it inline as the most useful preview for the user.
            Text(text)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.primary)
                .lineLimit(8)
                .textSelection(.enabled)
        } else if let dict = event.payloadDictionary(), let code = dict["code"] as? Int {
            Text("exit code: \(code)")
                .font(Theme.Typography.code)
                .foregroundStyle(Theme.Text.secondary)
        } else {
            // Fallback: raw JSON peek
            Text(rawJSONString(for: event))
                .font(Theme.Typography.code)
                .foregroundStyle(Theme.Text.secondary)
                .lineLimit(2)
        }
    }

    private func rawJSONString(for event: BridgeRunEvent) -> String {
        guard let s = String(data: event.payloadJSON, encoding: .utf8) else {
            return "<non-utf8>"
        }
        if s.count > 200 {
            return String(s.prefix(200)) + "…"
        }
        return s
    }

    private func glyph(for channel: BridgeRunEvent.Channel) -> String {
        switch channel {
        case .agentOutput, .geminiOutput: return "text.bubble"
        case .agentError, .geminiError: return "exclamationmark.triangle"
        case .agentExit, .geminiExit: return "checkmark.circle"
        }
    }

    private func color(for channel: BridgeRunEvent.Channel) -> Color {
        switch channel {
        case .agentOutput, .geminiOutput: return Theme.accent
        case .agentError, .geminiError: return Theme.destructive
        case .agentExit, .geminiExit: return Theme.success
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct EmptyTranscriptState: View {
    var body: some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: "waveform.path.ecg.rectangle")
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.accent)
                .frame(width: 84, height: 84)
                .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .stroke(Theme.strongBorder, lineWidth: 1)
                )
            Text("No run events yet")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Text.primary)
            Text("Start or resume a provider run on your Mac and the live transcript will stream into this tab.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: 340)
    }
}
