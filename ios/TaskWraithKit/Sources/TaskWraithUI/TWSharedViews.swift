// Reusable chrome — ghost masthead, sidebar pill headers, rim highlights,
// and the hierarchical provider → model picker tree.

import SwiftUI
import TaskWraithKit

#if canImport(UIKit)
import UIKit
#endif

/// Loads `ghost-mark.png` from the SwiftPM resource bundle, falling back to
/// the host app's asset catalog (Xcode embeds TaskWraithUI resources
/// separately — `Image("ghost-mark", bundle: .module)` alone can miss).
public struct GhostMarkView: View {
    public var size: CGFloat = 34

    public init(size: CGFloat = 34) { self.size = size }

    public var body: some View {
        Group {
            if let image = Self.loadImage() {
                image
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: "sparkles")
                    .font(.system(size: size * 0.55, weight: .semibold))
                    .foregroundStyle(TWTheme.chroma3)
            }
        }
        .frame(width: size, height: size)
    }

    private static func loadImage() -> Image? {
        #if canImport(UIKit)
        if let url = Bundle.module.url(forResource: "ghost-mark", withExtension: "png"),
            let data = try? Data(contentsOf: url),
            let ui = UIImage(data: data)
        {
            return Image(uiImage: ui)
        }
        if let ui = UIImage(named: "ghost-mark") {
            return Image(uiImage: ui)
        }
        #endif
        return nil
    }
}

/// Desktop sidebar section header — all-caps label in a subtle pill.
struct PillSectionHeader: View {
    let title: String
    var systemImage: String? = nil
    var trailing: String? = nil

    var body: some View {
        HStack(spacing: 6) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.caption2)
            }
            // Inline flat header — SF Pro, sentence case (the capsule
            // container + ALL-CAPS treatment read as chrome, not structure).
            Text(title)
                .font(.subheadline.weight(.semibold))
            Spacer(minLength: 4)
            if let trailing {
                Text(trailing)
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(TWTheme.surface3, in: Capsule())
                    .foregroundStyle(TWTheme.textTertiary)
            }
        }
        .foregroundStyle(TWTheme.textSecondary)
        .padding(.vertical, 4)
    }
}

/// Inset rim ring — mirrors the desktop sidebar / composer rim-highlight idiom.
struct RimHighlight: ViewModifier {
    var accent: Color? = nil

    func body(content: Content) -> some View {
        content
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(
                        (accent ?? TWTheme.textPrimary).opacity(0.14),
                        lineWidth: 1)
            )
            .shadow(
                color: (accent ?? TWTheme.textPrimary).opacity(0.06),
                radius: 8, x: 0, y: 0)
    }
}

extension View {
    func rimHighlight(accent: Color? = nil) -> some View {
        modifier(RimHighlight(accent: accent))
    }
}

// ── Composer shell glass (thread dock) ─────────────────────────────────────
// One shared frost layer behind the three-decker shell (diff header + composer
// + telemetry). Inner rows stay clear so transcript scrolls through as a
// single blurred panel. Falls back to opaque surfaces when Reduce Transparency
// is enabled.

private struct ComposerShellGlassModifier: ViewModifier {
    var cornerRadius: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .background {
                let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                if TWTheme.composerGlassEnabled {
                    ZStack {
                        shape.fill(.ultraThinMaterial)
                        shape.fill(TWTheme.surface1.opacity(TWTheme.composerGlassTintOpacity))
                    }
                } else {
                    shape.fill(TWTheme.surface2)
                }
            }
            .overlay(alignment: .top) {
                if TWTheme.composerGlassEnabled {
                    LinearGradient(
                        colors: [
                            TWTheme.appBg.opacity(0),
                            TWTheme.appBg.opacity(0.42),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 18)
                    .offset(y: -18)
                    .allowsHitTesting(false)
                }
            }
    }
}

extension View {
    /// Frosted glass behind the bordered composer shell; minimal layout impact.
    func composerShellGlass(cornerRadius: CGFloat = 16) -> some View {
        modifier(ComposerShellGlassModifier(cornerRadius: cornerRadius))
    }
}

/// Hierarchical provider → model menu for phone-sized composer surfaces.
struct ProviderModelPicker: View {
    let catalogs: [ProviderModelCatalog]
    @Binding var provider: String
    @Binding var modelId: String?

    private var currentCatalog: ProviderModelCatalog? {
        catalogs.first { $0.provider.lowercased() == provider.lowercased() }
    }

    var body: some View {
        Menu {
            ForEach(catalogs) { catalog in
                if catalog.models.isEmpty {
                    // No catalog yet (e.g. picker opened before the Mac's
                    // async model broadcast lands) — provider is still
                    // directly selectable; model rides the CLI default.
                    Button {
                        provider = catalog.provider
                        modelId = nil
                    } label: {
                        Label(
                            TWTheme.providerLabel(catalog.provider),
                            systemImage: "cpu")
                    }
                } else {
                    Menu {
                        Button {
                            provider = catalog.provider
                            modelId = nil
                        } label: {
                            Text("CLI Default")
                        }
                        ForEach(catalog.models) { model in
                            Button {
                                provider = catalog.provider
                                modelId = model.id
                            } label: {
                                HStack {
                                    Text(model.label ?? model.id)
                                    if model.isDefault == true {
                                        Text("default").font(.caption2)
                                    }
                                }
                            }
                        }
                    } label: {
                        Label(
                            TWTheme.providerLabel(catalog.provider),
                            systemImage: "cpu")
                    }
                }
            }
        } label: {
            // Flat text labels (desktop composer parity) — the whole run of
            // text is the tap target; no pill chrome.
            HStack(spacing: 6) {
                Circle()
                    .fill(TWTheme.providerAccent(provider))
                    .frame(width: 7, height: 7)
                Text(TWTheme.providerLabel(provider))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TWTheme.providerAccent(provider))
                Text(modelId.map(shortModelLabel) ?? "Default")
                    .font(.caption)
                    .foregroundStyle(TWTheme.textPrimary)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(TWTheme.textMuted)
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .onChange(of: provider) { _, newProvider in
            // Switching provider invalidates a model from the OLD catalog —
            // reset to nil (= inherit on existing chats / provider default
            // on new ones, resolved Mac-side). Never force-pick a default:
            // that stamped the catalog default over the chat's real model
            // before the snapshot could land.
            guard modelId != nil else { return }
            let catalog = catalogs.first {
                $0.provider.lowercased() == newProvider.lowercased()
            }
            if catalog == nil || !(catalog!.models.contains { $0.id == modelId }) {
                modelId = nil
            }
        }
    }

    private func shortModelLabel(_ id: String) -> String {
        if let catalog = currentCatalog,
            let match = catalog.models.first(where: { $0.id == id })
        {
            return match.label ?? id
        }
        if id.count > 22 { return String(id.prefix(20)) + "…" }
        return id
    }
}

/// Wrapping chip row — adaptive grid so provider/participant chips flow to
/// the next line instead of clipping on narrow screens.
public struct FlowChips<Item: Hashable, ChipView: View>: View {
    let items: [Item]
    let chip: (Item) -> ChipView

    public init(items: [Item], @ViewBuilder chip: @escaping (Item) -> ChipView) {
        self.items = items
        self.chip = chip
    }

    public var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 86), spacing: 6, alignment: .leading)],
            alignment: .leading, spacing: 6
        ) {
            ForEach(items, id: \.self) { item in
                chip(item)
            }
        }
    }
}

/// Compact workspace-activity heatmap — the phone rendition of the desktop
/// welcome screen's hour×day grid. Cells bucket the supplied timestamps
/// into 4-hour rows × recent-day columns; intensity follows count.
public struct ActivityHeatmap: View {
    let dates: [Date]
    let accent: Color
    let days: Int

    public init(dates: [Date], accent: Color, days: Int = 21) {
        self.dates = dates
        self.accent = accent
        self.days = days
    }

    private var counts: [[Int]] {
        // rows: 6 × 4-hour buckets, columns: `days` ending today.
        var grid = Array(repeating: Array(repeating: 0, count: days), count: 6)
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        for date in dates {
            let day = calendar.startOfDay(for: date)
            guard
                let offset = calendar.dateComponents([.day], from: day, to: today).day,
                offset >= 0, offset < days
            else { continue }
            let hour = calendar.component(.hour, from: date)
            grid[min(5, hour / 4)][days - 1 - offset] += 1
        }
        return grid
    }

    public var body: some View {
        let grid = counts
        // 1:1 cells (the stretched look came from maxWidth: .infinity):
        // size cells square off the available width, shrink rather than
        // stretch, and center the grid.
        GeometryReader { geo in
            let cell = min(9, max(4, (geo.size.width - CGFloat(days - 1) * 2) / CGFloat(days)))
            let gridWidth = cell * CGFloat(days) + CGFloat(days - 1) * 2
            VStack(alignment: .leading, spacing: 2) {
                ForEach(0..<6, id: \.self) { row in
                    HStack(spacing: 2) {
                        ForEach(0..<days, id: \.self) { col in
                            RoundedRectangle(cornerRadius: 1.5)
                                .fill(cellColor(grid[row][col]))
                                .frame(width: cell, height: cell)
                        }
                    }
                }
            }
            .frame(width: gridWidth)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .frame(height: 6 * 9 + 5 * 2)
    }

    private func cellColor(_ count: Int) -> Color {
        switch count {
        case 0: return TWTheme.surface2
        case 1: return accent.opacity(0.35)
        case 2...3: return accent.opacity(0.6)
        default: return accent.opacity(0.95)
        }
    }
}

/// Lenient ISO8601 parse for projection timestamps (with/without millis).
public func twParseISODate(_ value: String?) -> Date? {
    guard let value, !value.isEmpty else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) { return date }
    let plain = ISO8601DateFormatter()
    return plain.date(from: value)
}

