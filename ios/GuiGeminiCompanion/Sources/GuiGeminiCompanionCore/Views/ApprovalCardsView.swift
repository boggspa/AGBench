import SwiftUI

/// ApprovalCardsView — pending tool-call approvals as a vertical stack
/// of cards. Each card has the three-state action: Accept,
/// Accept-for-session, Decline.
///
/// Visual is intentionally distinct from a chat row so the user can
/// triage approvals at a glance.
@available(iOS 17.0, macOS 14.0, *)
public struct ApprovalCardsView: View {
    @Bindable public var viewModel: ApprovalViewModel

    public init(viewModel: ApprovalViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if viewModel.pending.isEmpty {
                empty
            } else {
                ForEach(viewModel.pending) { approval in
                    card(for: approval)
                }
            }
            if let result = viewModel.lastResultMessage {
                Text(result)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
        }
        .padding()
    }

    @ViewBuilder
    private var header: some View {
        HStack {
            Text("Approvals")
                .font(.title2.bold())
            Spacer()
            if !viewModel.pending.isEmpty {
                Text("\(viewModel.pending.count) pending")
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(.orange.opacity(0.2), in: Capsule())
                    .foregroundStyle(.orange)
            }
        }
    }

    @ViewBuilder
    private var empty: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.shield")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No approvals pending")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }

    @ViewBuilder
    private func card(for approval: PendingApproval) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(approval.summary)
                .font(.body)
            HStack(spacing: 6) {
                Label(approval.workspaceId, systemImage: "folder")
                Text("·")
                Label(approval.threadId, systemImage: "bubble.left.and.bubble.right")
            }
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                Button("Decline", role: .destructive) {
                    Task { await viewModel.respond(to: approval, decision: .decline) }
                }
                .buttonStyle(.bordered)
                Spacer()
                Button("Once") {
                    Task { await viewModel.respond(to: approval, decision: .accept) }
                }
                .buttonStyle(.bordered)
                Button("For session") {
                    Task { await viewModel.respond(to: approval, decision: .acceptForSession) }
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(.orange.opacity(0.3), lineWidth: 1)
        )
    }
}
