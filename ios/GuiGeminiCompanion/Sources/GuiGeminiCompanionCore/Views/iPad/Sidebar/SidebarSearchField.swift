import SwiftUI

/// Compact search field used at the top of the iPad sidebar. Filters the
/// workspace + thread lists by case-insensitive substring match. When a
/// query is active the field renders an inline result count + clear button.
@available(iOS 17.0, macOS 14.0, *)
struct SidebarSearchField: View {
    @Binding var query: String
    let resultCount: Int?
    let isFocused: FocusState<Bool>.Binding

    var body: some View {
        HStack(spacing: Theme.Spacing.tight) {
            Image(systemName: "magnifyingglass")
                .font(Theme.Typography.caption)
                .foregroundStyle(isFocused.wrappedValue ? Theme.accent : Theme.tertiaryText)
                .frame(width: 18)
                .accessibilityHidden(true)
            TextField("Filter workspaces & threads", text: $query)
                .textFieldStyle(.plain)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.primaryText)
                .focused(isFocused)
                .submitLabel(.search)
                .autocorrectionDisabled(true)
                #if canImport(UIKit)
                .textInputAutocapitalization(.never)
                #endif
                .accessibilityLabel("Filter workspaces and threads")
                .accessibilityHint("Type to filter the sidebar lists.")
            if !query.isEmpty {
                if let resultCount {
                    Text("\(resultCount)")
                        .font(Theme.Typography.smallCaption)
                        .foregroundStyle(Theme.secondaryText)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Theme.inputSurface, in: Capsule(style: .continuous))
                        .accessibilityLabel("\(resultCount) results")
                }
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.tertiaryText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear filter")
            }
        }
        .padding(.horizontal, Theme.Spacing.control)
        .padding(.vertical, 9)
        .background {
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .fill(Theme.inputSurface)
        }
        .overlay {
            RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous)
                .stroke(
                    isFocused.wrappedValue ? Theme.accent.opacity(0.55) : Theme.border,
                    lineWidth: isFocused.wrappedValue ? 1.5 : 1
                )
        }
        .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.control, style: .continuous))
        .animation(Theme.Motion.quick, value: isFocused.wrappedValue)
        .animation(Theme.Motion.quick, value: query)
    }
}

#if DEBUG
@available(iOS 17.0, macOS 14.0, *)
private struct SidebarSearchFieldPreviewHost: View {
    @State var query: String
    let resultCount: Int?
    @FocusState var focused: Bool

    var body: some View {
        VStack(spacing: Theme.Spacing.section) {
            SidebarSearchField(
                query: $query,
                resultCount: resultCount,
                isFocused: $focused
            )
        }
        .padding(Theme.Spacing.screen)
        .frame(maxWidth: 360)
    }
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("Sidebar search · empty") {
    SidebarSearchFieldPreviewHost(query: "", resultCount: nil)
        .background(Theme.sidebarBase)
}

@available(iOS 17.0, macOS 14.0, *)
#Preview("Sidebar search · active") {
    SidebarSearchFieldPreviewHost(query: "agb", resultCount: 4)
        .background(Theme.sidebarBase)
}
#endif