/// Transcript typography — Avenir Next for message bodies (system-bundled
/// on iOS + macOS, scales with Dynamic Type via relativeTo).
public enum TWFont {
    public static func transcript(
        _ size: CGFloat = 16, weight: Font.Weight = .regular,
        relativeTo style: Font.TextStyle = .callout
    ) -> Font {
        let name: String
        switch weight {
        case .bold: name = "AvenirNext-Bold"
        case .semibold: name = "AvenirNext-DemiBold"
        case .medium: name = "AvenirNext-Medium"
        default: name = "AvenirNext-Regular"
        }
        return .custom(name, size: size, relativeTo: style)
    }
}

/// ChatGPT-grade token flow: decouples REVEAL from ARRIVAL. Network chunks
/// land in bursts (relay cadence), so revealing them directly reads as
/// text slamming in. This view keeps a revealed-length cursor that catches
/// up to the target at a smooth adaptive rate (~30fps, faster when the
/// backlog grows so it never lags a quick model), and renders the newest
/// revealed characters through an alpha ramp — tokens fade in at the tail
/// and solidify as they age out of it.
public struct TokenRevealText: View {
    let target: String
    let font: Font
    let color: Color

    @State private var revealed = 0
    /// Trails `revealed`: characters between the two are the fade tail.
    /// The pump advances it during idle ticks, so the shimmer SOLIDIFIES
    /// ~150ms after token flow pauses instead of freezing half-faded on a
    /// slow network — and re-opens when the stream resumes.
    @State private var solidified = 0
    @State private var pump: Task<Void, Never>? = nil
    /// Live mirror of `target` — the pump task captures the view STRUCT by
    /// value, so a plain `let` would go stale as the stream grows; @State
    /// reads route through SwiftUI's storage and stay current.
    @State private var goal = ""

    public init(target: String, font: Font, color: Color) {
        self.target = target
        self.font = font
        self.color = color
    }

    private static let tailBands: [(length: Int, opacity: Double)] = [
        (8, 0.30), (8, 0.55), (10, 0.78)
    ]

    public var body: some View {
        composedText
            .font(font)
            .fixedSize(horizontal: false, vertical: true)
            .onAppear {
                goal = target
                startPumpIfNeeded()
            }
            .onChange(of: target) { _, newValue in
                // Run reset / shrink → snap; growth → pump catches up.
                goal = newValue
                if revealed > newValue.count { revealed = newValue.count }
                if solidified > revealed { solidified = revealed }
                startPumpIfNeeded()
            }
            .onDisappear {
                pump?.cancel()
                pump = nil
            }
    }

    private var composedText: Text {
        let shown = String(goal.prefix(revealed))
        guard !shown.isEmpty else { return Text("") }
        // Fade bands cover ONLY the not-yet-solidified tail (text that just
        // arrived); once the pump's settle phase catches `solidified` up to
        // `revealed`, everything renders solid.
        var tailBudget = max(0, revealed - solidified)
        var bands: [(text: String, opacity: Double)] = []
        var remaining = Substring(shown)
        for band in Self.tailBands.reversed() where !remaining.isEmpty && tailBudget > 0 {
            let take = min(band.length, remaining.count, tailBudget)
            bands.append((String(remaining.suffix(take)), band.opacity))
            remaining = remaining.dropLast(take)
            tailBudget -= take
        }
        var result = Text(String(remaining)).foregroundColor(color)
        for band in bands.reversed() {
            result = result + Text(band.text).foregroundColor(color.opacity(band.opacity))
        }
        return result
    }

    private func startPumpIfNeeded() {
        guard pump == nil, revealed < goal.count || solidified < revealed else { return }
        pump = Task { @MainActor in
            while !Task.isCancelled {
                let backlog = goal.count - revealed
                if backlog > 0 {
                    // Reveal phase: ~2 chars/tick when nearly caught up,
                    // geometric catch-up so we never trail a fast model.
                    revealed += max(2, backlog / 8)
                    if revealed > goal.count { revealed = goal.count }
                    // Keep the fade tail bounded while tokens flow.
                    let maxTail = Self.tailBands.reduce(0) { $0 + $1.length }
                    if solidified < revealed - maxTail { solidified = revealed - maxTail }
                } else if solidified < revealed {
                    // Settle phase: no new tokens — melt the tail to solid
                    // over a few ticks instead of freezing half-faded.
                    solidified = min(revealed, solidified + 6)
                } else {
                    break
                }
                try? await Task.sleep(nanoseconds: 33_000_000)
            }
            pump = nil
            // Goal may have grown while we were finishing — re-arm.
            if revealed < goal.count || solidified < revealed { startPumpIfNeeded() }
        }
    }
}

#if canImport(UIKit)
    import UIKit

    /// Downscale + JPEG-compress a picked image to fit the relay frame
    /// budget (~300KB binary target; the Mac caps combined base64 at
    /// ~900KB for 2 images). Returns the wire dict for composerPrompt.
    public func twEncodeImageAttachment(_ image: UIImage, name: String) -> [String: Any]? {
        let maxDimension: CGFloat = 1280
        let scale = min(1, maxDimension / max(image.size.width, image.size.height))
        let target = CGSize(
            width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: target)
        let resized = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        // Walk quality down until it fits the per-image share of the budget.
        for quality in [0.7, 0.55, 0.4, 0.28] {
            if let data = resized.jpegData(compressionQuality: quality),
                data.count <= 330_000
            {
                return [
                    "name": name,
                    "mimeType": "image/jpeg",
                    "dataBase64": data.base64EncodedString(),
                ]
            }
        }
        return nil
    }
#endif

/// Rotating welcome heatmap — cycles three flavors every 90s with a
/// crossfade, mirroring the desktop welcome screen's rotating activity
/// panels. Flavors are different lenses over the synced-chat timestamps:
/// this workspace / all workspaces / weekly rhythm (weekday columns).
public struct RotatingActivityHeatmap: View {
    public struct Flavor: Identifiable {
        public let id: String
        public let title: String
        public let caption: String
        public let accent: Color
        public let dates: [Date]
        public let weekly: Bool

        public init(
            id: String, title: String, caption: String, accent: Color,
            dates: [Date], weekly: Bool = false
        ) {
            self.id = id
            self.title = title
            self.caption = caption
            self.accent = accent
            self.dates = dates
            self.weekly = weekly
        }
    }

    let flavors: [Flavor]
    @State private var index = 0

    public init(flavors: [Flavor]) {
        self.flavors = flavors
    }

    public var body: some View {
        let flavor = flavors[min(index, flavors.count - 1)]
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(flavor.title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(TWTheme.textTertiary)
                Spacer()
                // Flavor pips
                HStack(spacing: 4) {
                    ForEach(0..<flavors.count, id: \.self) { pip in
                        Circle()
                            .fill(pip == index ? flavor.accent : TWTheme.surface3)
                            .frame(width: 4, height: 4)
                    }
                }
                Text(flavor.caption)
                    .font(.caption2)
                    .foregroundStyle(TWTheme.textMuted)
            }
            ZStack(alignment: .topTrailing) {
                if flavor.weekly {
                    WeeklyRhythmHeatmap(dates: flavor.dates, accent: flavor.accent)
                } else {
                    ActivityHeatmap(dates: flavor.dates, accent: flavor.accent)
                }
                GhostMarkView(size: 34)
                    .opacity(0.35)
                    .offset(x: -6, y: -26)
            }
        }
        .id(flavor.id)
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.8), value: index)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 90_000_000_000)
                guard !Task.isCancelled, flavors.count > 1 else { continue }
                withAnimation(.easeInOut(duration: 0.8)) {
                    index = (index + 1) % flavors.count
                }
            }
        }
    }
}

/// Hour-of-day × weekday rhythm grid (the third desktop flavor).
public struct WeeklyRhythmHeatmap: View {
    let dates: [Date]
    let accent: Color

    public init(dates: [Date], accent: Color) {
        self.dates = dates
        self.accent = accent
    }

    private var counts: [[Int]] {
        var grid = Array(repeating: Array(repeating: 0, count: 7), count: 6)
        let calendar = Calendar.current
        for date in dates {
            let weekday = (calendar.component(.weekday, from: date) + 5) % 7  // Mon = 0
            let hour = calendar.component(.hour, from: date)
            grid[min(5, hour / 4)][weekday] += 1
        }
        return grid
    }

