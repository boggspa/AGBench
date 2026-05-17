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
        ZStack {
            Theme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                    header
                    if viewModel.pending.isEmpty {
                        empty
                            .frame(maxWidth: .infinity)
                    } else {
                        ForEach(viewModel.pending) { approval in
                            card(for: approval)
                        }
                    }
                    if let result = viewModel.lastResultMessage {
                        Text(result)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Text.secondary)
                            .padding(Theme.Spacing.control)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                                    .stroke(Theme.border, lineWidth: 1)
                            )
                    }
                }
                .padding(Theme.Spacing.screen)
            }
            .scrollIndicators(.hidden)
        }
    }

    @ViewBuilder
    private var header: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Approval Queue")
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Text.primary)
                Text("Review desktop tool requests before they run.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.secondary)
            }
            Spacer()
            if !viewModel.pending.isEmpty {
                Text("\(viewModel.pending.count) pending")
                    .font(Theme.Typography.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.warning.opacity(0.16), in: Capsule())
                    .foregroundStyle(Theme.warning)
            }
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
    private var empty: some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: "checkmark.shield")
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.success)
                .frame(width: 86, height: 86)
                .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .stroke(Theme.strongBorder, lineWidth: 1)
                )
            Text("Nothing needs approval")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Text.primary)
            Text("When a provider asks to run a guarded tool, its decision card will appear here.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: 340)
    }

    @ViewBuilder
    private func card(for approval: PendingApproval) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            HStack(alignment: .top, spacing: Theme.Spacing.control) {
                Image(systemName: "shield.lefthalf.filled")
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.warning)
                    .frame(width: 34, height: 34)
                    .background(Theme.warning.opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 6) {
                    Text(approval.summary)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Text.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 6) {
                        Label(approval.workspaceId, systemImage: "folder")
                        Text("/")
                        Label(approval.threadId, systemImage: "bubble.left.and.bubble.right")
                    }
                    .font(Theme.Typography.code)
                    .foregroundStyle(Theme.Text.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
                }
            }
            HStack(spacing: Theme.Spacing.tight) {
                Button(role: .destructive) {
                    Task { await viewModel.respond(to: approval, decision: .decline) }
                } label: {
                    Label("Decline", systemImage: "xmark")
                }
                .buttonStyle(.bordered)
                Spacer()
                Button {
                    Task { await viewModel.respond(to: approval, decision: .accept) }
                } label: {
                    Label("Once", systemImage: "checkmark")
                }
                .buttonStyle(.bordered)
                Button {
                    Task { await viewModel.respond(to: approval, decision: .acceptForSession) }
                } label: {
                    Label("For session", systemImage: "checkmark.seal.fill")
                }
                .buttonStyle(.borderedProminent)
            }
            .font(Theme.Typography.caption)
        }
        .padding(Theme.Spacing.section)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                .stroke(Theme.warning.opacity(0.30), lineWidth: 1)
        )
        .shadow(color: Theme.shadowColor, radius: Theme.Shadow.cardRadius, y: Theme.Shadow.cardY)
    }
}
