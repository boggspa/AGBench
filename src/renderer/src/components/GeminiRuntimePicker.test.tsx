// Phase M1 Step 6 — renderer-side tests for the Gemini runtime picker
// in the Settings panel. The repo's test environment is plain `node`
// (no jsdom / happy-dom), so we avoid event simulation and instead:
//
//   1. Render the component to static HTML via react-dom/server to
//      assert the bound state (which radio shows `aria-checked="true"`).
//   2. Invoke the component as a plain function to walk its returned
//      element tree, find the option button by `data-testid`, and call
//      its `onClick` handler directly. This is the same pattern other
//      DOM-free tests in this repo use (e.g. Sidebar.test.tsx asserts
//      via static markup, SubThreadDelegationCard.test.tsx invokes
//      exported pure helpers).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import { GeminiRuntimePicker, type GeminiRuntimePickerProps } from './SettingsPanel'
import type { GeminiApiRuntimeMode, GeminiAuthProfileSummary } from '../../../main/store/types'

function makeProps(overrides: Partial<GeminiRuntimePickerProps> = {}): GeminiRuntimePickerProps {
  return {
    value: 'auto',
    profiles: [],
    activeProfileId: null,
    onSelect: () => {},
    ...overrides
  }
}

function makeApiKeyProfile(
  overrides: Partial<GeminiAuthProfileSummary> = {}
): GeminiAuthProfileSummary {
  return {
    id: 'key-1',
    kind: 'api-key',
    label: 'API key profile',
    configured: true,
    isDefault: true,
    authState: 'authenticated',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

/**
 * Recursively walk a React element tree looking for an element whose
 * `data-testid` prop equals `testId`. Returns the props of the first
 * match, or null. The picker is shallow enough that this performs fine.
 */
function findElementByTestId(node: unknown, testId: string): Record<string, unknown> | null {
  if (!node) return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByTestId(child, testId)
      if (found) return found
    }
    return null
  }
  if (typeof node !== 'object') return null
  if (!isValidElement(node)) return null
  const props = (node as ReactElement).props as Record<string, unknown>
  if (props && props['data-testid'] === testId) {
    return props
  }
  // Recurse into children — React stores them as `children` in props.
  if (props && 'children' in props) {
    return findElementByTestId(props.children, testId)
  }
  return null
}

describe('GeminiRuntimePicker', () => {
  // Helper: extract the opening tag (attributes only) for a given
  // data-testid from the rendered HTML, so we can assert about
  // attributes regardless of source order.
  function tagFor(html: string, testId: string): string {
    const match = html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))
    if (match) return match[0]
    const altMatch = html
      .match(new RegExp(`<button[^>]*?>`, 'g'))
      ?.find((tag) => tag.includes(`data-testid="${testId}"`))
    return altMatch || ''
  }

  it('marks the Auto radio as checked when value="auto"', () => {
    const html = renderToStaticMarkup(<GeminiRuntimePicker {...makeProps({ value: 'auto' })} />)
    expect(html).toContain('data-testid="gemini-runtime-option-auto"')
    expect(tagFor(html, 'gemini-runtime-option-auto')).toContain('aria-checked="true"')
    // And the other two options should be aria-checked="false".
    expect(tagFor(html, 'gemini-runtime-option-always')).toContain('aria-checked="false"')
    expect(tagFor(html, 'gemini-runtime-option-never')).toContain('aria-checked="false"')
  })

  it('marks the Always radio as checked when value="always"', () => {
    const html = renderToStaticMarkup(<GeminiRuntimePicker {...makeProps({ value: 'always' })} />)
    expect(tagFor(html, 'gemini-runtime-option-always')).toContain('aria-checked="true"')
    expect(tagFor(html, 'gemini-runtime-option-auto')).toContain('aria-checked="false"')
  })

  it('calls onSelect with "always" when the Always API option is clicked', () => {
    const onSelect = vi.fn<(mode: GeminiApiRuntimeMode) => void>()
    const element = GeminiRuntimePicker(makeProps({ value: 'auto', onSelect }))
    const buttonProps = findElementByTestId(element, 'gemini-runtime-option-always')
    expect(buttonProps).not.toBeNull()
    const onClick = buttonProps && (buttonProps['onClick'] as (() => void) | undefined)
    expect(typeof onClick).toBe('function')
    onClick!()
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('always')
  })

  it('calls onSelect with "never" when the Always CLI option is clicked', () => {
    const onSelect = vi.fn<(mode: GeminiApiRuntimeMode) => void>()
    const element = GeminiRuntimePicker(makeProps({ value: 'auto', onSelect }))
    const buttonProps = findElementByTestId(element, 'gemini-runtime-option-never')
    expect(buttonProps).not.toBeNull()
    ;(buttonProps!['onClick'] as () => void)()
    expect(onSelect).toHaveBeenCalledWith('never')
  })

  it('renders the runtime status row with the correct kind for auto + api-key profile', () => {
    const html = renderToStaticMarkup(
      <GeminiRuntimePicker
        {...makeProps({
          value: 'auto',
          profiles: [makeApiKeyProfile()],
          activeProfileId: 'key-1'
        })}
      />
    )
    expect(html).toContain('data-kind="api"')
    expect(html).toContain('Runtime: API (in-process)')
  })

  it('renders the runtime status row with the warning kind for always + no api-key', () => {
    const html = renderToStaticMarkup(
      <GeminiRuntimePicker
        {...makeProps({
          value: 'always',
          profiles: [],
          activeProfileId: null
        })}
      />
    )
    expect(html).toContain('data-kind="api-misconfigured"')
    expect(html).toContain('runs will fail')
  })

  it('renders the runtime status row with cli kind for never (forced)', () => {
    const html = renderToStaticMarkup(
      <GeminiRuntimePicker
        {...makeProps({
          value: 'never',
          profiles: [makeApiKeyProfile()],
          activeProfileId: 'key-1'
        })}
      />
    )
    expect(html).toContain('data-kind="cli"')
    expect(html).toContain('CLI (forced)')
  })

  it('exposes the CLI deprecation note next to the picker', () => {
    const html = renderToStaticMarkup(<GeminiRuntimePicker {...makeProps()} />)
    expect(html).toContain('Gemini CLI is being deprecated')
    expect(html).toContain('in-process')
  })
})
