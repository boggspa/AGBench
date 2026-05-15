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
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            ScrollViewReader { scrollProxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(viewModel.events.enumerated()), id: \.offset) { offset, event in
                            row(for: event)
                                .id(offset)
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.events.count) { _, newCount in
                    guard newCount > 0 else { return }
                    withAnimation(.easeOut(duration: 0.15)) {
                        scrollProxy.scrollTo(newCount - 1, anchor: .bottom)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var header: some View {
        HStack {
            Text("Transcript")
                .font(.title2.bold())
            Spacer()
            if let status = viewModel.lastStatus {
                Text(status)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            Button("Clear", action: viewModel.clear)
                .font(.caption)
                .buttonStyle(.bordered)
        }
        .padding()
    }

    @ViewBuilder
    private func row(for event: BridgeRunEvent) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: glyph(for: event.channel))
                .foregroundStyle(color(for: event.channel))
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(event.channel.rawValue)
                        .font(.caption.weight(.semibold))
                    Text(event.provider)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(event.publishedAt.formatted(date: .omitted, time: .standard))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                payloadPreview(for: event)
            }
        }
    }

    @ViewBuilder
    private func payloadPreview(for event: BridgeRunEvent) -> some View {
        if let dict = event.payloadDictionary(),
           let text = dict["text"] as? String ?? dict["error"] as? String {
            // Provider output / error events carry a `text` field —
            // surface it inline as the most useful preview for the user.
            Text(text)
                .font(.system(.callout, design: .default))
                .lineLimit(8)
                .textSelection(.enabled)
        } else if let dict = event.payloadDictionary(), let code = dict["code"] as? Int {
            Text("exit code: \(code)")
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
        } else {
            // Fallback: raw JSON peek
            Text(rawJSONString(for: event))
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
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
        case .agentOutput, .geminiOutput: return .accentColor
        case .agentError, .geminiError: return .red
        case .agentExit, .geminiExit: return .green
        }
    }
}
