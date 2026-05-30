import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct RemoteTaskConsoleView: View {
    @Bindable public var viewModel: RemoteTaskConsoleViewModel
    public let statusMessage: String?
    public let onRefresh: (() -> Void)?
    @Environment(\.companionThemePalette) private var palette

    public init(
        viewModel: RemoteTaskConsoleViewModel,
        statusMessage: String? = nil,
        onRefresh: (() -> Void)? = nil
    ) {
        self.viewModel = viewModel
        self.statusMessage = statusMessage
        self.onRefresh = onRefresh
    }

    public var body: some View {
        ZStack {
            palette.background.ignoresSafeArea()
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
                if let statusMessage = normalizedStatusMessage {
                    statusBanner(statusMessage, color: palette.accent)
                }
                let buckets = viewModel.buckets
                if hasTasks(buckets) {
                    focusStrip(buckets)
                }
                bucketSection(
                    title: "Needs Attention",
                    systemImage: "exclamationmark.bubble.fill",
                    tasks: buckets.needsAttention,
                    tint: palette.warning
                )
                bucketSection(
                    title: "Active",
                    systemImage: "dot.radiowaves.left.and.right",
                    tasks: buckets.active,
                    tint: palette.accent
                )
                bucketSection(
                    title: "Recent",
                    systemImage: "clock.arrow.circlepath",
                    tasks: buckets.recent,
                    tint: palette.secondaryAccent
                )
                if buckets.needsAttention.isEmpty, buckets.active.isEmpty, buckets.recent.isEmpty {
                    emptyState
                }
            }
            .padding(Theme.Spacing.screen)
        }
        .scrollIndicators(.hidden)
    }

    private func hasTasks(_ buckets: RemoteTaskBuckets) -> Bool {
        !buckets.needsAttention.isEmpty || !buckets.active.isEmpty || !buckets.recent.isEmpty
    }

    private var header: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.control) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Tasks")
                    .font(Theme.Typography.screenTitle)
                    .foregroundStyle(Theme.Text.primary)
                Text(headerSubtitle)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.secondary)
            }
            Spacer()
            if let onRefresh {
                Button(action: onRefresh) {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Refresh remote task state")
            }
            let count = viewModel.buckets.needsAttention.count
            if count > 0 {
                Text("\(count)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(palette.warning)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(palette.warning.opacity(0.14), in: Capsule())
            }
        }
        .padding(Theme.Spacing.section)
        .companionCardBackground(cornerRadius: Theme.Radius.panel)
    }

    private var headerSubtitle: String {
        let buckets = viewModel.buckets
        if buckets.needsAttention.count == 1 {
            return "1 item needs attention"
        }
        if buckets.needsAttention.count > 1 {
            return "\(buckets.needsAttention.count) items need attention"
        }
        if buckets.active.count == 1 {
            return "1 active remote run"
        }
        if buckets.active.count > 1 {
            return "\(buckets.active.count) active remote runs"
        }
        return "Remote state from your paired Mac"
    }

    private var normalizedStatusMessage: String? {
        let trimmed = statusMessage?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private func focusStrip(_ buckets: RemoteTaskBuckets) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            HStack(spacing: Theme.Spacing.tight) {
                focusMetric(
                    value: buckets.needsAttention.count,
                    label: "attention",
                    systemImage: "exclamationmark.bubble.fill",
                    tint: palette.warning
                )
                focusMetric(
                    value: buckets.active.count,
                    label: "active",
                    systemImage: "dot.radiowaves.left.and.right",
                    tint: palette.accent
                )
                focusMetric(
                    value: buckets.recent.count,
                    label: "recent",
                    systemImage: "clock.arrow.circlepath",
                    tint: palette.secondaryAccent
                )
            }
            if let task = buckets.needsAttention.first ?? buckets.active.first {
                priorityTaskButton(task)
            }
        }
        .padding(Theme.Spacing.section)
        .companionCardBackground(cornerRadius: Theme.Radius.panel)
    }

    private func focusMetric(
        value: Int,
        label: String,
        systemImage: String,
        tint: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: systemImage)
                    .font(Theme.Typography.smallCaption)
                Text("\(value)")
                    .font(Theme.Typography.sectionTitle)
                    .monospacedDigit()
            }
            .foregroundStyle(tint)
            Text(label)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.Text.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
    }

    private func priorityTaskButton(_ task: RemoteTaskCard) -> some View {
        Button {
            withAnimation(Theme.Motion.handoff) {
                viewModel.selectTask(task.id)
            }
        } label: {
            HStack(alignment: .center, spacing: Theme.Spacing.tight) {
                Image(systemName: icon(for: task.status))
                    .font(Theme.Typography.caption)
                    .foregroundStyle(tint(for: task.status))
                    .frame(width: 30, height: 30)
                    .background(tint(for: task.status).opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(priorityLabel(for: task))
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(tint(for: task.status))
                    Text(task.displayTitle)
                        .font(Theme.Typography.callout)
                        .foregroundStyle(Theme.Text.primary)
                        .lineLimit(1)
                }
                Spacer(minLength: Theme.Spacing.tight)
                Image(systemName: "chevron.right")
                    .font(Theme.Typography.smallCaption)
                    .foregroundStyle(Theme.Text.tertiary)
            }
            .padding(Theme.Spacing.control)
            .background(palette.inputSurface, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open \(task.displayTitle)")
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
        .companionCardBackground(cornerRadius: Theme.Radius.panel)
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
                if let reason = task.attentionReason, !reason.isEmpty {
                    attentionReason(reason)
                }
                let approvals = viewModel.store.pendingApprovalCount(for: task.id)
                let questions = viewModel.store.pendingQuestionCount(for: task.id)
                if approvals > 0 || questions > 0 || task.capabilities.cancel || task.capabilities.startTurn {
                    HStack(spacing: 6) {
                        if approvals > 0 { countChip("\(approvals) approval", color: palette.warning) }
                        if questions > 0 { countChip("\(questions) question", color: palette.secondaryAccent) }
                        if task.capabilities.cancel { countChip("cancel", color: palette.destructive) }
                        if task.capabilities.startTurn { countChip("prompt", color: palette.accent) }
                    }
                    .lineLimit(1)
                }
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(Theme.Typography.smallCaption)
                    Text(task.updatedAt, style: .relative)
                        .monospacedDigit()
                    if let runId = task.runId, !runId.isEmpty {
                        Text(runId)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.Text.tertiary)
            }
            .padding(Theme.Spacing.control)
            .frame(maxWidth: .infinity, alignment: .leading)
            .companionInputBackground(cornerRadius: Theme.Radius.control)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(task.displayTitle)
    }

    private func attentionReason(_ reason: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(palette.warning)
            Text(reason)
                .font(Theme.Typography.smallCaption)
                .foregroundStyle(Theme.Text.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(palette.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous))
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
                .foregroundStyle(palette.accent)
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
                    taskContext(detail)
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
            .accessibilityLabel("Back to task list")
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
        .companionCardBackground(cornerRadius: Theme.Radius.panel)
    }

    private func taskContext(_ detail: RemoteTaskDetail) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.control) {
            HStack(spacing: Theme.Spacing.tight) {
                countChip(statusLabel(detail.task.status), color: tint(for: detail.task.status))
                countChip(detail.task.providerLabel, color: palette.accent)
                if let workspace = detail.task.workspaceDisplayName ?? detail.task.workspaceId,
                   !workspace.isEmpty {
                    countChip(workspace, color: palette.secondaryAccent)
                }
            }
            .lineLimit(1)
            if let reason = detail.task.attentionReason, !reason.isEmpty {
                attentionReason(reason)
            }
        }
        .modifier(DetailCardModifier())
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
                    .background(palette.warning.opacity(0.10), in: RoundedRectangle(cornerRadius: Theme.Radius.small, style: .continuous))
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
                    countChip("\(diff.filesChanged) files", color: palette.accent)
                    countChip("+\(diff.additions)", color: palette.success)
                    countChip("-\(diff.deletions)", color: palette.destructive)
                    if diff.truncated { countChip("clamped", color: palette.warning) }
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
                            .fill(participant.isActive ? palette.success : Theme.Text.tertiary)
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
            HStack(spacing: Theme.Spacing.tight) {
                Image(systemName: stickyActionIcon(detail))
                    .foregroundStyle(stickyActionTint(detail))
                Text(stickyActionTitle(detail))
                    .font(Theme.Typography.sectionTitle)
                    .foregroundStyle(Theme.Text.primary)
                Spacer(minLength: Theme.Spacing.tight)
                if let state = detail.actionState {
                    actionStateChip(state)
                }
            }
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
            if !hasStickyActions(detail) {
                Text("No actions available")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Text.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
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
                        .companionInputBackground(cornerRadius: Theme.Radius.control)
                    Button {
                        Task { await viewModel.answer(question, answer: viewModel.questionAnswerDraft) }
                    } label: {
                        Image(systemName: "paperplane.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel("Submit answer")
                    Button(role: .destructive) {
                        Task { await viewModel.reject(question) }
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.bordered)
                    .accessibilityLabel("Reject question")
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
                        .companionInputBackground(cornerRadius: Theme.Radius.control)
                    Button {
                        Task { await viewModel.sendPrompt(detail.task, text: viewModel.promptDraft) }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel("Send prompt")
                }
            }
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.cardFill, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                .stroke(palette.cardStroke, lineWidth: 1)
        )
    }

    private func hasStickyActions(_ detail: RemoteTaskDetail) -> Bool {
        (detail.approvals.first != nil && detail.task.capabilities.approve)
            || (detail.questions.first != nil && detail.task.capabilities.answer)
            || (detail.task.capabilities.cancel && detail.task.runId?.isEmpty == false)
            || detail.task.capabilities.startTurn
    }

    private func stickyActionTitle(_ detail: RemoteTaskDetail) -> String {
        if detail.approvals.first != nil, detail.task.capabilities.approve {
            return "Approval needed"
        }
        if detail.questions.first != nil, detail.task.capabilities.answer {
            return "Question waiting"
        }
        if detail.task.capabilities.cancel || detail.task.capabilities.startTurn {
            return "Controls"
        }
        return "Task state"
    }

    private func stickyActionIcon(_ detail: RemoteTaskDetail) -> String {
        if detail.approvals.first != nil, detail.task.capabilities.approve {
            return "checkmark.shield.fill"
        }
        if detail.questions.first != nil, detail.task.capabilities.answer {
            return "questionmark.bubble.fill"
        }
        if detail.task.capabilities.cancel || detail.task.capabilities.startTurn {
            return "slider.horizontal.3"
        }
        return "info.circle"
    }

    private func stickyActionTint(_ detail: RemoteTaskDetail) -> Color {
        if detail.approvals.first != nil, detail.task.capabilities.approve {
            return palette.warning
        }
        if detail.questions.first != nil, detail.task.capabilities.answer {
            return palette.secondaryAccent
        }
        if detail.task.capabilities.cancel || detail.task.capabilities.startTurn {
            return palette.accent
        }
        return Theme.Text.tertiary
    }

    private func actionStateChip(_ state: RemoteTaskActionState) -> some View {
        HStack(spacing: 4) {
            Image(systemName: actionStateIcon(state))
            Text(actionStateLabel(state))
        }
        .font(Theme.Typography.smallCaption)
        .foregroundStyle(actionStateTint(state))
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(actionStateTint(state).opacity(0.12), in: Capsule())
    }

    private func actionStateIcon(_ state: RemoteTaskActionState) -> String {
        switch state {
        case .sending:
            return "paperplane"
        case .acknowledged:
            return "checkmark.circle.fill"
        case .failed:
            return "exclamationmark.triangle.fill"
        case .stale:
            return "clock.badge.exclamationmark"
        }
    }

    private func actionStateLabel(_ state: RemoteTaskActionState) -> String {
        switch state {
        case .sending:
            return "sending"
        case .acknowledged:
            return "sent"
        case .failed:
            return "failed"
        case .stale:
            return "stale"
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

    private func priorityLabel(for task: RemoteTaskCard) -> String {
        if viewModel.store.pendingApprovalCount(for: task.id) > 0 {
            return "Approval needed"
        }
        if viewModel.store.pendingQuestionCount(for: task.id) > 0 {
            return "Question waiting"
        }
        if task.status.isActive {
            return statusLabel(task.status)
        }
        return "Recent"
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
        case .awaitingApproval, .waiting: return palette.warning
        case .running, .queued: return palette.accent
        case .completed: return palette.success
        case .failed, .cancelled: return palette.destructive
        case .sleeping: return palette.secondaryAccent
        case .idle, .unknown: return Theme.Text.secondary
        }
    }

    private func tint(for kind: RemoteThreadRowKind) -> Color {
        switch kind {
        case .user: return palette.accent
        case .assistant: return palette.success
        case .tool: return palette.secondaryAccent
        case .attention: return palette.warning
        case .error: return palette.destructive
        case .runBoundary, .system, .summary, .unknown: return Theme.Text.secondary
        }
    }

    private func actionStateTint(_ state: RemoteTaskActionState?) -> Color {
        guard let state else { return Theme.Text.secondary }
        switch state {
        case .acknowledged: return palette.success
        case .failed, .stale: return palette.destructive
        case .sending: return palette.accent
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct DetailCardModifier: ViewModifier {
    @Environment(\.companionThemePalette) private var palette

    func body(content: Content) -> some View {
        content
            .padding(Theme.Spacing.section)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.cardFill, in: RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.panel, style: .continuous)
                    .stroke(palette.cardStroke, lineWidth: 1)
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
