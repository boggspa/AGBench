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
                    Text(approval.displayTitle)
                        .font(Theme.Typography.body)
                        .foregroundStyle(Theme.Text.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let body = approval.body, !body.isEmpty {
                        Text(body)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Text.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
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
            if let preview = approval.preview, shouldRenderPreviewBlock(preview) {
                previewBlock(for: preview)
            }
            HStack(spacing: Theme.Spacing.tight) {
                Spacer()
                ForEach(approval.resolvedActions, id: \.rawValue) { decision in
                    approvalButton(approval: approval, decision: decision)
                }
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

    /// Should the preview block be rendered? `.generic` and previews that
    /// would render nothing fall through to the existing title + body row
    /// so we don't waste a card surface on an empty container.
    private func shouldRenderPreviewBlock(_ preview: ApprovalPreview) -> Bool {
        switch preview.kind {
        case .generic:
            return false
        case .command:
            return (preview.command?.isEmpty == false) || (preview.cwd?.isEmpty == false)
        case .tool:
            return preview.toolName?.isEmpty == false
        case .patch:
            return preview.patchPreview?.isEmpty == false
        case .files:
            return (preview.changes ?? []).contains(where: { !$0.isEmpty })
        case .workspaceTrust:
            return preview.workspacePath?.isEmpty == false
        }
    }

    @ViewBuilder
    private func previewBlock(for preview: ApprovalPreview) -> some View {
        let kindTint: Color = previewTint(for: preview.kind)
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            switch preview.kind {
            case .command:
                if let command = preview.command, !command.isEmpty {
                    Text(command)
                        .font(Theme.Typography.code)
                        .foregroundStyle(Theme.Text.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .textSelection(.enabled)
                }
                if let cwd = preview.cwd, !cwd.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "folder")
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.Text.secondary)
                        Text(cwd)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.Text.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .truncationMode(.middle)
                    }
                }
            case .tool:
                if let toolName = preview.toolName, !toolName.isEmpty {
                    HStack(spacing: Theme.Spacing.tight) {
                        Image(systemName: "wrench.adjustable")
                            .font(Theme.Typography.smallCaption)
                        Text(toolName)
                            .font(Theme.Typography.caption)
                    }
                    .foregroundStyle(kindTint)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(kindTint.opacity(0.14), in: Capsule())
                }
            case .patch:
                if let patch = preview.patchPreview, !patch.isEmpty {
                    ScrollView(.vertical, showsIndicators: true) {
                        Text(patch)
                            .font(Theme.Typography.code)
                            .foregroundStyle(Theme.Text.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(Theme.Spacing.tight)
                    }
                    .frame(maxHeight: 180)
                    .background(
                        Theme.inputSurface,
                        in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous)
                    )
                }
            case .files:
                let allFiles = preview.changes ?? []
                let visible = Array(allFiles.prefix(8))
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(visible.enumerated()), id: \.offset) { _, file in
                        HStack(spacing: 6) {
                            Image(systemName: "doc.text")
                                .font(Theme.Typography.smallCaption)
                                .foregroundStyle(Theme.Text.secondary)
                            Text(file)
                                .font(Theme.Typography.code)
                                .foregroundStyle(Theme.Text.primary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    if allFiles.count > visible.count {
                        Text("+\(allFiles.count - visible.count) more")
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.Text.tertiary)
                    }
                }
            case .workspaceTrust:
                if let path = preview.workspacePath, !path.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "folder.badge.shield")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.warning)
                        Text(path)
                            .font(Theme.Typography.code)
                            .foregroundStyle(Theme.Text.primary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .truncationMode(.middle)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.warning.opacity(0.10), in: Capsule())
                    .overlay(
                        Capsule().stroke(Theme.warning.opacity(0.30), lineWidth: 1)
                    )
                }
            case .generic:
                EmptyView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Theme.Spacing.control)
        .background(
            Theme.cardBlur.opacity(0.5),
            in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
    }

    private func previewTint(for kind: ApprovalPreview.Kind) -> Color {
        switch kind {
        case .command:       return Theme.accent
        case .tool:          return Theme.secondaryAccent
        case .patch:         return Theme.accent
        case .files:         return Theme.accent
        case .workspaceTrust: return Theme.warning
        case .generic:       return Theme.Text.secondary
        }
    }

    @ViewBuilder
    private func approvalButton(
        approval: PendingApproval,
        decision: BridgeActionPayload.ApprovalDecision
    ) -> some View {
        if prominentDecision(decision) {
            Button(role: destructiveDecision(decision) ? .destructive : nil) {
                Task { await viewModel.respond(to: approval, decision: decision) }
            } label: {
                Label(decisionLabel(decision), systemImage: decisionIcon(decision))
            }
            .buttonStyle(.borderedProminent)
        } else {
            Button(role: destructiveDecision(decision) ? .destructive : nil) {
                Task { await viewModel.respond(to: approval, decision: decision) }
            } label: {
                Label(decisionLabel(decision), systemImage: decisionIcon(decision))
            }
            .buttonStyle(.bordered)
        }
    }

    private func destructiveDecision(_ decision: BridgeActionPayload.ApprovalDecision) -> Bool {
        decision == .decline || decision == .cancel
    }

    private func prominentDecision(_ decision: BridgeActionPayload.ApprovalDecision) -> Bool {
        decision == .acceptForSession || decision == .acceptForWorkspace
    }

    private func decisionLabel(_ decision: BridgeActionPayload.ApprovalDecision) -> String {
        switch decision {
        case .accept: return "Once"
        case .acceptForSession: return "For session"
        case .acceptForWorkspace: return "For workspace"
        case .decline: return "Decline"
        case .cancel: return "Cancel"
        }
    }

    private func decisionIcon(_ decision: BridgeActionPayload.ApprovalDecision) -> String {
        switch decision {
        case .accept: return "checkmark"
        case .acceptForSession: return "checkmark.seal.fill"
        case .acceptForWorkspace: return "building.2.crop.circle"
        case .decline: return "xmark"
        case .cancel: return "stop.circle"
        }
    }
}
