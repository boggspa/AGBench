import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct iPadSidebar: View {
    @Bindable public var store: iPadSidebarStore
    @Bindable public var selectionState: iPadSelectionState

    public init(
        store: iPadSidebarStore,
        selectionState: iPadSelectionState
    ) {
        self.store = store
        self.selectionState = selectionState
    }

    public var body: some View {
        ZStack {
            Theme.sidebarBase.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                    header
                    workspacesSection
                    threadsSection
                    settingsSection
                    Spacer(minLength: Theme.Spacing.screen)
                }
                .padding(.horizontal, Theme.Spacing.section)
                .padding(.vertical, Theme.Spacing.screen)
            }
            .scrollIndicators(.hidden)
        }
        .accessibilityElement(children: .contain)
    }

    private var selectedWorkspaceID: String? {
        selectionState.selectedWorkspaceID
            ?? selectedThread?.workspaceID
            ?? store.workspaces.first(where: \.isActive)?.id
    }

    private var selectedThread: iPadThreadSummary? {
        guard let threadID = selectionState.selectedThreadID else { return nil }
        return store.thread(id: threadID)
    }

    @ViewBuilder
    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: Theme.Spacing.tight) {
                Image(systemName: "ipad.landscape")
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.accent)
                    .frame(width: 32, height: 32)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text("GuiGemini")
                        .font(Theme.Typography.headline)
                        .foregroundStyle(Theme.primaryText)
                    Text("Remote Console")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.secondaryText)
                }
            }
        }
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    private var workspacesSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            sectionLabel("Workspaces")
            if store.workspaces.isEmpty {
                emptyRow(
                    title: "No workspaces",
                    subtitle: "Allowed Mac workspaces appear here.",
                    systemImage: "folder.badge.questionmark"
                )
            } else {
                ForEach(store.workspaces) { workspace in
                    workspaceRow(workspace)
                }
            }
        }
    }

    @ViewBuilder
    private var threadsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            sectionLabel("Threads")
            if store.threads.isEmpty {
                emptyRow(
                    title: "No threads",
                    subtitle: "Active runs and recent turns appear here.",
                    systemImage: "text.bubble"
                )
            } else {
                ForEach(store.threads) { thread in
                    threadRow(thread)
                }
            }
        }
    }

    @ViewBuilder
    private var settingsSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            sectionLabel("Settings")
            Button {
                withAnimation(Theme.Motion.quick) {
                    selectionState.selectSettings()
                }
            } label: {
                sidebarRowContent(
                    title: "Connection",
                    subtitle: "Pairing, network, and bridge status",
                    systemImage: "gearshape",
                    isSelected: selectionState.selection == .settings,
                    trailing: nil
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Connection settings")
            .accessibilityAddTraits(selectionState.selection == .settings ? [.isSelected] : [])
        }
    }

    private func workspaceRow(_ workspace: iPadWorkspaceSummary) -> some View {
        let isSelected = selectionState.selection == .workspace(workspace.id)
        let threadCount = store.threads(in: workspace.id).count
        return Button {
            withAnimation(Theme.Motion.quick) {
                selectionState.selectWorkspace(workspace.id)
            }
        } label: {
            sidebarRowContent(
                title: workspace.displayName,
                subtitle: workspace.subtitle,
                systemImage: workspace.isActive ? "folder.fill" : "folder",
                isSelected: isSelected,
                trailing: threadCount > 0 ? "\(threadCount)" : nil
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(workspace.displayName)
        .accessibilityValue(workspace.accessibilitySummary)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private func threadRow(_ thread: iPadThreadSummary) -> some View {
        let isSelected = selectionState.selection == .thread(thread.id)
        return Button {
            withAnimation(Theme.Motion.quick) {
                selectionState.selectThread(thread.id)
            }
        } label: {
            HStack(alignment: .top, spacing: Theme.Spacing.control) {
                Circle()
                    .fill(thread.isActive ? Theme.success : Theme.tertiaryText)
                    .frame(width: 8, height: 8)
                    .padding(.top, 7)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(thread.title)
                            .font(Theme.Typography.sectionTitle)
                            .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
                            .lineLimit(1)
                        Spacer(minLength: Theme.Spacing.tight)
                        Text(thread.lastActivityAt, style: .relative)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.tertiaryText)
                            .lineLimit(1)
                    }
                    if !thread.subtitle.isEmpty {
                        Text(thread.subtitle)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.tertiaryText)
                            .lineLimit(2)
                    }
                    if let provider = thread.provider, !provider.isEmpty {
                        Text(provider)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(Theme.accent)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(Theme.accentSoft, in: Capsule(style: .continuous))
                    }
                }
            }
            .rowChrome(isSelected: isSelected)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(thread.title)
        .accessibilityValue(thread.accessibilitySummary)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private func emptyRow(
        title: String,
        subtitle: String,
        systemImage: String
    ) -> some View {
        sidebarRowContent(
            title: title,
            subtitle: subtitle,
            systemImage: systemImage,
            isSelected: false,
            trailing: nil
        )
        .opacity(0.72)
        .accessibilityElement(children: .combine)
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(Theme.Typography.smallCaption)
            .foregroundStyle(Theme.tertiaryText)
            .padding(.horizontal, 2)
            .accessibilityHidden(true)
    }

    private func sidebarRowContent(
        title: String,
        subtitle: String,
        systemImage: String,
        isSelected: Bool,
        trailing: String?
    ) -> some View {
        HStack(spacing: Theme.Spacing.control) {
            Image(systemName: systemImage)
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(isSelected ? Theme.accent : Theme.secondaryText)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.tertiaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: Theme.Spacing.tight)
            if let trailing {
                Text(trailing)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Theme.inputSurface, in: Capsule(style: .continuous))
            }
            if isSelected {
                Image(systemName: "checkmark")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.accent)
            }
        }
        .rowChrome(isSelected: isSelected)
    }
}

@available(iOS 17.0, macOS 14.0, *)
private extension View {
    func rowChrome(isSelected: Bool) -> some View {
        self
            .padding(.horizontal, Theme.Spacing.control)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                        .fill(Theme.accentSoft)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            .cardGlassBackground(cornerRadius: Theme.Radius.control)
    }
}