    public var body: some View {
        let grid = counts
        VStack(alignment: .leading, spacing: 2) {
            ForEach(0..<6, id: \.self) { row in
                HStack(spacing: 2) {
                    ForEach(0..<7, id: \.self) { col in
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(cellColor(grid[row][col]))
                            .frame(height: 7)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }

    private func cellColor(_ count: Int) -> Color {
        switch count {
        case 0: return TWTheme.surface2
        case 1: return accent.opacity(0.35)
        case 2...3: return accent.opacity(0.6)
        default: return accent.opacity(0.95)
        }
    }
}

/// Ensemble @-mention engine — mirrors the Mac's EnsembleMentionAlias
/// normalization (lowercase, hyphens/underscores → spaces; a no-space
/// concat variant is also registered Mac-side, so inserting
/// "@RoleNoSpaces" always resolves).
public struct MentionCandidate: Identifiable {
    public let id: String
    public let insertText: String
    public let display: String
    public let provider: String?

    public init(id: String, insertText: String, display: String, provider: String?) {
        self.id = id
        self.insertText = insertText
        self.display = display
        self.provider = provider
    }
}

public func twMentionCandidates(
    participants: [RemoteEnsembleState.Participant]
) -> [MentionCandidate] {
    participants
        .sorted { ($0.order ?? 0) < ($1.order ?? 0) }
        .map { participant in
            let role = participant.role?.trimmingCharacters(in: .whitespaces) ?? ""
            let label = role.isEmpty ? TWTheme.providerLabel(participant.provider) : role
            let insert = "@" + label.replacingOccurrences(of: " ", with: "")
            return MentionCandidate(
                id: participant.participantId,
                insertText: insert,
                display: label,
                provider: participant.provider)
        }
}

/// Color known @mentions in a transcript preview with their participant's
/// provider accent. Conservative: only EXACT alias tokens are tinted.
@MainActor public func twColorizeMentions(
    _ text: String, participants: [RemoteEnsembleState.Participant]
) -> AttributedString {
    var attributed = AttributedString(text)
    guard !participants.isEmpty else { return attributed }
    var aliasAccent: [String: Color] = [:]
    for participant in participants {
        let accent = TWTheme.providerAccent(participant.provider)
        if let role = participant.role, !role.isEmpty {
            aliasAccent[role.lowercased()] = accent
            aliasAccent[role.replacingOccurrences(of: " ", with: "").lowercased()] = accent
        }
        if let provider = participant.provider {
            aliasAccent[provider.lowercased()] = accent
            aliasAccent[TWTheme.providerLabel(provider).lowercased()] = accent
        }
    }
    aliasAccent["user"] = TWTheme.chroma1

    // Find @token runs in the plain string, map back into AttributedString.
    let pattern = #"@([A-Za-z][A-Za-z0-9._-]{1,40})"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return attributed }
    let ns = text as NSString
    for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        let token = ns.substring(with: match.range(at: 1))
        let normalized = token.lowercased().replacingOccurrences(of: "-", with: " ")
        let accent =
            aliasAccent[token.lowercased()]
            ?? aliasAccent[normalized]
            ?? aliasAccent[normalized.replacingOccurrences(of: " ", with: "")]
        guard let accent else { continue }
        guard
            let start = AttributedString.Index(
                String.Index(utf16Offset: match.range.location, in: text), within: attributed),
            let end = AttributedString.Index(
                String.Index(utf16Offset: match.range.location + match.range.length, in: text),
                within: attributed)
        else { continue }
        attributed[start..<end].foregroundColor = accent
        attributed[start..<end].font = .body.weight(.semibold)
    }
    return attributed
}

// ── MarkdownLite — desktop-transcript-parity markdown blocks ──────────────
// Line-based block renderer over the newline-preserving previews the Mac
// now ships: headings, bullet/numbered lists, fenced code, simple tables,
// blockquotes, paragraphs — with inline bold/italic/code/links parsed via
// AttributedString and @mentions tinted by participant provider accent.
// Deliberately dependency-free and bounded (preview text is ≤ a few KB).

public struct MarkdownLite: View {
    let text: String
    let participants: [RemoteEnsembleState.Participant]
    let baseColor: Color

    public init(
        _ text: String,
        participants: [RemoteEnsembleState.Participant] = [],
        baseColor: Color = TWTheme.textPrimary
    ) {
        self.text = text
        self.participants = participants
        self.baseColor = baseColor
    }

    private enum Block {
        case heading(level: Int, text: String)
        case bullet(items: [String])
        case numbered(items: [String])
        case code(lines: [String])
        case table(rows: [String])
        case quote(text: String)
        case paragraph(text: String)
    }

    private var blocks: [Block] {
        var out: [Block] = []
        var paragraph: [String] = []
        var bullets: [String] = []
        var numbers: [String] = []
        var tableRows: [String] = []
        var codeLines: [String] = []
        var inFence = false

        func flushParagraph() {
            if !paragraph.isEmpty {
                out.append(.paragraph(text: paragraph.joined(separator: "\n")))
                paragraph = []
            }
        }
        func flushLists() {
            if !bullets.isEmpty {
                out.append(.bullet(items: bullets))
                bullets = []
            }
            if !numbers.isEmpty {
                out.append(.numbered(items: numbers))
                numbers = []
            }
            if !tableRows.isEmpty {
                out.append(.table(rows: tableRows))
                tableRows = []
            }
        }

        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") {
                flushParagraph()
                flushLists()
                if inFence {
                    out.append(.code(lines: codeLines))
                    codeLines = []
                }
                inFence.toggle()
                continue
            }
            if inFence {
                codeLines.append(line)
                continue
            }
            if trimmed.isEmpty {
                flushParagraph()
                flushLists()
                continue
            }
            if let heading = headingLevel(trimmed) {
                flushParagraph()
                flushLists()
                out.append(.heading(level: heading.level, text: heading.text))
                continue
            }
            if trimmed.hasPrefix("|") {
                flushParagraph()
                // Skip pure separator rows (|---|---|).
                let bare = trimmed.replacingOccurrences(of: "|", with: "")
                    .replacingOccurrences(of: "-", with: "")
                    .replacingOccurrences(of: ":", with: "")
                    .trimmingCharacters(in: .whitespaces)
                if !bare.isEmpty { tableRows.append(trimmed) }
                continue
            }
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("• ") {
                flushParagraph()
                bullets.append(String(trimmed.dropFirst(2)))
                continue
            }
            if let numbered = numberedItem(trimmed) {
                flushParagraph()
                numbers.append(numbered)
                continue
            }
            if trimmed.hasPrefix("> ") {
                flushParagraph()
                flushLists()
                out.append(.quote(text: String(trimmed.dropFirst(2))))
                continue
            }
            flushLists()
            paragraph.append(trimmed)
        }
        if inFence, !codeLines.isEmpty { out.append(.code(lines: codeLines)) }
        flushParagraph()
        flushLists()
        return out
    }

    private func headingLevel(_ line: String) -> (level: Int, text: String)? {
        var level = 0
        for character in line {
            if character == "#" { level += 1 } else { break }
        }
        guard level >= 1, level <= 6 else { return nil }
        let body = line.dropFirst(level).trimmingCharacters(in: .whitespaces)
        guard !body.isEmpty else { return nil }
        return (level, body)
    }

    private func numberedItem(_ line: String) -> String? {
        guard let dot = line.firstIndex(of: "."), line.startIndex < dot,
            line.index(after: dot) < line.endIndex,
            line[line.index(after: dot)] == " ",
            line[line.startIndex..<dot].allSatisfy({ $0.isNumber })
        else { return nil }
        return String(line[line.index(dot, offsetBy: 2)...])
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
    }

    @ViewBuilder
    private func blockView(_ block: Block) -> some View {
        switch block {
        case .heading(let level, let text):
            inlineText(text)
                .font(
                    level <= 1
                        ? TWFont.transcript(20, weight: .bold, relativeTo: .title3)
                        : level == 2
                            ? TWFont.transcript(18, weight: .bold, relativeTo: .headline)
                            : TWFont.transcript(16, weight: .semibold, relativeTo: .headline)
                )
                .padding(.top, 2)
        case .bullet(let items):
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 7) {
                        Text("•").foregroundStyle(TWTheme.textTertiary)
                        inlineText(item).font(TWFont.transcript())
                    }
                }
            }
        case .numbered(let items):
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: 7) {
                        Text("\(index + 1).")
                            .font(TWFont.transcript(14))
                            .foregroundStyle(TWTheme.textTertiary)
                        inlineText(item).font(TWFont.transcript())
                    }
                }
            }
        case .code(let lines):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(lines.joined(separator: "\n"))
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(TWTheme.textPrimary)
                    .padding(10)
            }
            .background(TWTheme.surface2, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(TWTheme.border))
        case .table(let rows):
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    Text(tableLine(row))
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(index == 0 ? TWTheme.textPrimary : TWTheme.textSecondary)
                        .lineLimit(2)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(TWTheme.surface2, in: RoundedRectangle(cornerRadius: 8))
        case .quote(let text):
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 1).fill(TWTheme.chroma1).frame(width: 3)
                inlineText(text)
                    .font(TWFont.transcript())
                    .foregroundStyle(TWTheme.textSecondary)
            }
        case .paragraph(let text):
            inlineText(text).font(TWFont.transcript())
        }
    }

    /// Compact a `| a | b |` table row for the monospaced grid.
    private func tableLine(_ row: String) -> String {
        row.split(separator: "|", omittingEmptySubsequences: true)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .joined(separator: "  ·  ")
    }

    /// Inline markdown (bold/italic/code/links) + provider-tinted mentions.
    private func inlineText(_ raw: String) -> Text {
        var attributed: AttributedString
        if let parsed = try? AttributedString(
            markdown: raw,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
        {
            attributed = parsed
        } else {
            attributed = AttributedString(raw)
        }
        // Style inline code runs.
        for run in attributed.runs
        where run.inlinePresentationIntent?.contains(.code) == true {
            attributed[run.range].font = .system(size: 14, design: .monospaced)
            attributed[run.range].foregroundColor = TWTheme.chroma3
        }
        // Tint known participant mentions.
        if !participants.isEmpty {
            let plain = String(attributed.characters)
            let mentionMatches = twMentionRanges(in: plain, participants: participants)
            for match in mentionMatches {
                if let start = AttributedString.Index(
                    String.Index(utf16Offset: match.location, in: plain), within: attributed),
                    let end = AttributedString.Index(
                        String.Index(utf16Offset: match.location + match.length, in: plain),
                        within: attributed)
                {
                    attributed[start..<end].foregroundColor = match.accent
                    attributed[start..<end].font = TWFont.transcript(16, weight: .semibold)
                }
            }
        }
        var base = attributed
        base.foregroundColor = nil  // keep run-level colors; default applied below
        return Text(attributed).foregroundColor(baseColor)
    }
}

