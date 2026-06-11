// SwiftUI surface for the TaskWraith companion.
//
// Design direction (see ios/DESIGN.md): borrow the *format* of the Claude /
// Codex iOS apps — workspaces-as-projects home, thread view with collapsed
// history + tool chips, pill composer — but skinned entirely in TaskWraith's
// own theme tokens (TWTheme mirrors the desktop theme.css). iPhone focuses on
// solid thread management; iPad gets the sidebar (NavigationSplitView) where
// advanced affordances will live. Pure SwiftUI so `swift build` compile-checks
// on macOS; QR camera scanning is the one `#if os(iOS)` extra.

import SwiftUI
import TaskWraithKit

#if canImport(UIKit)
    import PhotosUI
    import UIKit
#endif

struct ComposeTaskView: View {
    @ObservedObject var model: RemoteSessionModel
    var mode: ComposeMode = .workspace
    @Environment(\.dismiss) private var dismiss
    @State private var workspaceId = ""
    @State private var provider = "claude"
    @State private var modelId: String?
    @State private var prompt = ""

    struct DraftParticipant: Identifiable, Equatable {
        let id = UUID()
        var provider: String
        var modelId: String?
    }
    @State private var roster: [DraftParticipant] = []
    @State private var rosterEdited = false

    private var catalogs: [ProviderModelCatalog] {
        let fromMac = model.providerModels.map {
            ProviderModelCatalog(provider: $0.key, models: $0.value)
        }
        if !fromMac.isEmpty {
            return fromMac.sorted {
                TWTheme.providerLabel($0.provider) < TWTheme.providerLabel($1.provider)
            }
        }
        return ["claude", "codex", "gemini", "kimi", "grok", "cursor", "ollama"].map {
            ProviderModelCatalog(provider: $0, models: [])
        }
    }

    private var workspaceName: String {
        model.workspaces.first { $0.workspaceId == workspaceId }?.displayName ?? "Workspace"
    }

    private var composeTitle: String {
        switch mode {
        case .workspace: return "New chat"
        case .ensemble: return "New ensemble"
        case .global: return "New global chat"
        }
    }

    private var composeSubtitle: String {
        switch mode {
        case .global:
            return "Cross-workspace planning on your Mac"
        default:
            return "in \(workspaceName)"
        }
    }

    private var starters: [WelcomeStarter] {
        let ws = workspaceName
        return [
            WelcomeStarter(
                id: "map", label: "Map project",
                description: "Orient around structure, risk, and best starting point.",
                prompt: """
                    Inspect the \(ws) workspace and give me a concise orientation.
                    Cover what this app does, main boundaries, files to read first, \
                    riskiest areas, and the best first task. Do not edit files yet.
                    """),
            WelcomeStarter(
                id: "plan", label: "Plan a change",
                description: "Define target, files, risks, and acceptance checks.",
                prompt: """
                    Make a scoped implementation plan for the next useful change in \(ws). \
                    Give the smallest valuable target, likely files, risks, acceptance checks, \
                    and the first edit you would make. Do not edit until the plan is clear.
                    """),
            WelcomeStarter(
                id: "improve", label: "Make improvement",
                description: "Find one small valuable edit and verify it.",
                prompt: """
                    Find and implement the smallest high-impact improvement in \(ws). \
                    State the target first, keep changes scoped, run narrow validation, \
                    and summarize what changed.
                    """),
        ]
    }

    private var modeAccent: Color {
        switch mode {
        case .workspace: return TWTheme.providerAccent(provider)
        case .ensemble: return TWTheme.chroma2
        case .global: return TWTheme.chroma3
        }
    }

