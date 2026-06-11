import SwiftUI
import TaskWraithKit

/// Inline "New chat" — replaces the compose sheet for solo threads. Lives in
/// the MAIN transcript pane (iPad detail column / iPhone push): welcome hero
/// above, composer roughly midway, the rotating heatmap below (where the
/// reference app shows starter prompts). On send, THIS view becomes the
/// transcript — the user continues right where they are.
struct NewChatCanvasView: View {
    @ObservedObject var model: RemoteSessionModel
    var initialWorkspaceId: String?

    @State private var workspaceId: String = ""
    @State private var prompt: String = ""
    @State private var createdThreadId: String? = nil

    private var workspace: WorkspaceSummary? {
        model.workspaces.first { $0.id == workspaceId }
    }

    private var draftCard: RemoteTaskCard {
        RemoteTaskCard.newChatDraft(
            workspaceId: workspaceId.isEmpty ? nil : workspaceId)
    }

    var body: some View {
        Group {
            if let threadId = createdThreadId {
                // The canvas BECOMES the transcript once the Mac mints the
                // thread — no navigation hop, exactly "continue from there".
                ThreadDetailView(model: model, taskId: threadId)
            } else {
                canvas
            }
        }
        .onAppear {
            if workspaceId.isEmpty {
                workspaceId = initialWorkspaceId ?? model.workspaces.first?.id ?? ""
            }
        }
        .onChange(of: model.navigationTarget) { _, target in
            guard let target, createdThreadId == nil else { return }
            createdThreadId = target
            model.navigationTarget = nil
        }
    }

    private var activityFooter: some View {
        let workspaceCards = model.taskCards.filter { $0.workspaceId == workspaceId }
        let workspaceDates = workspaceCards
            .flatMap { [twParseISODate($0.createdAt), twParseISODate($0.updatedAt)] }
            .compactMap { $0 }
        let allDates = model.taskCards
            .flatMap { [twParseISODate($0.createdAt), twParseISODate($0.updatedAt)] }
            .compactMap { $0 }
        return RotatingActivityHeatmap(flavors: [
            .init(
                id: "workspace", title: "WORKSPACE ACTIVITY",
                caption: "from synced chats", accent: TWTheme.chroma1,
                dates: workspaceDates),
            .init(
                id: "everywhere", title: "ALL WORKSPACES",
                caption: "from synced chats", accent: TWTheme.chroma3,
                dates: allDates),
            .init(
                id: "rhythm", title: "WEEKLY RHYTHM",
                caption: "hour × weekday", accent: TWTheme.chroma2,
                dates: allDates, weekly: true),
        ])
    }

    private var canvas: some View {
        ScrollView {
            VStack(spacing: 18) {
                Spacer(minLength: 30)
                // Hero (welcome-card parity)
                VStack(spacing: 10) {
                    MastheadLogoView(size: 46)
                        .shadow(color: TWTheme.chroma1.opacity(0.45), radius: 18)
                    Group {
                        Text("New chat for ")
                            .foregroundStyle(TWTheme.textSecondary)
                            + Text(workspace?.displayName ?? "…")
                            .foregroundStyle(TWTheme.chroma1)
                            .fontWeight(.semibold)
                            + Text(".")
                            .foregroundStyle(TWTheme.textSecondary)
                    }
                    .font(.title3)
                    .multilineTextAlignment(.center)
                    Text("The run starts on your Mac and streams back here.")
                        .font(.footnote)
                        .foregroundStyle(TWTheme.textTertiary)
                }

                // Workspace chips
                FlowChips(items: model.workspaces.map(\.id)) { id in
                    let name =
                        model.workspaces.first(where: { $0.id == id })?.displayName ?? id
                    Button {
                        workspaceId = id
                    } label: {
                        Text(name)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                workspaceId == id
                                    ? TWTheme.chroma1.opacity(0.18)
                                    : TWTheme.surface2,
                                in: Capsule()
                            )
                            .overlay(
                                Capsule().strokeBorder(
                                    workspaceId == id
                                        ? TWTheme.chroma1.opacity(0.6)
                                        : TWTheme.border)
                            )
                            .foregroundStyle(
                                workspaceId == id
                                    ? TWTheme.chroma1
                                    : TWTheme.textSecondary)
                    }
                    .buttonStyle(.plain)
                }

                // Thread composer (same shell as the detail view).
                Composer(
                    model: model,
                    card: draftCard,
                    newTaskWorkspaceId: workspaceId.isEmpty ? nil : workspaceId,
                    text: $prompt
                )
                .composerShellGlass()
                .padding(.horizontal, 4)

                // Heatmap below (replaces the reference app's starter prompts)
                activityFooter
                    .padding(.top, 8)
                Spacer(minLength: 20)
            }
            .padding(.horizontal, 18)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .background(TWTheme.appBg)
        .navigationTitle("New chat")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
