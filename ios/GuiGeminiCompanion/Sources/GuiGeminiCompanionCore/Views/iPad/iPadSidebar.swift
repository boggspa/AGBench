import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct iPadSidebar: View {
    @Binding private var selection: iPadSidebarSelection
    @Binding private var selectedWorkspaceID: String?

    public let workspaces: [iPadWorkspaceSummary]

    public init(
        selection: Binding<iPadSidebarSelection>,
        selectedWorkspaceID: Binding<String?>,
        workspaces: [iPadWorkspaceSummary]
    ) {
        _selection = selection
        _selectedWorkspaceID = selectedWorkspaceID
        self.workspaces = workspaces
    }

    public var body: some View {
        ZStack {
            Theme.sidebarBase.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                    header
                    workspaceSelector
                    navigationSection
                    Spacer(minLength: Theme.Spacing.screen)
                }
                .padding(.horizontal, Theme.Spacing.section)
                .padding(.vertical, Theme.Spacing.screen)
            }
            .scrollIndicators(.hidden)
        }
        .accessibilityElement(children: .contain)
    }

    private var selectedWorkspace: iPadWorkspaceSummary? {
        guard let selectedWorkspaceID else { return nil }
        return workspaces.first { $0.id == selectedWorkspaceID }
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
    private var workspaceSelector: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            sectionLabel("Workspace")
            Menu {
                if workspaces.isEmpty {
                    Text("No workspaces")
                } else {
                    ForEach(workspaces) { workspace in
                        Button {
                            selectedWorkspaceID = workspace.id
                        } label: {
                            Label(
                                workspace.displayName,
                                systemImage: workspace.id == selectedWorkspaceID ? "checkmark.circle.fill" : "folder"
                            )
                        }
                    }
                }
            } label: {
                HStack(alignment: .center, spacing: Theme.Spacing.control) {
                    Image(systemName: selectedWorkspace == nil ? "folder.badge.questionmark" : "folder")
                        .font(Theme.Typography.sectionTitle)
                        .foregroundStyle(Theme.accent)
                        .frame(width: 28)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(selectedWorkspace?.displayName ?? "No workspace selected")
                            .font(Theme.Typography.sectionTitle)
                            .foregroundStyle(Theme.primaryText)
                            .lineLimit(1)
                        Text(selectedWorkspace?.subtitle ?? "Waiting for the Mac allowlist")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer(minLength: Theme.Spacing.tight)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.tertiaryText)
                }
                .padding(Theme.Spacing.control)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
            }
            .buttonStyle(.plain)
            .cardGlassBackground(cornerRadius: Theme.Radius.control)
            .disabled(workspaces.isEmpty)
            .accessibilityLabel("Workspace selector")
            .accessibilityValue(selectedWorkspace?.accessibilitySummary ?? "No workspace selected")
        }
    }

    @ViewBuilder
    private var navigationSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            sectionLabel("Sections")
            ForEach(iPadSidebarSelection.allCases) { item in
                sidebarRow(for: item)
            }
        }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(Theme.Typography.smallCaption)
            .foregroundStyle(Theme.tertiaryText)
            .padding(.horizontal, 2)
            .accessibilityHidden(true)
    }

    private func sidebarRow(for item: iPadSidebarSelection) -> some View {
        let isSelected = selection == item
        return Button {
            withAnimation(Theme.Motion.quick) {
                selection = item
            }
        } label: {
            HStack(spacing: Theme.Spacing.control) {
                Image(systemName: item.systemImage)
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(isSelected ? Theme.accent : Theme.secondaryText)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(Theme.Typography.sectionTitle)
                        .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
                    Text(item.subtitle)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.tertiaryText)
                        .lineLimit(1)
                }
                Spacer(minLength: Theme.Spacing.tight)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.accent)
                }
            }
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
        }
        .buttonStyle(.plain)
        .cardGlassBackground(cornerRadius: Theme.Radius.control)
        .accessibilityLabel(item.title)
        .accessibilityHint(item.subtitle)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