    /// Editable speaking-order roster — add / remove / provider / model /
    /// reorder, mirroring the desktop's roster chip strip + flyout.
    private var rosterEditor: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(roster.enumerated()), id: \.element.id) { index, entry in
                rosterRow(index: index, entry: entry)
            }
            HStack {
                Menu {
                    ForEach(catalogs) { catalog in
                        Button {
                            roster.append(
                                DraftParticipant(provider: catalog.provider, modelId: nil))
                            rosterEdited = true
                        } label: {
                            Label(
                                TWTheme.providerLabel(catalog.provider),
                                systemImage: "person.badge.plus")
                        }
                    }
                } label: {
                    Label("Add participant", systemImage: "plus.circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(roster.count >= 12 ? TWTheme.textMuted : TWTheme.chroma2)
                }
                .disabled(roster.count >= 12)
                Spacer()
                Text("Speaking order · top first")
                    .font(.caption2)
                    .foregroundStyle(TWTheme.textTertiary)
            }
            .padding(.top, 2)
        }
    }

    @ViewBuilder
    private func rosterRow(index: Int, entry: DraftParticipant) -> some View {
        let accent = TWTheme.providerAccent(entry.provider)
        let models = model.providerModels[entry.provider] ?? []
        HStack(spacing: 8) {
            Text("\(index + 1)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(TWTheme.textMuted)
                .frame(width: 14)
            // Provider menu
            Menu {
                ForEach(catalogs) { catalog in
                    Button {
                        roster[index].provider = catalog.provider
                        roster[index].modelId = nil
                        rosterEdited = true
                    } label: {
                        Text(TWTheme.providerLabel(catalog.provider))
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Circle().fill(accent).frame(width: 6, height: 6)
                    Text(TWTheme.providerLabel(entry.provider))
                        .font(.caption.weight(.semibold))
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 8))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(accent.opacity(0.13), in: Capsule())
                .overlay(Capsule().strokeBorder(accent.opacity(0.35)))
                .foregroundStyle(accent)
            }
            // Model menu (per-provider catalog)
            Menu {
                Button("CLI Default") {
                    roster[index].modelId = nil
                    rosterEdited = true
                }
                ForEach(models) { option in
                    Button(option.label ?? option.id) {
                        roster[index].modelId = option.id
                        rosterEdited = true
                    }
                }
            } label: {
                Text(
                    roster[index].modelId.flatMap { id in
                        models.first { $0.id == id }?.label ?? id
                    } ?? "CLI Default"
                )
                .font(.caption2)
                .lineLimit(1)
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(TWTheme.surface3, in: Capsule())
                .foregroundStyle(TWTheme.textSecondary)
            }
            Spacer(minLength: 0)
            // Reorder + remove
            HStack(spacing: 10) {
                Button {
                    guard index > 0 else { return }
                    roster.swapAt(index, index - 1)
                    rosterEdited = true
                } label: {
                    Image(systemName: "chevron.up")
                }
                .disabled(index == 0)
                Button {
                    guard index < roster.count - 1 else { return }
                    roster.swapAt(index, index + 1)
                    rosterEdited = true
                } label: {
                    Image(systemName: "chevron.down")
                }
                .disabled(index == roster.count - 1)
                Button {
                    roster.remove(at: index)
                    rosterEdited = true
                } label: {
                    Image(systemName: "minus.circle")
                        .foregroundStyle(roster.count <= 2 ? TWTheme.textMuted : TWTheme.statusFailed)
                }
                .disabled(roster.count <= 2)
            }
            .font(.caption)
            .foregroundStyle(TWTheme.textSecondary)
            .buttonStyle(.plain)
        }
        .padding(.vertical, 3)
    }

    @ViewBuilder
    private func sectionCard<Content: View>(
        _ title: String, accent: Color, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(TWTheme.textTertiary)
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TWTheme.surface1, in: RoundedRectangle(cornerRadius: 14))
        .rimHighlight(accent: accent)
    }

    /// Providers configured on the Mac (catalog keys) — the best preview of
    /// the default ensemble roster the phone can render without a round.
    private var rosterPreview: [String] {
        let configured = model.providerModels.keys.sorted {
            TWTheme.providerLabel($0) < TWTheme.providerLabel($1)
        }
        return configured.isEmpty ? ["gemini", "codex", "claude"] : configured
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    hero
                    if mode != .global { workspaceChips }

                    if mode == .workspace {
                        sectionCard("AGENT", accent: modeAccent) {
                            ProviderModelPicker(
                                catalogs: catalogs, provider: $provider, modelId: $modelId)
                        }
                    } else if mode == .ensemble {
                        sectionCard("PARTICIPANTS", accent: TWTheme.chroma2) {
                            rosterEditor
                        }
                    }
                    promptCard
                    startButton
                    activityFooter
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .scrollContentBackground(.hidden)
            .background(TWTheme.appBg)
            .navigationTitle("")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                if workspaceId.isEmpty { workspaceId = model.workspaces.first?.workspaceId ?? "" }
                if mode == .ensemble, roster.isEmpty {
                    roster = rosterPreview.map { DraftParticipant(provider: $0, modelId: nil) }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // ── Hero — desktop welcome parity: centered satellite headline, no box ──
    private var heroTitle: Text {
        switch mode {
        case .workspace:
            return Text("New \(TWTheme.providerLabel(provider)) thread for ")
                .foregroundColor(TWTheme.textPrimary)
                + Text(workspaceName).bold().foregroundColor(modeAccent)
                + Text(".").foregroundColor(TWTheme.textPrimary)
        case .ensemble:
            return Text("New Ensemble chat in ")
                .foregroundColor(TWTheme.textPrimary)
                + Text(workspaceName).bold().foregroundColor(modeAccent)
                + Text(".").foregroundColor(TWTheme.textPrimary)
        case .global:
            return Text("New Ensemble chat in ")
                .foregroundColor(TWTheme.textPrimary)
                + Text("Global Chat").bold().foregroundColor(modeAccent)
                + Text(".").foregroundColor(TWTheme.textPrimary)
        }
    }

    private var hero: some View {
        VStack(spacing: 8) {
            GhostMarkView(size: 40)
                .shadow(color: modeAccent.opacity(0.55), radius: 14)
            heroTitle
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
            Text(composeBlurb)
                .font(.footnote)
                .foregroundStyle(TWTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 14)
        .padding(.horizontal, 8)
        .background(
            // Faint ambient wash behind the headline — the phone's nod to
            // the desktop sky, kept satellite (no card edges).
            RadialGradient(
                colors: [modeAccent.opacity(0.16), .clear],
                center: .top, startRadius: 0, endRadius: 230
            )
        )
    }

    // ── Workspace chips — the desktop "WORK IN FOLDER:" row ──
    private var workspaceChips: some View {
        VStack(alignment: .center, spacing: 8) {
            Text("WORK IN FOLDER")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TWTheme.textTertiary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(model.workspaces) { workspace in
                        let selected = workspace.workspaceId == workspaceId
                        Button {
                            workspaceId = workspace.workspaceId
                        } label: {
                            Text(workspace.displayName)
                                .font(.caption.weight(selected ? .semibold : .regular))
                                .padding(.horizontal, 11)
                                .padding(.vertical, 6)
                                .background(
                                    selected ? modeAccent.opacity(0.22) : TWTheme.surface2,
                                    in: Capsule()
                                )
                                .overlay(
                                    Capsule().strokeBorder(
                                        selected ? modeAccent.opacity(0.65) : TWTheme.border)
                                )
                                .foregroundStyle(
                                    selected ? modeAccent : TWTheme.textSecondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    // ── Prompt — composer-shell styling with focus accent ──
    private var promptCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("PROMPT")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TWTheme.textTertiary)
            TextField(promptPlaceholder, text: $prompt, axis: .vertical)
                .lineLimit(4...12)
                .foregroundStyle(TWTheme.textPrimary)
                .padding(12)
                .background(TWTheme.surface2, in: RoundedRectangle(cornerRadius: 14))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(
                            prompt.isEmpty ? TWTheme.border : modeAccent.opacity(0.45))
                )
        }
    }

    /// Desktop welcome parity: rotating activity heatmaps cycling every 90s.
    private var activityFooter: some View {
        let workspaceCards = model.taskCards.filter {
            mode == .global || $0.workspaceId == workspaceId
        }
        let workspaceEvents = twActivityHeatmapEvents(from: workspaceCards)
        let taskWraithEvents = twActivityHeatmapEvents(from: model.taskCards)
        let externalEvents: [ActivityHeatmapEvent] = []
        return RotatingActivityHeatmap(flavors: [
            .init(
                id: "workspace", title: "Workspace Activity",
                caption: "current workspace", accent: TWTheme.chroma1,
                events: workspaceEvents),
            .init(
                id: "taskwraith", title: "TaskWraith Activity",
                caption: "all TaskWraith runs", accent: TWTheme.chroma3,
                events: taskWraithEvents),
            .init(
                id: "external", title: "External Activity",
                caption: "external usage", accent: TWTheme.providerAccent("cursor"),
                events: externalEvents),
        ])
        .padding(.top, 18)
    }

    // ── Prominent bottom Start (thumb reach > toolbar corner) ──
    private var startButton: some View {
        Button {
            switch mode {
            case .workspace:
                model.startTask(
                    workspaceId: workspaceId, provider: provider, prompt: prompt,
                    model: modelId)
            case .ensemble:
                model.startEnsemble(
                    workspaceId: workspaceId, prompt: prompt,
                    participants: rosterEdited
                        ? roster.map {
                            RemoteSessionModel.EnsembleDraftParticipant(
                                provider: $0.provider, model: $0.modelId)
                        }
                        : nil)
            case .global:
                model.startGlobalChat(workspaceId: workspaceId)
            }
            dismiss()
        } label: {
            HStack(spacing: 7) {
                Image(systemName: mode == .global ? "plus.circle.fill" : "paperplane.fill")
                Text(startButtonTitle)
                    .font(.body.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(
                startDisabled ? AnyShapeStyle(TWTheme.surface3) : AnyShapeStyle(modeAccent),
                in: Capsule()
            )
            .foregroundStyle(startDisabled ? TWTheme.textMuted : Color.black.opacity(0.85))
        }
        .buttonStyle(.plain)
        .disabled(startDisabled)
        .padding(.top, 4)
    }

    private var composeBlurb: String {
        switch mode {
        case .workspace:
            return
                "Pick \(TWTheme.providerLabel(provider)) and describe the task. The run starts on your Mac and streams back here."
        case .ensemble:
            return
                "Participants take turns on your Mac. Send a prompt to open the first round."
        case .global:
            return
                "Creates a global chat on your Mac. Send your first prompt from the desktop app for now."
        }
    }

    private var promptPlaceholder: String {
        switch mode {
        case .ensemble: return "Ask the ensemble anything…"
        case .global: return "Optional note (edit on Mac to send)"
        default: return "What should the agent do?"
        }
    }

    private var startButtonTitle: String {
        mode == .global ? "Create" : "Start"
    }

    private var startDisabled: Bool {
        if workspaceId.isEmpty { return true }
        if mode == .global { return false }
        return prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// ── Approvals / questions (shared by home + thread detail) ─────────────────────
