import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct RemoteTaskConsoleView: View {
    @Bindable public var viewModel: RemoteTaskConsoleViewModel

    public init(viewModel: RemoteTaskConsoleViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let detail = viewModel.selectedTaskDetail {
                detailScreen(detail)
            } else {
                taskList
            }
        }
    }

    // MARK: - Task list

    private var taskList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                header
                let buckets = viewModel.buckets
                bucketSection(
                    title: "Needs Attention",
                    systemImage: "exclamationmark.bubble.fill",
                    tasks: buckets.needsAttention,
                    tint: Theme.warning
                )
                bucketSection(
                    title: "Active",
                    systemImage: "dot.radiowaves.left.and.right",
                    tasks: buckets.active,
                    tint: Theme.accent
                )
                bucketSection(
                    title: "Recent",
                    systemImage: "clock.arrow.circlepath",
                    tasks: buckets.recent,
                    tint: Theme.secondaryAccent
                )
                if buckets.needsAttention.isEmpty, buckets.active.isEmpty, buckets.recent.isEmpty {
                    emptyState
                }
            }
            .padding(Theme.Spacing.screen)
        }
        .scrollIndicators(.hidden)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Tasks")
                    .font(Theme.Typography.screenTitle)
                    .foregroundStyle(Theme.Text.primary)
                Text("Remote projections from your paired Mac.")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.secondary)
            }
            Spacer()
            let count = viewModel.buckets.needsAttention.count
            if count > 0 {
                Text("\(count)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.warning)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Theme.warning.opacity(0.14), in: Capsule())
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

    private func bucketSection(
        title: String,
        systemImage: String,
        tasks: [RemoteTaskCard],
        tint: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            HStack(spacing: Theme.Spacing.tight) {
                Image(systemName: systemImage)
                    .foregroundStyle(tint)
                Text(title)
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.Text.primary)
                Spacer()
                if !tasks.isEmpty {
                    Text("\(tasks.count)")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.Text.secondary)
                }
            }
            if tasks.isEmpty {
                Text("No tasks")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.tertiary)
                    .padding(.vertical, 6)
            } else {
                ForEach(tasks) { task in
                    taskCard(task)
                }
            }
        }
        .padding(Theme.Spacing.section)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
    }

    private func taskCard(_ task: RemoteTaskCard) -> some View {
        Button {
            withAnimation(Theme.Motion.handoff) {
                viewModel.selectTask(task.id)
            }
        } label: {
            VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
                HStack(alignment: .top, spacing: Theme.Spacing.tight) {
                    Image(systemName: icon(for: task.status))
                        .font(Theme.Typography.caption)
                        .foregroundStyle(tint(for: task.status))
                        .frame(width: 28, height: 28)
                        .background(tint(for: task.status).opacity(0.14), in: Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text(task.displayTitle)
                            .font(Theme.Typography.body)
                            .foregroundStyle(Theme.Text.primary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        HStack(spacing: 6) {
                            Text(task.providerLabel)
                            Text(statusLabel(task.status))
                            if let workspace = task.workspaceDisplayName ?? task.workspaceId {
                                Text(workspace)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        }
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.Text.secondary)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.Text.tertiary)
                }
                if let message = task.lastMessage, !message.isEmpty {
                    Text(message)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Text.secondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                let approvals = viewModel.store.pendingApprovalCount(for: task.id)
                let questions = viewModel.store.pendingQuestionCount(for: task.id)
                if approvals > 0 || questions > 0 || task.capabilities.cancel || task.capabilities.startTurn {
                    HStack(spacing: 6) {
                        if approvals > 0 { countChip("\(approvals) approval", color: Theme.warning) }
                        if questions > 0 { countChip("\(questions) question", color: Theme.secondaryAccent) }
                        if task.capabilities.cancel { countChip("cancel", color: Theme.destructive) }
                        if task.capabilities.startTurn { countChip("prompt", color: Theme.accent) }
                    }
                    .lineLimit(1)
                }
            }
            .padding(Theme.Spacing.control)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(task.displayTitle)
    }

    private func countChip(_ text: String, color: Color) -> some View {
        Text(text)
            .font(Theme.Typography.smallCaption)
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.12), in: Capsule())
    }

    private var emptyState: some View {
        VStack(spacing: Theme.Spacing.control) {
            Image(systemName: "rectangle.stack.badge.person.crop")
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.accent)
            Text("No remote tasks yet")
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Text.primary)
            Text("Task cards appear when the Mac emits remote projections.")
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Text.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Detail

    private func detailScreen(_ detail: RemoteTaskDetail) -> some View {
        VStack(spacing: 0) {
            detailHeader(detail)
                .padding(.horizontal, Theme.Spacing.screen)
                .padding(.top, Theme.Spacing.screen)
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                    transcriptPreview(detail)
                    approvalsPreview(detail)
                    questionsPreview(detail)
                    diffPreview(detail)
                    ensemblePreview(detail)
                    if let state = detail.actionState?.message {
                        statusBanner(state, color: actionStateTint(detail.actionState))
                    }
                }
                .padding(Theme.Spacing.screen)
            }
            .scrollIndicators(.hidden)
            stickyActions(detail)
                .padding(Theme.Spacing.screen)
                .background(Theme.chromeBlur)
        }
    }

    private func detailHeader(_ detail: RemoteTaskDetail) -> some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            Button {
                withAnimation(Theme.Motion.handoff) {
                    viewModel.selectTask(nil)
                }
            } label: {
                Label("Back", systemImage: "chevron.left")
                    .labelStyle(.iconOnly)
            }
            .buttonStyle(.bordered)
            VStack(alignment: .leading, spacing: 3) {
                Text(detail.task.displayTitle)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Text.primary)
                    .lineLimit(2)
                Text("\(detail.task.providerLabel) · \(statusLabel(detail.task.status))")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.secondary)
            }
            Spacer()
        }
        .padding(Theme.Spacing.section)
        .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
    }

    private func transcriptPreview(_ detail: RemoteTaskDetail) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            Label("Transcript", systemImage: "text.bubble")
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.Text.primary)
            let rows = Array((detail.threadSnapshot?.rows ?? []).suffix(5))
            if rows.isEmpty {
                Text(detail.task.lastMessage ?? "No transcript projection yet.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Text.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(rows) { row in
                    HStack(alignment: .top, spacing: Theme.Spacing.tight) {
                        Text(row.role)
                            .font(Theme.Typography.smallCaption)
                            .foregroundStyle(tint(for: row.kind))
                            .frame(width: 70, alignment: .leading)
                        Text(row.preview.isEmpty ? "…" : row.preview)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Text.secondary)
                            .lineLimit(3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .modifier(DetailCardModifier())
    }

    @ViewBuilder
    private func approvalsPreview(_ detail: RemoteTaskDetail) -> some View {
        if !detail.approvals.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.control) {
                Label("Approvals", systemImage: "checkmark.shield")
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.Text.primary)
                ForEach(detail.approvals) { approval in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(approval.title)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Text.primary)
                        if let body = approval.body ?? approval.summary, !body.isEmpty {
                            Text(body)
                                .font(Theme.Typography.smallCaption)
                                .foregroundStyle(Theme.Text.secondary)
                                .lineLimit(3)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Theme.Spacing.tight)
                    .background(Theme.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous))
                }
            }
            .modifier(DetailCardModifier())
        }
    }

    @ViewBuilder
    private func questionsPreview(_ detail: RemoteTaskDetail) -> some View {
        if !detail.questions.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.control) {
                Label("Questions", systemImage: "questionmark.bubble")
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.Text.primary)
                ForEach(detail.questions) { question in
                    Text(question.prompt)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Text.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .modifier(DetailCardModifier())
        }
    }

    @ViewBuilder
    private func diffPreview(_ detail: RemoteTaskDetail) -> some View {
        if let diff = detail.diffSummary, detail.task.capabilities.diffReview || !diff.files.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.control) {
                Label("Diff", systemImage: "doc.text.magnifyingglass")
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.Text.primary)
                HStack(spacing: Theme.Spacing.tight) {
                    countChip("\(diff.filesChanged) files", color: Theme.accent)
                    countChip("+\(diff.additions)", color: Theme.success)
                    countChip("-\(diff.deletions)", color: Theme.destructive)
                    if diff.truncated { countChip("clamped", color: Theme.warning) }
                }
                ForEach(diff.files.prefix(6)) { file in
                    Text(file.path)
                        .font(Theme.Typography.code)
                        .foregroundStyle(Theme.Text.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .modifier(DetailCardModifier())
        }
    }

    @ViewBuilder
    private func ensemblePreview(_ detail: RemoteTaskDetail) -> some View {
        if let ensemble = detail.ensemble {
            VStack(alignment: .leading, spacing: Theme.Spacing.control) {
                Label("Ensemble", systemImage: "person.3.sequence")
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.Text.primary)
                if let roundStatus = ensemble.roundStatus ?? ensemble.status {
                    Text(roundStatus)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Text.secondary)
                }
                ForEach(ensemble.participants.prefix(6)) { participant in
                    HStack {
                        Circle()
                            .fill(participant.isActive ? Theme.success : Theme.Text.tertiary)
                            .frame(width: 8, height: 8)
                        Text(participant.role ?? participant.provider ?? participant.id)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Text.primary)
                        Spacer()
                        if let status = participant.status {
                            Text(status)
                                .font(Theme.Typography.smallCaption)
                                .foregroundStyle(Theme.Text.secondary)
                        }
                    }
                }
            }
            .modifier(DetailCardModifier())
        }
    }

    private func stickyActions(_ detail: RemoteTaskDetail) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            if let approval = detail.approvals.first, detail.task.capabilities.approve {
                HStack(spacing: Theme.Spacing.tight) {
                    Button {
                        Task { await viewModel.respond(to: approval, decision: .accept) }
                    } label: {
                        Label("Approve", systemImage: "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    Button(role: .destructive) {
                        Task { await viewModel.respond(to: approval, decision: .decline) }
                    } label: {
                        Label("Decline", systemImage: "xmark")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
            if let question = detail.questions.first, detail.task.capabilities.answer {
                if !question.options.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Theme.Spacing.tight) {
                            ForEach(question.options) { option in
                                Button(option.label) {
                                    Task { await viewModel.answer(question, answer: option.value) }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                }
                HStack(spacing: Theme.Spacing.tight) {
                    TextField("Answer question", text: $viewModel.questionAnswerDraft, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(Theme.Typography.callout)
                        .padding(Theme.Spacing.control)
                        .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                    Button {
                        Task { await viewModel.answer(question, answer: viewModel.questionAnswerDraft) }
                    } label: {
                        Image(systemName: "paperplane.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    Button(role: .destructive) {
                        Task { await viewModel.reject(question) }
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.bordered)
                }
            }
            HStack(spacing: Theme.Spacing.tight) {
                if detail.task.capabilities.cancel, detail.task.runId?.isEmpty == false {
                    Button(role: .destructive) {
                        Task { await viewModel.cancel(detail.task) }
                    } label: {
                        Label("Cancel", systemImage: "stop.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                if detail.task.capabilities.startTurn {
                    TextField("Prompt", text: $viewModel.promptDraft, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(Theme.Typography.callout)
                        .padding(Theme.Spacing.control)
                        .background(Theme.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                    Button {
                        Task { await viewModel.sendPrompt(detail.task, text: viewModel.promptDraft) }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    private func statusBanner(_ text: String, color: Color) -> some View {
        Text(text)
            .font(Theme.Typography.caption)
            .foregroundStyle(Theme.Text.secondary)
            .padding(Theme.Spacing.control)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
    }

    private func statusLabel(_ status: RemoteTaskStatus) -> String {
        switch status {
        case .idle: return "idle"
        case .queued: return "queued"
        case .running: return "running"
        case .awaitingApproval: return "approval"
        case .waiting: return "waiting"
        case .completed: return "done"
        case .failed: return "failed"
        case .cancelled: return "cancelled"
        case .sleeping: return "sleeping"
        case .unknown: return "status unknown"
        }
    }

    private func icon(for status: RemoteTaskStatus) -> String {
        switch status {
        case .queued: return "clock"
        case .running: return "play.circle.fill"
        case .awaitingApproval: return "pause.circle.fill"
        case .waiting: return "questionmark.circle.fill"
        case .completed: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .cancelled: return "stop.circle.fill"
        case .sleeping: return "moon.zzz.fill"
        case .idle, .unknown: return "circle"
        }
    }

    private func tint(for status: RemoteTaskStatus) -> Color {
        switch status {
        case .awaitingApproval, .waiting: return Theme.warning
        case .running, .queued: return Theme.accent
        case .completed: return Theme.success
        case .failed, .cancelled: return Theme.destructive
        case .sleeping: return Theme.secondaryAccent
        case .idle, .unknown: return Theme.Text.secondary
        }
    }

    private func tint(for kind: RemoteThreadRowKind) -> Color {
        switch kind {
        case .user: return Theme.accent
        case .assistant: return Theme.success
        case .tool: return Theme.secondaryAccent
        case .attention: return Theme.warning
        case .error: return Theme.destructive
        case .runBoundary, .system, .summary, .unknown: return Theme.Text.secondary
        }
    }

    private func actionStateTint(_ state: RemoteTaskActionState?) -> Color {
        guard let state else { return Theme.Text.secondary }
        switch state {
        case .acknowledged: return Theme.success
        case .failed, .stale: return Theme.destructive
        case .sending: return Theme.accent
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct DetailCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(Theme.Spacing.section)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.cardBlur, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                    .stroke(Theme.border, lineWidth: 1)
            )
    }
}

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
#Preview("Remote Task Console") {
    let store = RemoteTaskStore()
    let now = Date()
    store.apply(RemoteProjectionEnvelope(
        kind: .task,
        publishedAt: now,
        payload: .task(RemoteTaskCard(
            id: "task-1",
            workspaceId: "ws-1",
            workspaceDisplayName: "GUIGemini",
            threadId: "chat-1",
            threadTitle: "Fix iPhone approvals",
            runId: "run-1",
            provider: "codex",
            status: .awaitingApproval,
            attentionReason: "Shell command needs approval",
            lastMessage: "Tests are ready to run.",
            pendingApprovalCount: 1,
            updatedAt: now,
            capabilities: RemoteTaskCapabilities(approve: true, cancel: true, startTurn: true)
        ))
    ))
    store.apply(RemoteProjectionEnvelope(
        kind: .approval,
        taskId: "task-1",
        publishedAt: now,
        payload: .approval(MobileApprovalCard(
            id: "approval-1",
            taskId: "task-1",
            workspaceId: "ws-1",
            threadId: "chat-1",
            runId: "run-1",
            provider: "codex",
            actionKind: "command",
            title: "Run tests",
            summary: "swift test",
            offeredActions: ["accept", "decline"],
            expiresAt: now.addingTimeInterval(300)
        ))
    ))
    store.apply(RemoteProjectionEnvelope(
        kind: .task,
        publishedAt: now.addingTimeInterval(-120),
        payload: .task(RemoteTaskCard(
            id: "task-2",
            workspaceId: "ws-1",
            threadId: "chat-2",
            threadTitle: "Review diff",
            runId: "run-2",
            provider: "gemini",
            status: .running,
            lastMessage: "Scanning changed files.",
            updatedAt: now.addingTimeInterval(-120),
            capabilities: RemoteTaskCapabilities(cancel: true, startTurn: true, diffReview: true)
        ))
    ))
    return RemoteTaskConsoleView(viewModel: RemoteTaskConsoleViewModel(store: store))
}
#endif
