import SwiftUI

/// Rich empty-state card for sidebar sections (workspaces, threads). Shows:
///   - illustrative SF Symbol
///   - 2-line explanatory copy describing WHY the section is empty
///   - a single faded "Example" preview row built by the caller, so the user
///     can see what a populated row will look like
///
/// Used inside `iPadSidebar` only — the parent positions and pads it.
@available(iOS 17.0, macOS 14.0, *)
struct SidebarEmptyState<ExampleRow: View>: View {
    let systemImage: String
    let title: String
    let message: String
    @ViewBuilder let exampleRow: () -> ExampleRow

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                HStack(alignment: .top, spacing: Theme.Spacing.control) {
                    Image(systemName: systemImage)
                        .font(Theme.Typography.sectionTitle)
                        .foregroundStyle(Theme.accent)
                        .frame(width: 30, height: 30)
                        .background(
                            Theme.accentSoft,
                            in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous)
                        )
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(Theme.Typography.sectionTitle)
                            .foregroundStyle(Theme.primaryText)
                        Text(message)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                exampleHeader
                exampleRow()
                    .opacity(0.55)
                    .saturation(0.65)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .padding(Theme.Spacing.control)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.control)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityValue(message)
    }

    private var exampleHeader: some View {
        HStack(spacing: 6) {
            Text("Example".uppercased())
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Theme.inputSurface, in: Capsule(style: .continuous))
            Rectangle()
                .fill(Theme.separator)
                .frame(height: 1)
        }
        .padding(.top, 4)
        .padding(.horizontal, 2)
        .accessibilityHidden(true)
    }
}

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
#Preview("Empty workspaces") {
    SidebarEmptyState(
        systemImage: "folder.badge.questionmark",
        title: "No workspaces yet",
        message: "Your paired Mac hasn't broadcast workspaces yet — they'll appear here when the bridge starts emitting workspace events."
    ) {
        SidebarExampleWorkspaceRow(workspace: SidebarEmptyStateExample.workspaceRow)
    }
    .padding(Theme.Spacing.screen)
    .frame(maxWidth: 360)
    .background(Theme.sidebarBase)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("Empty threads") {
    SidebarEmptyState(
        systemImage: "text.bubble",
        title: "No threads yet",
        message: "Live runs and recent turns will appear here as soon as the desktop sends a transcript event."
    ) {
        SidebarExampleThreadRow(thread: SidebarEmptyStateExample.threadRow)
    }
    .padding(Theme.Spacing.screen)
    .frame(maxWidth: 360)
    .background(Theme.sidebarBase)
}
#endif

/// MOCK: faded example workspace row used in the empty-state card. Mirrors
/// the visual structure of the real workspace row in `iPadSidebar` without
/// the selection chrome / button hit area.
@available(iOS 17.0, macOS 14.0, *)
struct SidebarExampleWorkspaceRow: View {
    let workspace: iPadWorkspaceSummary

    var body: some View {
        HStack(spacing: Theme.Spacing.control) {
            Image(systemName: "folder.fill")
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.secondaryText)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(workspace.displayName)
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                Text(workspace.subtitle)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: Theme.Spacing.tight)
            if workspace.dirtyFileCount > 0 {
                Text("\(workspace.dirtyFileCount)")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Theme.inputSurface, in: Capsule(style: .continuous))
            }
        }
        .padding(.horizontal, Theme.Spacing.control)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        }
    }
}

/// MOCK: faded example thread row mirroring `iPadSidebar.threadRow`.
@available(iOS 17.0, macOS 14.0, *)
struct SidebarExampleThreadRow: View {
    let thread: iPadThreadSummary

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.control) {
            Circle()
                .fill(Theme.success)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(thread.title)
                        .font(Theme.Typography.sectionTitle)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                    Spacer(minLength: Theme.Spacing.tight)
                    Text("now")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.tertiaryText)
                }
                if !thread.subtitle.isEmpty {
                    Text(thread.subtitle)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.tertiaryText)
                        .lineLimit(2)
                }
                if let provider = thread.provider, !provider.isEmpty {
                    Text(SidebarActiveRunsSection.providerLabel(for: provider))
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Theme.accentSoft, in: Capsule(style: .continuous))
                }
            }
        }
        .padding(.horizontal, Theme.Spacing.control)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        }
    }
}