/// Exact-alias mention ranges (utf16) + provider accents for a plain string.
public struct TWMentionRange {
    public let location: Int
    public let length: Int
    public let accent: Color
}

@MainActor public func twMentionRanges(
    in text: String, participants: [RemoteEnsembleState.Participant]
) -> [TWMentionRange] {
    var aliasAccent: [String: Color] = [:]
    for participant in participants {
        let accent = TWTheme.providerAccent(participant.provider)
        if let role = participant.role, !role.isEmpty {
            aliasAccent[role.lowercased()] = accent
            aliasAccent[role.replacingOccurrences(of: " ", with: "").lowercased()] = accent
        }
        if let provider = participant.provider {
            aliasAccent[provider.lowercased()] = accent
            aliasAccent[TWTheme.providerLabel(provider).lowercased()] = accent
        }
    }
    aliasAccent["user"] = TWTheme.chroma1
    guard let regex = try? NSRegularExpression(pattern: "@([A-Za-z][A-Za-z0-9._-]{1,40})") else {
        return []
    }
    let ns = text as NSString
    var out: [TWMentionRange] = []
    for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        let token = ns.substring(with: match.range(at: 1))
        let normalized = token.lowercased().replacingOccurrences(of: "-", with: " ")
        let accent =
            aliasAccent[token.lowercased()]
            ?? aliasAccent[normalized]
            ?? aliasAccent[normalized.replacingOccurrences(of: " ", with: "")]
        if let accent {
            out.append(
                TWMentionRange(
                    location: match.range.location, length: match.range.length, accent: accent))
        }
    }
    return out
}

/// Desktop ActivityStack parity: one card per tool call — category icon,
/// name, touched file, per-edit +/− diff chips, status dot, result line.
public struct ToolActivityCards: View {
    let entries: [RemoteThreadSnapshot.Row.ToolEntry]
    let totalCount: Int
    let status: String?

    public init(
        entries: [RemoteThreadSnapshot.Row.ToolEntry], totalCount: Int, status: String?
    ) {
        self.entries = entries
        self.totalCount = totalCount
        self.status = status
    }

    /// Consecutive same-name calls collapse into one row ("Search tool ×9")
    /// — status aggregates (error > running > success), write-tool diff
    /// chips sum across the group, detail comes from the last entry.
    private struct CollapsedEntry: Identifiable {
        let entry: RemoteThreadSnapshot.Row.ToolEntry
        let count: Int
        var id: String { entry.id + "×\(count)" }
    }

    private var collapsed: [CollapsedEntry] {
        var out: [CollapsedEntry] = []
        for entry in entries {
            if let last = out.last, last.entry.name == entry.name,
                last.entry.category == entry.category
            {
                let mergedStatus =
                    last.entry.status == "error" || entry.status == "error"
                    ? "error"
                    : last.entry.status == "running" || entry.status == "running"
                        ? "running" : entry.status
                let merged = RemoteThreadSnapshot.Row.ToolEntry(
                    name: entry.name,
                    category: entry.category,
                    status: mergedStatus,
                    file: last.entry.file == entry.file ? entry.file : nil,
                    additions: (last.entry.additions ?? 0) + (entry.additions ?? 0) > 0
                        ? (last.entry.additions ?? 0) + (entry.additions ?? 0) : nil,
                    deletions: (last.entry.deletions ?? 0) + (entry.deletions ?? 0) > 0
                        ? (last.entry.deletions ?? 0) + (entry.deletions ?? 0) : nil,
                    detail: entry.detail ?? last.entry.detail
                )
                out[out.count - 1] = CollapsedEntry(entry: merged, count: last.count + 1)
            } else {
                out.append(CollapsedEntry(entry: entry, count: 1))
            }
        }
        return out
    }

    public var body: some View {
        // Inline (satellite) presentation — no container chrome, the calls
        // sit in the transcript flow exactly where they happened.
        VStack(alignment: .leading, spacing: 5) {
            ForEach(collapsed) { group in
                row(group.entry, count: group.count)
            }
            if totalCount > entries.count {
                Text("+ \(totalCount - entries.count) more tool call\(totalCount - entries.count == 1 ? "" : "s")")
                    .font(.caption2)
                    .foregroundStyle(TWTheme.textMuted)
                    .padding(.leading, 23)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func row(_ entry: RemoteThreadSnapshot.Row.ToolEntry, count: Int = 1) -> some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: icon(entry.category))
                .font(.caption)
                .foregroundStyle(categoryColor(entry.category))
                .frame(width: 16)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(entry.name)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(TWTheme.textPrimary)
                    if count > 1 {
                        Text("×\(count)")
                            .font(.caption2.weight(.semibold).monospacedDigit())
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(TWTheme.surface3, in: Capsule())
                            .foregroundStyle(TWTheme.textSecondary)
                    }
                    if let file = entry.file {
                        Text(fileTail(file))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(TWTheme.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                    if let additions = entry.additions, additions > 0 {
                        Text("+\(additions)")
                            .font(.caption2.weight(.semibold).monospacedDigit())
                            .foregroundStyle(TWTheme.statusSuccess)
                    }
                    if let deletions = entry.deletions, deletions > 0 {
                        Text("−\(deletions)")
                            .font(.caption2.weight(.semibold).monospacedDigit())
                            .foregroundStyle(TWTheme.statusFailed)
                    }
                    Spacer(minLength: 0)
                    Circle()
                        .fill(TWTheme.statusColor(entry.status))
                        .frame(width: 5, height: 5)
                }
                if let detail = entry.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(TWTheme.textTertiary)
                        .lineLimit(2)
                }
            }
        }
    }

    private func icon(_ category: String?) -> String {
        switch category {
        case "shell": return "terminal"
        case "write": return "pencil.line"
        case "read": return "doc.text"
        case "search": return "magnifyingglass"
        case "task": return "person.2"
        default: return "wrench.and.screwdriver"
        }
    }

    private func categoryColor(_ category: String?) -> Color {
        // Tool Call Theme: 'Match accent' keeps per-category hues keyed off
        // the standard palette; a fixed theme tints every category.
        if TWThemeStore.shared.toolTheme != .matchAccent {
            return TWThemeStore.toolAccent
        }
        switch category {
        case "write": return TWTheme.statusAttention
        case "shell": return TWTheme.chroma3
        case "search": return TWTheme.chroma1
        default: return TWTheme.textSecondary
        }
    }

    private func fileTail(_ path: String) -> String {
        let parts = path.split(separator: "/")
        return parts.suffix(2).joined(separator: "/")
    }
}

// ── Thread inspector — diff + sub-agent tabs ───────────────────────────────
// iPad: right-hand `.inspector` panel; iPhone: the same view presents as a
// sheet (system behavior). Tabs: Changes (run diff files) and Agents
// (sub-threads / side chats / guests delegated from this thread).

public struct ThreadInspector: View {
    @ObservedObject var model: RemoteSessionModel
    let threadId: String
    var onOpenThread: ((String) -> Void)? = nil
    @State private var tab = 0

    public init(
        model: RemoteSessionModel, threadId: String,
        onOpenThread: ((String) -> Void)? = nil
    ) {
        self.model = model
        self.threadId = threadId
        self.onOpenThread = onOpenThread
    }

    private var diff: MobileDiffSummary? { model.diffSummaries[threadId] }
    private var children: [RemoteTaskCard] {
        model.taskCards.filter { $0.parentChatId == threadId }
    }

    public var body: some View {
        VStack(spacing: 0) {
            Picker("Inspector", selection: $tab) {
                Text("Changes").tag(0)
                Text("Agents").tag(1)
                Text("Notes").tag(2)
            }
            .pickerStyle(.segmented)
            .padding(12)
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if tab == 0 {
                        DiffSummaryPanel(diff: diff)
                    } else if tab == 1 {
                        SubAgentsPanel(children: children, onOpenThread: onOpenThread)
                    } else {
                        NotesPanel(model: model, threadId: threadId)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 16)
            }
        }
        .background(TWTheme.appBg)
        .preferredColorScheme(.dark)
    }
}

struct DiffSummaryPanel: View {
    let diff: MobileDiffSummary?

