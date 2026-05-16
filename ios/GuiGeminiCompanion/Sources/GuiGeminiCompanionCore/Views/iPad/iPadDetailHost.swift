import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct iPadDetailHost: View {
    public let selection: iPadSidebarSelection
    public let transcriptViewModel: TranscriptViewModel?
    public let approvalViewModel: ApprovalViewModel?
    public let composerViewModel: ComposerViewModel?
    public let selectedWorkspace: iPadWorkspaceSummary?

    public init(
        selection: iPadSidebarSelection,
        transcriptViewModel: TranscriptViewModel? = nil,
        approvalViewModel: ApprovalViewModel? = nil,
        composerViewModel: ComposerViewModel? = nil,
        selectedWorkspace: iPadWorkspaceSummary? = nil
    ) {
        self.selection = selection
        self.transcriptViewModel = transcriptViewModel
        self.approvalViewModel = approvalViewModel
        self.composerViewModel = composerViewModel
        self.selectedWorkspace = selectedWorkspace
    }

    public var body: some View {
        ZStack {
            Theme.windowBase.ignoresSafeArea()
            VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                contextBar
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .cardGlassBackground(cornerRadius: Theme.Radius.panel)
            }
            .padding(Theme.Spacing.screen)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var contextBar: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            Label(selection.title, systemImage: selection.systemImage)
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.primaryText)
            Spacer(minLength: Theme.Spacing.control)
            if let selectedWorkspace {
                Label(selectedWorkspace.displayName, systemImage: "folder")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.inputSurface, in: Capsule(style: .continuous))
                    .accessibilityLabel("Selected workspace")
                    .accessibilityValue(selectedWorkspace.accessibilitySummary)
            }
        }
        .padding(.horizontal, Theme.Spacing.section)
        .padding(.vertical, Theme.Spacing.control)
        .cardGlassBackground(cornerRadius: Theme.Radius.control)
    }

    @ViewBuilder
    private var content: some View {
        switch selection {
        case .transcripts:
            if let transcriptViewModel {
                TranscriptView(viewModel: transcriptViewModel)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                unavailablePane(
                    title: "Transcript unavailable",
                    message: "A TranscriptViewModel has not been provided.",
                    systemImage: "waveform.path.ecg.rectangle"
                )
            }
        case .approvals:
            if let approvalViewModel {
                ApprovalCardsView(viewModel: approvalViewModel)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                unavailablePane(
                    title: "Approvals unavailable",
                    message: "An ApprovalViewModel has not been provided.",
                    systemImage: "checkmark.shield"
                )
            }
        case .compose:
            if let composerViewModel {
                ComposerView(viewModel: composerViewModel)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                unavailablePane(
                    title: "Composer unavailable",
                    message: "A ComposerViewModel has not been provided.",
                    systemImage: "square.and.pencil"
                )
            }
        }
    }

    private func unavailablePane(
        title: String,
        message: String,
        systemImage: String
    ) -> some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: systemImage)
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.accent)
                .frame(width: 84, height: 84)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            Text(title)
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.primaryText)
            Text(message)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: 420, maxHeight: .infinity)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
