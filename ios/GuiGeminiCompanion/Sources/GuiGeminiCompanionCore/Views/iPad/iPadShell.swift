import SwiftUI

public struct iPadWorkspaceSummary: Identifiable, Hashable, Sendable {
    public let id: String
    public let displayName: String
    public let pathDisplayHint: String?
    public let branchName: String?
    public let permissionMode: String?
    public let dirtyFileCount: Int
    public let isActive: Bool

    public init(
        id: String,
        displayName: String,
        pathDisplayHint: String? = nil,
        branchName: String? = nil,
        permissionMode: String? = nil,
        dirtyFileCount: Int = 0,
        isActive: Bool = false
    ) {
        self.id = id
        self.displayName = displayName.isEmpty ? id : displayName
        self.pathDisplayHint = pathDisplayHint
        self.branchName = branchName
        self.permissionMode = permissionMode
        self.dirtyFileCount = max(0, dirtyFileCount)
        self.isActive = isActive
    }

    public var subtitle: String {
        if let pathDisplayHint, !pathDisplayHint.isEmpty {
            return pathDisplayHint
        }
        if let branchName, !branchName.isEmpty {
            return branchName
        }
        if let permissionMode, !permissionMode.isEmpty {
            return permissionMode
        }
        return id
    }

    public var accessibilitySummary: String {
        var parts = [displayName]
        if subtitle != displayName {
            parts.append(subtitle)
        }
        if dirtyFileCount > 0 {
            parts.append("\(dirtyFileCount) changed files")
        }
        if let permissionMode, !permissionMode.isEmpty {
            parts.append(permissionMode)
        }
        return parts.joined(separator: ", ")
    }
}

public enum iPadSidebarSelection: String, CaseIterable, Identifiable, Sendable {
    case transcripts
    case approvals
    case compose

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .transcripts: return "Transcripts"
        case .approvals: return "Approvals"
        case .compose: return "Compose"
        }
    }

    public var subtitle: String {
        switch self {
        case .transcripts: return "Live run output"
        case .approvals: return "Pending tool requests"
        case .compose: return "New desktop turn"
        }
    }

    public var systemImage: String {
        switch self {
        case .transcripts: return "waveform.path.ecg.rectangle"
        case .approvals: return "checkmark.shield"
        case .compose: return "square.and.pencil"
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct iPadShell: View {
    public let transcriptViewModel: TranscriptViewModel?
    public let approvalViewModel: ApprovalViewModel?
    public let composerViewModel: ComposerViewModel?
    /// Already allowlist-filtered workspace summaries. The app target owns
    /// AppState and will adapt it into this package-safe API when RootView is wired.
    public let workspaces: [iPadWorkspaceSummary]

    @State private var columnVisibility: NavigationSplitViewVisibility
    @State private var internalSelection: iPadSidebarSelection
    @State private var internalSelectedWorkspaceID: String?

    private let externalSelection: Binding<iPadSidebarSelection>?
    private let externalSelectedWorkspaceID: Binding<String?>?

    public init(
        transcriptViewModel: TranscriptViewModel? = nil,
        approvalViewModel: ApprovalViewModel? = nil,
        composerViewModel: ComposerViewModel? = nil,
        workspaces: [iPadWorkspaceSummary] = [],
        selection: Binding<iPadSidebarSelection>? = nil,
        selectedWorkspaceID: Binding<String?>? = nil,
        initialSelection: iPadSidebarSelection = .transcripts,
        initialSelectedWorkspaceID: String? = nil
    ) {
        self.transcriptViewModel = transcriptViewModel
        self.approvalViewModel = approvalViewModel
        self.composerViewModel = composerViewModel
        self.workspaces = workspaces
        self.externalSelection = selection
        self.externalSelectedWorkspaceID = selectedWorkspaceID
        _columnVisibility = State(initialValue: .all)
        _internalSelection = State(initialValue: initialSelection)
        _internalSelectedWorkspaceID = State(
            initialValue: initialSelectedWorkspaceID
                ?? Self.preferredWorkspaceID(in: workspaces)
        )
    }

    public var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            iPadSidebar(
                selection: selectionBinding,
                selectedWorkspaceID: selectedWorkspaceIDBinding,
                workspaces: workspaces
            )
            .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 380)
        } detail: {
            iPadDetailHost(
                selection: selectionBinding.wrappedValue,
                transcriptViewModel: transcriptViewModel,
                approvalViewModel: approvalViewModel,
                composerViewModel: composerViewModel,
                selectedWorkspace: selectedWorkspace
            )
        }
        .navigationSplitViewStyle(.balanced)
        .tint(Theme.accent)
        .onChange(of: workspaces) { _, updatedWorkspaces in
            guard externalSelectedWorkspaceID == nil else { return }
            if let selectedID = internalSelectedWorkspaceID,
               updatedWorkspaces.contains(where: { $0.id == selectedID }) {
                return
            }
            internalSelectedWorkspaceID = Self.preferredWorkspaceID(in: updatedWorkspaces)
        }
    }

    private var selectionBinding: Binding<iPadSidebarSelection> {
        externalSelection ?? $internalSelection
    }

    private var selectedWorkspaceIDBinding: Binding<String?> {
        externalSelectedWorkspaceID ?? $internalSelectedWorkspaceID
    }

    private var selectedWorkspace: iPadWorkspaceSummary? {
        guard let selectedWorkspaceID = selectedWorkspaceIDBinding.wrappedValue else {
            return nil
        }
        return workspaces.first { $0.id == selectedWorkspaceID }
    }

    private static func preferredWorkspaceID(in workspaces: [iPadWorkspaceSummary]) -> String? {
        workspaces.first(where: \.isActive)?.id ?? workspaces.first?.id
    }
}