    var body: some View {
        if let diff, let files = diff.files, !files.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text("\(diff.filesChanged ?? files.count) file\((diff.filesChanged ?? files.count) == 1 ? "" : "s") changed")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(TWTheme.textPrimary)
                    if let additions = diff.additions, additions > 0 {
                        Text("+\(additions)")
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(TWTheme.statusSuccess)
                    }
                    if let deletions = diff.deletions, deletions > 0 {
                        Text("−\(deletions)")
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(TWTheme.statusFailed)
                    }
                    Spacer()
                }
                HStack(spacing: 8) {
                    statChip("Created", diff.createdFiles, TWTheme.statusSuccess)
                    statChip("Edited", diff.modifiedFiles, TWTheme.chroma1)
                    statChip("Deleted", diff.deletedFiles, TWTheme.statusFailed)
                    Spacer()
                }
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(files) { file in
                        fileRow(file)
                    }
                }
                if diff.truncated == true {
                    Text("More changes on your Mac — open Review changes there for the full diff.")
                        .font(.caption2)
                        .foregroundStyle(TWTheme.textMuted)
                }
            }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "plusminus.circle")
                    .font(.title2)
                    .foregroundStyle(TWTheme.textTertiary)
                Text("No file changes from the latest run yet.")
                    .font(.footnote)
                    .foregroundStyle(TWTheme.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 32)
        }
    }

    @ViewBuilder
    private func statChip(_ label: String, _ count: Int?, _ accent: Color) -> some View {
        if let count, count > 0 {
            Text("\(label) \(count)")
                .font(.caption2.weight(.medium))
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(accent.opacity(0.12), in: Capsule())
                .foregroundStyle(accent)
        }
    }

    private func fileRow(_ file: MobileDiffSummary.File) -> some View {
        HStack(spacing: 7) {
            Circle()
                .fill(statusColor(file.status))
                .frame(width: 6, height: 6)
            Text(file.path)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(TWTheme.textPrimary)
                .lineLimit(1)
                .truncationMode(.head)
            Spacer(minLength: 4)
            if file.isBinary == true {
                Text("binary").font(.caption2).foregroundStyle(TWTheme.textMuted)
            } else {
                if let additions = file.additions, additions > 0 {
                    Text("+\(additions)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(TWTheme.statusSuccess)
                }
                if let deletions = file.deletions, deletions > 0 {
                    Text("−\(deletions)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(TWTheme.statusFailed)
                }
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(TWTheme.surface1, in: RoundedRectangle(cornerRadius: 8))
    }

    private func statusColor(_ status: String?) -> Color {
        switch status {
        case "created", "added": return TWTheme.statusSuccess
        case "deleted", "removed": return TWTheme.statusFailed
        default: return TWTheme.chroma1
        }
    }
}

struct SubAgentsPanel: View {
    let children: [RemoteTaskCard]
    var onOpenThread: ((String) -> Void)? = nil

    var body: some View {
        if children.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "person.2.circle")
                    .font(.title2)
                    .foregroundStyle(TWTheme.textTertiary)
                Text("No sub-agents or side chats delegated from this thread.")
                    .font(.footnote)
                    .foregroundStyle(TWTheme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 32)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(children, id: \.id) { child in
                    Button {
                        onOpenThread?(child.id)
                    } label: {
                        let identityAccent =
                            child.agentName != nil
                            ? twAgentAccentColor(child.agentAccent)
                            : TWTheme.providerAccent(child.provider)
                        HStack(alignment: .top, spacing: 8) {
                            if let agentName = child.agentName {
                                AgentIdentityBadge(
                                    name: agentName,
                                    accentHex: child.agentAccent,
                                    slug: child.agentSlug)
                                    .padding(.top, 1)
                            } else {
                                Image(systemName: relationIcon(child))
                                    .font(.caption)
                                    .foregroundStyle(TWTheme.providerAccent(child.provider))
                                    .frame(width: 16)
                                    .padding(.top, 2)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                if let agentName = child.agentName {
                                    Text(agentName)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(identityAccent)
                                        .lineLimit(1)
                                }
                                Text(child.title ?? child.id)
                                    .font(
                                        child.agentName != nil
                                            ? .caption : .subheadline
                                    )
                                    .foregroundStyle(
                                        child.agentName != nil
                                            ? TWTheme.textSecondary : TWTheme.textPrimary
                                    )
                                    .lineLimit(2)
                                HStack(spacing: 6) {
                                    Text(TWTheme.providerLabel(child.provider))
                                        .font(.caption2.weight(.medium))
                                        .foregroundStyle(TWTheme.providerAccent(child.provider))
                                    Text(relationLabel(child))
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 1)
                                        .background(TWTheme.surface3, in: Capsule())
                                        .foregroundStyle(TWTheme.textTertiary)
                                    if let status = child.status {
                                        HStack(spacing: 3) {
                                            Circle()
                                                .fill(TWTheme.statusColor(status))
                                                .frame(width: 5, height: 5)
                                            Text(status)
                                                .font(.caption2)
                                                .foregroundStyle(TWTheme.statusColor(status))
                                        }
                                    }
                                }
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(TWTheme.textMuted)
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(TWTheme.surface1, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(
                            // Desktop invocation-card parity: the agent's
                            // accent hue outlines its card.
                            RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(
                                    identityAccent.opacity(
                                        child.agentName != nil ? 0.55 : 0.0))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func relationLabel(_ card: RemoteTaskCard) -> String {
        if card.isGuestSideChat { return "Guest" }
        if card.parentChatRelation == "sideChat" { return "Side chat" }
        if card.parentChatRelation == "subThread" { return "Sub-thread" }
        return card.isEnsemble ? "Ensemble clone" : "Delegated"
    }

    private func relationIcon(_ card: RemoteTaskCard) -> String {
        if card.isGuestSideChat { return "person.crop.circle.badge.plus" }
        if card.parentChatRelation == "sideChat" { return "arrow.left.arrow.right" }
        return "arrow.turn.down.right"
    }
}

/// Above-composer changes row — the Codex-app "N files changed +X −Y" bar.
public struct ChangesAboveRow: View {
    let diff: MobileDiffSummary
    let action: () -> Void

    public init(diff: MobileDiffSummary, action: @escaping () -> Void) {
        self.diff = diff
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: "plusminus.circle")
                    .font(.caption)
                    .foregroundStyle(TWTheme.chroma1)
                Text("\(diff.filesChanged ?? diff.files?.count ?? 0) file\((diff.filesChanged ?? diff.files?.count ?? 0) == 1 ? "" : "s") changed")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TWTheme.textPrimary)
                if let additions = diff.additions, additions > 0 {
                    Text("+\(additions)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(TWTheme.statusSuccess)
                }
                if let deletions = diff.deletions, deletions > 0 {
                    Text("−\(deletions)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(TWTheme.statusFailed)
                }
                Spacer()
                Text("Review")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TWTheme.chroma1)
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(TWTheme.textMuted)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 7)
            .background(TWTheme.surface2, in: Capsule())
            .overlay(Capsule().strokeBorder(TWTheme.border))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 10)
    }
}

// ── Composer shell rows (desktop three-decker parity) ──────────────────────

/// Attached diff header — top corners rounded, flat bottom edge merging
/// into the composer body. The desktop's "branch · N files changed +X −Y ·
/// Review changes" bar, minus git metadata the bridge doesn't ship yet.
public struct ChangesAttachedRow: View {
    let diff: MobileDiffSummary
    let action: () -> Void

    public init(diff: MobileDiffSummary, action: @escaping () -> Void) {
        self.diff = diff
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.caption)
                    .foregroundStyle(TWTheme.textTertiary)
                Text("\(diff.filesChanged ?? diff.files?.count ?? 0) file\((diff.filesChanged ?? diff.files?.count ?? 0) == 1 ? "" : "s") changed")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TWTheme.textPrimary)
                if let additions = diff.additions, additions > 0 {
                    Text("+\(additions)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(TWTheme.statusSuccess)
                }
                if let deletions = diff.deletions, deletions > 0 {
                    Text("−\(deletions)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(TWTheme.statusFailed)
                }
                Spacer()
                Text("Review changes")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(TWTheme.textSecondary)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(TWTheme.surface3, in: Capsule())
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }
}

/// Bottom telemetry rail — flat top, rounded bottom corners. One RUN
/// timecode (ticking while running, frozen at the final duration),
/// workspace name center, token/cost telemetry right.
public struct TelemetryFooterRail: View {
    let run: RemoteThreadSnapshot.RunSummary?
    let workspaceName: String?
    /// Allowlisted workspaces for the secondary-grant picker (empty = the
    /// rail renders the plain read-only label).
    var workspaceOptions: [(id: String, name: String)] = []
    var primaryWorkspaceId: String? = nil
    var secondaryWorkspaceId: Binding<String?>? = nil

    public init(
        run: RemoteThreadSnapshot.RunSummary?, workspaceName: String?,
        workspaceOptions: [(id: String, name: String)] = [],
        primaryWorkspaceId: String? = nil,
        secondaryWorkspaceId: Binding<String?>? = nil
    ) {
        self.run = run
        self.workspaceName = workspaceName
        self.workspaceOptions = workspaceOptions
        self.primaryWorkspaceId = primaryWorkspaceId
        self.secondaryWorkspaceId = secondaryWorkspaceId
    }

    private var isRunning: Bool { run?.status == "running" }

    private var secondaryName: String? {
        guard let id = secondaryWorkspaceId?.wrappedValue else { return nil }
        return workspaceOptions.first(where: { $0.id == id })?.name
    }

    private var railWorkspaceLabel: String {
        if let secondaryName { return "\(workspaceName ?? "") + \(secondaryName)" }
        return workspaceName ?? ""
    }

    private func frozenDuration() -> TimeInterval? {
        if let ms = run?.durationMs { return TimeInterval(ms) / 1000 }
        return nil
    }

    private func liveDuration(now: Date) -> TimeInterval? {
        guard isRunning, let started = run?.startedAt,
            let startDate = twParseISODate(started)
        else { return frozenDuration() }
        return max(0, now.timeIntervalSince(startDate))
    }

    private func timecode(_ interval: TimeInterval?) -> String {
        guard let interval else { return "00:00:00" }
        let total = Int(interval)
        return String(
            format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }

    private var tokensText: String? {
        guard let run else { return nil }
        var parts: [String] = []
        if let tokensIn = run.tokensIn, tokensIn > 0 {
            parts.append("\(compact(tokensIn)) in")
        }
        if let tokensOut = run.tokensOut, tokensOut > 0 {
            parts.append("\(compact(tokensOut)) out")
        }
        if parts.isEmpty, let total = run.totalTokens, total > 0 {
            parts.append("\(compact(total)) tokens")
        }
        var text = parts.joined(separator: " / ")
        if let cost = run.costText, !cost.isEmpty {
            text = text.isEmpty ? cost : "\(text) · \(cost)"
        }
        return text.isEmpty ? nil : text
    }

    private func compact(_ value: Int) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000)
        }
        if value >= 1_000 {
            return String(format: "%.0fk", Double(value) / 1_000)
        }
        return "\(value)"
    }

    public var body: some View {
        TimelineView(.periodic(from: .now, by: isRunning ? 1 : 3600)) { context in
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.system(size: 9))
                    Text(timecode(liveDuration(now: context.date)))
                        .font(.system(size: 11, design: .monospaced))
                }
                .foregroundStyle(isRunning ? TWTheme.chroma1 : TWTheme.textTertiary)
                Spacer()
                if let workspaceName {
                    if let binding = secondaryWorkspaceId, !workspaceOptions.isEmpty {
                        // Workspace picker: primary is fixed (the thread's);
                        // picking another adds it as a secondary grant for
                        // subsequent runs (desktop parity).
                        Menu {
                            Section("Primary") {
                                Label(workspaceName, systemImage: "checkmark")
                            }
                            Section("Also grant access to") {
                                Button("None") { binding.wrappedValue = nil }
                                ForEach(
                                    workspaceOptions.filter { $0.id != primaryWorkspaceId },
                                    id: \.id
                                ) { option in
                                    Button {
                                        binding.wrappedValue =
                                            binding.wrappedValue == option.id ? nil : option.id
                                    } label: {
                                        if binding.wrappedValue == option.id {
                                            Label(option.name, systemImage: "checkmark")
                                        } else {
                                            Text(option.name)
                                        }
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "folder")
                                    .font(.system(size: 9))
                                Text(railWorkspaceLabel)
                                    .font(.system(size: 11))
                                    .lineLimit(1)
                                Image(systemName: "chevron.up.chevron.down")
                                    .font(.system(size: 7, weight: .semibold))
                            }
                            .foregroundStyle(
                                secondaryName != nil
                                    ? TWTheme.textSecondary : TWTheme.textTertiary)
                            .contentShape(Rectangle())
                        }
                        Spacer()
                    } else {
                        HStack(spacing: 4) {
                            Image(systemName: "folder")
                                .font(.system(size: 9))
                            Text(workspaceName)
                                .font(.system(size: 11))
                                .lineLimit(1)
                        }
                        .foregroundStyle(TWTheme.textTertiary)
                        Spacer()
                    }
                }
                if let tokensText {
                    Text(tokensText)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(TWTheme.textSecondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        }
    }
}

// ── Editable in-thread roster strip (desktop ensemble above-row parity) ────
// Chips in a single horizontally-scrolling row (works on iPhone width too —
// wrapping rows got messy fast). Tap a chip for the per-participant editor
// (popover on iPad, sheet on iPhone via compact adaptation): enable toggle,
// role, goal/brief, provider/model, move/remove. Long-press-drag chips to
// reorder. Every commit ships the FULL roster via ensembleRosterUpdate.

public struct EditableRosterStrip: View {
    @ObservedObject var model: RemoteSessionModel
    let threadId: String
    let workspaceId: String

    @State private var draft: [RemoteSessionModel.RosterDraftEntry] = []
    @State private var editingId: String? = nil
    @State private var draggingId: String? = nil

    public init(model: RemoteSessionModel, threadId: String, workspaceId: String) {
        self.model = model
        self.threadId = threadId
        self.workspaceId = workspaceId
    }

    private var state: RemoteEnsembleState? { model.ensembleStates[threadId] }

    private var catalogs: [ProviderModelCatalog] {
        model.providerModels
            .map { ProviderModelCatalog(provider: $0.key, models: $0.value) }
            .sorted { TWTheme.providerLabel($0.provider) < TWTheme.providerLabel($1.provider) }
    }

    private var remoteRoster: [RemoteSessionModel.RosterDraftEntry] {
        (state?.roster ?? [])
            .sorted { ($0.order ?? 0) < ($1.order ?? 0) }
            .map { entry in
                RemoteSessionModel.RosterDraftEntry(
                    id: entry.id,
                    provider: entry.provider,
                    model: entry.model,
                    role: entry.role ?? TWTheme.providerLabel(entry.provider),
                    brief: entry.brief ?? "",
                    enabled: entry.enabled ?? true
                )
            }
    }

    /// Round status per participant id (active speaker ring, status dot).
    private func roundStatus(for id: String) -> String? {
        state?.participants?.first { $0.participantId == id }?.status
    }

    public var body: some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(draft) { entry in
                        chip(entry)
                            .onDrag {
                                draggingId = entry.id
                                return NSItemProvider(object: entry.id as NSString)
                            }
                            .onDrop(
                                of: [.text],
                                delegate: RosterReorderDelegate(
                                    item: entry, draft: $draft, draggingId: $draggingId
                                ) {
                                    commit()
                                }
                            )
                    }
                }
                .padding(.vertical, 2)
            }
            addMenu
        }
        .padding(.horizontal, 12)
        .onAppear { if draft.isEmpty { draft = remoteRoster } }
        .onChange(of: remoteRoster) { _, fresh in
            // Reconcile from the Mac unless mid-edit (popover open / drag).
            if editingId == nil, draggingId == nil { draft = fresh }
        }
        .sheet(
            item: Binding(
                get: { editingId.flatMap { id in draft.first { $0.id == id } } },
                set: { if $0 == nil { editingId = nil } }
            )
        ) { entry in
            RosterChipEditor(
                entry: entry,
                catalogs: catalogs,
                canRemove: draft.count > 1,
                onApply: { updated in
                    if let index = draft.firstIndex(where: { $0.id == updated.id }) {
                        draft[index] = updated
                    }
                    editingId = nil
                    commit()
                },
                onMove: { direction in
                    guard let index = draft.firstIndex(where: { $0.id == entry.id }) else {
                        return
                    }
                    let target = index + direction
                    guard target >= 0, target < draft.count else { return }
                    draft.swapAt(index, target)
                    commit()
                },
                onRemove: {
                    draft.removeAll { $0.id == entry.id }
                    editingId = nil
                    commit()
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    private func chip(_ entry: RemoteSessionModel.RosterDraftEntry) -> some View {
        let accent = TWTheme.providerAccent(entry.provider)
        let status = roundStatus(for: entry.id)
        let isActive = status == "running" || state?.activeParticipantId == entry.id
        let fillOpacity: Double = entry.enabled ? 0.12 : 0.04
        let strokeColor: Color =
            isActive ? accent : accent.opacity(entry.enabled ? 0.35 : 0.15)
        let strokeWidth: CGFloat = isActive ? 1.5 : 1
        let labelColor: Color = entry.enabled ? accent : TWTheme.textMuted
        let dotColor: Color = entry.enabled ? accent : TWTheme.textMuted
        let title =
            entry.role.isEmpty ? TWTheme.providerLabel(entry.provider) : entry.role
        return Button {
            editingId = entry.id
        } label: {
            HStack(spacing: 5) {
                Circle()
                    .fill(dotColor)
                    .frame(width: 6, height: 6)
                Text(title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(labelColor)
                    .lineLimit(1)
                if status == "done" {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(TWTheme.statusSuccess)
                } else if status == "skipped" {
                    Image(systemName: "chevron.right.2")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(TWTheme.textMuted)
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(accent.opacity(fillOpacity), in: Capsule())
            .overlay(Capsule().strokeBorder(strokeColor, lineWidth: strokeWidth))
            .opacity(draggingId == entry.id ? 0.4 : 1)
        }
        .buttonStyle(.plain)
    }

    private var addMenu: some View {
        Menu {
            ForEach(catalogs.map(\.provider), id: \.self) { provider in
                Button {
                    draft.append(
                        RemoteSessionModel.RosterDraftEntry(
                            id: "draft-\(UUID().uuidString.prefix(8))",
                            provider: provider,
                            model: nil,
                            role: TWTheme.providerLabel(provider),
                            brief: "",
                            enabled: true
                        ))
                    commit()
                } label: {
                    Label(TWTheme.providerLabel(provider), systemImage: "cpu")
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TWTheme.textSecondary)
                .frame(width: 24, height: 24)
                .background(TWTheme.surface3, in: Circle())
        }
    }

    private func commit() {
        guard !draft.isEmpty else { return }
        model.updateEnsembleRoster(
            workspaceId: workspaceId, threadId: threadId, entries: draft)
    }
}

/// Drag-to-reorder drop delegate — reorders the draft live as the dragged
/// chip passes over siblings; commits once on drop.
struct RosterReorderDelegate: DropDelegate {
    let item: RemoteSessionModel.RosterDraftEntry
    @Binding var draft: [RemoteSessionModel.RosterDraftEntry]
    @Binding var draggingId: String?
    let onCommit: () -> Void

    func dropEntered(info: DropInfo) {
        guard let draggingId, draggingId != item.id,
            let from = draft.firstIndex(where: { $0.id == draggingId }),
            let to = draft.firstIndex(where: { $0.id == item.id })
        else { return }
        withAnimation(.easeInOut(duration: 0.15)) {
            draft.move(
                fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        draggingId = nil
        onCommit()
        return true
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }
}

/// Per-chip editor — enable, role, goal/brief, provider/model, move, remove.
struct RosterChipEditor: View {
    @State var entry: RemoteSessionModel.RosterDraftEntry
    let catalogs: [ProviderModelCatalog]
    let canRemove: Bool
    let onApply: (RemoteSessionModel.RosterDraftEntry) -> Void
    let onMove: (Int) -> Void
    let onRemove: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Enabled in ensemble rounds", isOn: $entry.enabled)
                        .tint(TWTheme.providerAccent(entry.provider))
                }
                Section("Role") {
                    TextField("Role name", text: $entry.role)
                }
                Section("Goal / brief") {
                    TextEditor(text: $entry.brief)
                        .frame(minHeight: 88)
                        .font(.footnote)
                }
                Section("Provider · model") {
                    Menu {
                        ForEach(catalogs.map(\.provider), id: \.self) { provider in
                            Button(TWTheme.providerLabel(provider)) {
                                entry.provider = provider
                                entry.model = nil
                            }
                        }
                    } label: {
                        HStack {
                            Circle()
                                .fill(TWTheme.providerAccent(entry.provider))
                                .frame(width: 7, height: 7)
                            Text(TWTheme.providerLabel(entry.provider))
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.caption2)
                        }
                    }
                    Menu {
                        Button("CLI Default") { entry.model = nil }
                        ForEach(
                            catalogs.first {
                                $0.provider.lowercased() == entry.provider.lowercased()
                            }?.models ?? []
                        ) { modelOption in
                            Button(modelOption.label ?? modelOption.id) {
                                entry.model = modelOption.id
                            }
                        }
                    } label: {
                        HStack {
                            Text(entry.model ?? "CLI Default")
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.caption2)
                        }
                    }
                }
                Section {
                    HStack {
                        Button {
                            onMove(-1)
                        } label: {
                            Label("Earlier", systemImage: "arrow.left")
                        }
                        Spacer()
                        Button {
                            onMove(1)
                        } label: {
                            Label("Later", systemImage: "arrow.right")
                        }
                    }
                    if canRemove {
                        Button(role: .destructive) {
                            onRemove()
                            dismiss()
                        } label: {
                            Label("Remove participant", systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle(
                entry.role.isEmpty ? TWTheme.providerLabel(entry.provider) : entry.role
            )
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onApply(entry)
                        dismiss()
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

// ── Agent identity badge (sub-agent identicon parity, minimal form) ────────
// The desktop renders full hand-drawn catalog characters; the phone's
// minimal-parity badge keeps the three identity carriers — NAME, accent
// HUE, and a unique mark — using the ghost wordmark tinted with the
// agent's accent inside an accent ring, plus an orbital satellite dot
// whose angle derives from the SAME FNV-1a hash the desktop's identicon
// picker uses (agentIdenticon.ts), echoing the catalog's orbital motif.

public func twAgentIdenticonHash(_ seed: String?) -> UInt32 {
    let value = (seed?.trimmingCharacters(in: .whitespaces).lowercased()).flatMap {
        $0.isEmpty ? nil : $0
    } ?? "agent"
    var hash: UInt32 = 0x811c_9dc5
    for unit in value.utf16 {
        hash ^= UInt32(unit)
        hash = hash &* 0x0100_0193
    }
    return hash
}

@MainActor public func twAgentAccentColor(_ hex: String?) -> Color {
    guard var hexString = hex?.trimmingCharacters(in: .whitespaces), !hexString.isEmpty else {
        return TWTheme.chroma1
    }
    if hexString.hasPrefix("#") { hexString.removeFirst() }
    guard hexString.count == 6, let value = UInt32(hexString, radix: 16) else {
        return TWTheme.chroma1
    }
    return Color(
        red: Double((value >> 16) & 0xFF) / 255,
        green: Double((value >> 8) & 0xFF) / 255,
        blue: Double(value & 0xFF) / 255
    )
}

public struct AgentIdentityBadge: View {
    let name: String
    let accentHex: String?
    let slug: String?
    var size: CGFloat = 22

    public init(name: String, accentHex: String?, slug: String?, size: CGFloat = 22) {
        self.name = name
        self.accentHex = accentHex
        self.slug = slug
        self.size = size
    }

    private var accent: Color { twAgentAccentColor(accentHex) }

    private var orbitalAngle: Angle {
        .degrees(Double(twAgentIdenticonHash(slug ?? name) % 360))
    }

    /// Full hand-drawn catalog character (baked from the named SVGs into
    /// the package resources via qlmanage). Nil when the slug has no baked
    /// asset — the minimal ring badge below covers that.
    private static func catalogImage(for slug: String?) -> Image? {
        guard let slug, !slug.isEmpty else { return nil }
        #if canImport(UIKit)
            if let url = Bundle.module.url(
                forResource: "identicon-\(slug)", withExtension: "png"),
                let data = try? Data(contentsOf: url),
                let ui = UIImage(data: data)
            {
                return Image(uiImage: ui)
            }
        #endif
        return nil
    }

    public var body: some View {
        ZStack {
            if let catalog = Self.catalogImage(for: slug) {
                Circle().fill(accent.opacity(0.10))
                catalog
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.06)
                Circle().strokeBorder(accent.opacity(0.5), lineWidth: 1)
            } else {
                Circle()
                    .fill(accent.opacity(0.14))
                Circle()
                    .strokeBorder(accent.opacity(0.65), lineWidth: 1.2)
                GhostMarkView()
                    .frame(width: size * 0.62, height: size * 0.62)
                    .colorMultiply(accent)
                // Orbital satellite — the per-character motif from the catalog.
                Circle()
                    .fill(accent)
                    .frame(width: size * 0.18, height: size * 0.18)
                    .offset(y: -size / 2)
                    .rotationEffect(orbitalAngle)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(Text(name))
    }
}

/// Masthead logo — the WWDC26 ghost until 9 Jul 2026, then the sticker.
/// (Date gate per the 28-day request from 11 Jun 2026; revert = this view
/// flips automatically, no code change needed.)
public struct MastheadLogoView: View {
    public var size: CGFloat = 34

    public init(size: CGFloat = 34) { self.size = size }

    private static let wwdcCutoff: Date = {
        var components = DateComponents()
        components.year = 2026
        components.month = 7
        components.day = 9
        return Calendar.current.date(from: components) ?? .distantPast
    }()

    private var resourceName: String {
        Date() < Self.wwdcCutoff ? "masthead-wwdc26" : "masthead-sticker"
    }

    public var body: some View {
        Group {
            #if canImport(UIKit)
                if let url = Bundle.module.url(
                    forResource: resourceName, withExtension: "png"),
                    let data = try? Data(contentsOf: url),
                    let ui = UIImage(data: data)
                {
                    Image(uiImage: ui)
                        .resizable()
                        .scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: size * 0.22))
                } else {
                    GhostMarkView(size: size)
                }
            #else
                GhostMarkView(size: size)
            #endif
        }
        .frame(width: size, height: size)
    }
}

/// App settings — theme controls land here next pass (mirroring the
/// desktop's theme system where sensible; composer theming deferred).
public struct AppSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var themes = TWThemeStore.shared

    public init() {}

    public var body: some View {
        NavigationStack {
            Form {
                Section("Themes") {
                    Picker(
                        selection: Binding(
                            get: { themes.systemTheme },
                            set: { themes.systemTheme = $0 }
                        )
                    ) {
                        ForEach(TWSystemTheme.allCases) { theme in
                            HStack {
                                Circle().fill(theme.surface3).frame(width: 12, height: 12)
                                Text(theme.label)
                            }
                            .tag(theme)
                        }
                    } label: {
                        Label("System Theme", systemImage: "circle.lefthalf.filled")
                    }
                    Picker(
                        selection: Binding(
                            get: { themes.accentTheme },
                            set: { themes.accentTheme = $0 }
                        )
                    ) {
                        ForEach(TWAccentTheme.allCases) { accent in
                            HStack {
                                Circle().fill(accent.color).frame(width: 12, height: 12)
                                Text(accent.label)
                            }
                            .tag(accent)
                        }
                    } label: {
                        Label("Accent Theme", systemImage: "paintpalette")
                    }
                    Picker(
                        selection: Binding(
                            get: { themes.toolTheme },
                            set: { themes.toolTheme = $0 }
                        )
                    ) {
                        ForEach(TWToolTheme.allCases) { tool in
                            Text(tool.label).tag(tool)
                        }
                    } label: {
                        Label("Tool Call Theme", systemImage: "wrench.and.screwdriver")
                    }
                    Text("Mirrors your Mac's Appearance settings where sensible. Composer-shell theming is desktop-only for now.")
                        .font(.caption)
                        .foregroundStyle(TWTheme.textMuted)
                }
                Section("About") {
                    LabeledContent("App", value: "TaskWraith Remote")
                    LabeledContent("Transport", value: "taskwraith-e2ee-v1")
                }
            }
            .navigationTitle("Settings")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

/// Pins + Notes inspector tab — view/edit thread notes, view/unpin pinned
/// messages (pin FROM the transcript via the row context menu).
struct NotesPanel: View {
    @ObservedObject var model: RemoteSessionModel
    let threadId: String
    @State private var notesDraft: String = ""
    @State private var loadedFromSnapshot = false
    @FocusState private var notesFocused: Bool

    private var card: RemoteTaskCard? {
        model.taskCards.first { $0.id == threadId }
    }
    private var snapshot: RemoteThreadSnapshot? { model.threadSnapshots[threadId] }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Notes")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TWTheme.textTertiary)
            TextEditor(text: $notesDraft)
                .focused($notesFocused)
                .frame(minHeight: 110)
                .font(.footnote)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(TWTheme.surface1, in: RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10).strokeBorder(TWTheme.border)
                )
            if notesFocused || notesDraft != (snapshot?.notes ?? "") {
                Button {
                    card.map { model.setThreadNotes($0, notes: notesDraft) }
                    notesFocused = false
                } label: {
                    Text("Save notes")
                        .font(.caption.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(TWTheme.chroma1.opacity(0.18), in: Capsule())
                        .foregroundStyle(TWTheme.chroma1)
                }
                .buttonStyle(.plain)
            }

            Text("Pinned messages")
                .font(.caption.weight(.semibold))
                .foregroundStyle(TWTheme.textTertiary)
                .padding(.top, 4)
            let pins = snapshot?.pinnedRows ?? []
            if pins.isEmpty {
                Text("No pinned messages — long-press a transcript message to pin it.")
                    .font(.caption)
                    .foregroundStyle(TWTheme.textMuted)
            } else {
                ForEach(pins, id: \.id) { row in
                    HStack(alignment: .top, spacing: 7) {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(TWTheme.statusAttention)
                            .padding(.top, 3)
                        VStack(alignment: .leading, spacing: 2) {
                            if let speaker = row.speaker {
                                Text(speaker)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(TWTheme.textTertiary)
                            }
                            Text(row.preview ?? "")
                                .font(.caption)
                                .foregroundStyle(TWTheme.textPrimary)
                                .lineLimit(4)
                        }
                        Spacer(minLength: 4)
                        Button {
                            if let card {
                                model.toggleMessagePin(
                                    card, messageId: row.id, pinned: false)
                            }
                        } label: {
                            Image(systemName: "pin.slash")
                                .font(.caption2)
                                .foregroundStyle(TWTheme.textMuted)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(TWTheme.surface1, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .onAppear {
            if !loadedFromSnapshot {
                notesDraft = snapshot?.notes ?? ""
                loadedFromSnapshot = true
            }
        }
        .onChange(of: snapshot?.notes ?? "") { _, fresh in
            if !notesFocused { notesDraft = fresh }
        }
    }
}

// ── Graceful status banners (lifecycle + action feedback) ──────────────────
// Raw caption-text errors above the composer were hard to read; these are
// severity-tinted bubbles with white text, an icon, and a dismiss control.
// Errors persist until dismissed; informational acks auto-fade.

public enum TWBannerSeverity {
    case error, warning, info, success

    var fill: Color {
        switch self {
        case .error: return Color(hex: 0xC4373C)
        case .warning: return Color(hex: 0xB07816)
        case .info: return Color(hex: 0x2F5FBF)
        case .success: return Color(hex: 0x2E7D4F)
        }
    }

    var icon: String {
        switch self {
        case .error: return "exclamationmark.octagon.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .info: return "info.circle.fill"
        case .success: return "checkmark.circle.fill"
        }
    }
}

/// Heuristic severity from a bridge ack / transport message.
public func twBannerSeverity(for message: String) -> TWBannerSeverity {
    let lower = message.lowercased()
    if lower.contains("denied") || lower.contains("failed") || lower.contains("error")
        || lower.contains("not found") || lower.contains("did not dispatch")
    {
        return .error
    }
    if lower.contains("timeout") || lower.contains("timed out") || lower.contains("lost")
        || lower.contains("reconnect") || lower.contains("retry")
    {
        return .warning
    }
    if lower.contains("saved") || lower.contains("updated") || lower.contains("pinned")
        || lower.contains("started") || lower.contains("created") || lower.contains("sent")
    {
        return .success
    }
    return .info
}

/// Friendlier phrasing for the handful of raw messages users actually hit.
public func twFriendlyMessage(_ raw: String) -> String {
    let lower = raw.lowercased()
    if lower.contains("timeout") || lower.contains("timed out") {
        return "Your Mac didn't respond in time — it may be busy or asleep."
    }
    if lower.contains("not allowlisted") || lower.contains("denied") {
        return "This workspace doesn't allow that action from paired devices."
    }
    if lower.contains("did not dispatch") {
        return "The run couldn't start — check the provider's setup on your Mac."
    }
    return raw
}

public struct StatusBanner: View {
    let message: String
    let onDismiss: () -> Void

    public init(message: String, onDismiss: @escaping () -> Void) {
        self.message = message
        self.onDismiss = onDismiss
    }

    private var severity: TWBannerSeverity { twBannerSeverity(for: message) }

    public var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: severity.icon)
                .font(.caption)
                .padding(.top, 1)
            Text(twFriendlyMessage(message))
                .font(.footnote.weight(.medium))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.bold))
                    .opacity(0.7)
            }
            .buttonStyle(.plain)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(severity.fill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
        .padding(.horizontal, 10)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .task(id: message) {
            // Non-error feedback fades on its own; errors stay until read.
            let sev = severity
            if sev == .success || sev == .info {
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                onDismiss()
            }
        }
    }
}

/// Slim connection-state strip shown over the shell while a trusted
/// reconnect is in flight — the user stays exactly where they were.
public struct ConnectionBanner: View {
    public enum State {
        case reconnecting(detail: String?)
        case offline(detail: String?)
    }

    let state: State
    let onRetry: () -> Void

    public init(state: State, onRetry: @escaping () -> Void) {
        self.state = state
        self.onRetry = onRetry
    }

    public var body: some View {
        HStack(spacing: 8) {
            switch state {
            case .reconnecting:
                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
                Text("Reconnecting to your Mac…")
                    .font(.footnote.weight(.semibold))
            case .offline(let detail):
                Image(systemName: "wifi.exclamationmark")
                    .font(.caption)
                Text(detail ?? "Connection lost.")
                    .font(.footnote.weight(.semibold))
                    .lineLimit(2)
                Spacer(minLength: 4)
                Button("Retry", action: onRetry)
                    .font(.footnote.weight(.bold))
                    .buttonStyle(.plain)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            {
                if case .reconnecting = state {
                    return TWBannerSeverity.warning.fill
                }
                return TWBannerSeverity.error.fill
            }(),
            in: Capsule()
        )
        .padding(.horizontal, 12)
        .shadow(color: .black.opacity(0.3), radius: 8, y: 3)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

/// Per-workspace attached changes row (multi-grant runs): workspace name
/// tail + its own diff stats. First row keeps the rounded top corners.
public struct WorkspaceChangesAttachedRow: View {
    let breakdown: MobileDiffSummary.WorkspaceBreakdown
    let isFirst: Bool
    let action: () -> Void

    public init(
        breakdown: MobileDiffSummary.WorkspaceBreakdown, isFirst: Bool,
        action: @escaping () -> Void
    ) {
        self.breakdown = breakdown
        self.isFirst = isFirst
        self.action = action
    }

    private var nameTail: String {
        breakdown.workspacePath.split(separator: "/").last.map(String.init)
            ?? breakdown.workspacePath
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: "folder")
                    .font(.caption2)
                    .foregroundStyle(TWTheme.textTertiary)
                Text(nameTail)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(TWTheme.textPrimary)
                    .lineLimit(1)
                Text("\(breakdown.filesChanged ?? 0) file\((breakdown.filesChanged ?? 0) == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(TWTheme.textSecondary)
                if let additions = breakdown.additions, additions > 0 {
                    Text("+\(additions)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(TWTheme.statusSuccess)
                }
                if let deletions = breakdown.deletions, deletions > 0 {
                    Text("−\(deletions)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .foregroundStyle(TWTheme.statusFailed)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(TWTheme.textMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        }
        .buttonStyle(.plain)
    }
}
