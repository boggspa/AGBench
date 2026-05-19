import SwiftUI

/// Pinned "Active runs" section at the top of the iPad sidebar. Mirrors the
/// Mac desktop's K1 sidebar shape: provider chip + workspace short-name +
/// elapsed timer per row; clicking a row navigates to that thread's detail.
///
/// When the iPad has a connection but no active runs, this view collapses to
/// a SUBTLE single-line "agents are idle" hint. When the iPad has no
/// connection at all (no workspaces + no threads in the store), the parent
/// hides the section entirely so it doesn't shout into the void.
@available(iOS 17.0, macOS 14.0, *)
struct SidebarActiveRunsSection: View {
    let activeThreads: [iPadThreadSummary]
    let workspaceLookup: (String) -> iPadWorkspaceSummary?
    let selectedThreadID: String?
    let onSelectThread: (String) -> Void
    /// Drives the elapsed timer's per-second tick without holding state in
    /// the parent. The container increments this on a timer.
    let elapsedTick: Date

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            header
            if activeThreads.isEmpty {
                idleHint
            } else {
                VStack(spacing: 6) {
                    ForEach(activeThreads) { thread in
                        SidebarActiveRunRow(
                            thread: thread,
                            workspace: thread.workspaceID.flatMap(workspaceLookup),
                            isSelected: thread.id == selectedThreadID,
                            elapsedTick: elapsedTick,
                            onSelect: { onSelectThread(thread.id) }
                        )
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Active runs")
    }

    @ViewBuilder
    private var header: some View {
        HStack(spacing: Theme.Spacing.tight) {
            Text("Active runs".uppercased())
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.tertiaryText)
                .accessibilityHidden(true)
            Spacer(minLength: Theme.Spacing.tight)
            if !activeThreads.isEmpty {
                Text("\(activeThreads.count)")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Theme.accentSoft, in: Capsule(style: .continuous))
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    private var idleHint: some View {
        HStack(spacing: Theme.Spacing.tight) {
            Image(systemName: "moon.zzz")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.tertiaryText)
                .frame(width: 16)
                .accessibilityHidden(true)
            Text("No active runs · agents are idle")
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
        }
        .padding(.horizontal, Theme.Spacing.control)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("No active runs, agents are idle")
    }
}

/// Single row inside the Active Runs pinned section. Compact: provider chip,
/// workspace short name, elapsed time.
@available(iOS 17.0, macOS 14.0, *)
private struct SidebarActiveRunRow: View {
    let thread: iPadThreadSummary
    let workspace: iPadWorkspaceSummary?
    let isSelected: Bool
    let elapsedTick: Date
    let onSelect: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: Theme.Spacing.tight) {
                Circle()
                    .fill(Theme.success)
                    .frame(width: 7, height: 7)
                    .overlay {
                        Circle()
                            .stroke(Theme.success.opacity(0.35), lineWidth: 3)
                            .blur(radius: 1.5)
                    }
                    .accessibilityHidden(true)
                providerChip
                VStack(alignment: .leading, spacing: 1) {
                    Text(workspaceShortName)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(isSelected ? Theme.primaryText : Theme.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(thread.title)
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.tertiaryText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: Theme.Spacing.tight)
                Text(elapsedLabel)
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.secondaryText)
                    .monospacedDigit()
            }
            .padding(.horizontal, Theme.Spacing.control)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .fill(rowBackground)
            }
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                    .stroke(rowStroke, lineWidth: isSelected ? 1.2 : 0.8)
            }
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(accessibilityValue)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private var rowBackground: Color {
        if isSelected { return Theme.accentSoft }
        if isHovered { return Theme.inputSurface }
        return Color.clear
    }

    private var rowStroke: Color {
        isSelected ? Theme.accent.opacity(0.4) : Theme.border.opacity(0.7)
    }

    private var providerChip: some View {
        let label = SidebarActiveRunsSection.providerLabel(for: thread.provider)
        let tint = SidebarActiveRunsSection.providerTint(for: thread.provider)
        return Text(label)
            .font(Theme.Typography.smallCaption)
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(tint.opacity(0.14), in: Capsule(style: .continuous))
            .accessibilityHidden(true)
    }

    private var workspaceShortName: String {
        if let workspace { return workspace.displayName }
        if let workspaceID = thread.workspaceID, !workspaceID.isEmpty {
            return workspaceID.split(separator: "/").last.map(String.init) ?? workspaceID
        }
        return thread.title
    }

    private var elapsedLabel: String {
        SidebarActiveRunsSection.formatElapsed(from: thread.lastActivityAt, now: elapsedTick)
    }

    private var accessibilityLabel: String {
        let provider = SidebarActiveRunsSection.providerLabel(for: thread.provider)
        return "\(provider) run on \(workspaceShortName)"
    }

    private var accessibilityValue: String {
        var parts: [String] = []
        if !thread.title.isEmpty { parts.append(thread.title) }
        parts.append("running for \(elapsedLabel)")
        return parts.joined(separator: ", ")
    }
}

@available(iOS 17.0, macOS 14.0, *)
extension SidebarActiveRunsSection {
    /// Provider label matching the Mac sidebar's capitalized short forms.
    /// Thin shim over `ProviderPalette.displayLabel(forRaw:)` so the iPad
    /// shell and the Live Activity widget share the same capitalisation
    /// logic.
    static func providerLabel(for provider: String?) -> String {
        ProviderPalette.displayLabel(forRaw: provider)
    }

    /// Tint per provider sourced from the shared `ProviderPalette`. Prior
    /// to the palette landing this routed each provider to a different
    /// `Theme` token (which produced colours that drifted from the
    /// desktop's `--provider-*-color` CSS variables); now both this row
    /// and the Live Activity badge resolve through the same shared
    /// `Color` for each provider.
    static func providerTint(for provider: String?) -> Color {
        ProviderPalette.color(forRaw: provider, fallback: Theme.accent)
    }

    /// Format elapsed time as `Xs` / `Xm` / `Xh Ym`. Mirrors the Mac
    /// `ActiveRunsSection.formatElapsed` behavior.
    static func formatElapsed(from start: Date, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(start)))
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        return "\(hours)h \(minutes % 60)m"
    }
}

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
#Preview("Active runs · populated") {
    SidebarActiveRunsSection(
        activeThreads: SidebarSampleData.threads.filter(\.isActive),
        workspaceLookup: { id in
            SidebarSampleData.workspaces.first { $0.id == id }
        },
        selectedThreadID: SidebarSampleData.threads.first(where: \.isActive)?.id,
        onSelectThread: { _ in },
        elapsedTick: Date()
    )
    .padding(Theme.Spacing.screen)
    .frame(maxWidth: 360)
    .background(Theme.sidebarBase)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("Active runs · idle") {
    SidebarActiveRunsSection(
        activeThreads: [],
        workspaceLookup: { _ in nil },
        selectedThreadID: nil,
        onSelectThread: { _ in },
        elapsedTick: Date()
    )
    .padding(Theme.Spacing.screen)
    .frame(maxWidth: 360)
    .background(Theme.sidebarBase)
}
#endif
