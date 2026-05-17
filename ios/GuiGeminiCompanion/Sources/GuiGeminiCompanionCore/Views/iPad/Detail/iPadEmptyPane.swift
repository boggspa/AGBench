import SwiftUI

/// Empty / no-selection state shown by `iPadDetailHost`. Replaces the
/// old single illustration with a three-up grid of teaching cards that
/// explain what the user will see when they tap a workspace, a thread,
/// or watch the approval queue. Cards use `Theme.cardGlassBackground`
/// to match the rest of the iPad shell density.
@available(iOS 17.0, macOS 14.0, *)
public struct iPadEmptyPane: View {
    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.section) {
                heroHeader
                teachingGrid
                Spacer(minLength: 0)
            }
            .padding(Theme.Spacing.screen)
        }
        .scrollIndicators(.hidden)
    }

    private var heroHeader: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.control) {
            Image(systemName: "rectangle.3.group")
                .font(Theme.Typography.iconHero)
                .foregroundStyle(Theme.accent)
                .frame(width: 72, height: 72)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            VStack(alignment: .leading, spacing: 6) {
                Text("Pick something to inspect")
                    .font(Theme.Typography.screenTitle)
                    .foregroundStyle(Theme.primaryText)
                Text("The iPad mirrors workspace + thread context from your paired Mac so you can keep tabs on agent runs without switching machines.")
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
    }

    private var teachingGrid: some View {
        let columns = [
            GridItem(.adaptive(minimum: 220, maximum: .infinity), spacing: Theme.Spacing.section)
        ]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.section) {
            ForEach(iPadDetailSampleData.emptyPaneTeachingCards) { card in
                teachingCard(card)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func teachingCard(_ card: iPadDetailSampleData.TeachingCard) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.tight) {
            Image(systemName: card.systemImage)
                .font(Theme.Typography.iconMedium)
                .foregroundStyle(Theme.accent)
                .frame(width: 44, height: 44)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
                .padding(.bottom, 4)
            Text(card.title)
                .font(Theme.Typography.sectionTitle)
                .foregroundStyle(Theme.primaryText)
                .lineLimit(2)
            Text(card.body)
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(Theme.Spacing.section)
        .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
        .cardGlassBackground(cornerRadius: Theme.Radius.panel)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(card.title)
        .accessibilityValue(card.body)
    }
}

// MARK: - Previews

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad empty pane — mocked teaching cards") {
    iPadEmptyPane()
        .frame(minWidth: 720, minHeight: 540)
        .background(Theme.windowBase)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("iPad empty pane — narrow") {
    iPadEmptyPane()
        .frame(minWidth: 420, minHeight: 720)
        .background(Theme.windowBase)
}
