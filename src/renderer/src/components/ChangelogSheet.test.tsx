import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChangelogSheet, formatReleaseNotes, resolveChangelogEntry } from './ChangelogSheet'
import { UpdatePill } from './UpdatePill'
import type { ProductChangelogSnapshot } from '../../../main/store/types'
import type { UpdateStateSnapshot } from '../../../main/UpdateService'

const changelogSnapshot: ProductChangelogSnapshot = {
  currentVersion: '1.0.72',
  lastSeenChangelogVersion: '1.0.71'
}

describe('UpdatePill', () => {
  it('stays hidden for quiet update states', () => {
    const html = renderToStaticMarkup(
      <UpdatePill
        snapshot={{ status: 'idle', enabled: true, channel: 'stable' }}
        onOpen={() => {}}
      />
    )
    expect(html).toBe('')
  })

  it('renders an accent pill for available updates', () => {
    const html = renderToStaticMarkup(
      <UpdatePill
        snapshot={{
          status: 'available',
          enabled: true,
          channel: 'stable',
          latestVersion: '1.0.73'
        }}
        onOpen={() => {}}
      />
    )
    expect(html).toContain('chat-corner-update-pill-available')
    expect(html).toContain('Update 1.0.73')
  })

  it('renders download progress for downloading updates', () => {
    const html = renderToStaticMarkup(
      <UpdatePill
        snapshot={{
          status: 'downloading',
          enabled: true,
          channel: 'stable',
          latestVersion: '1.0.73',
          downloadProgress: {
            bytesPerSecond: 10,
            delta: 1,
            percent: 42.4,
            transferred: 42,
            total: 100
          }
        }}
        onOpen={() => {}}
      />
    )
    expect(html).toContain('chat-corner-update-pill-downloading')
    expect(html).toContain('42%')
  })
})

describe('ChangelogSheet', () => {
  it('returns null when closed', () => {
    const html = renderToStaticMarkup(
      <ChangelogSheet
        open={false}
        onDismiss={() => {}}
        changelogSnapshot={changelogSnapshot}
        updateSnapshot={null}
      />
    )
    expect(html).toBe('')
  })

  it('shows release notes and download action for available updates', () => {
    const updateSnapshot: UpdateStateSnapshot = {
      status: 'available',
      enabled: true,
      channel: 'stable',
      latestVersion: '1.0.73',
      releaseName: 'TaskWraith 1.0.73',
      releaseDate: '2026-06-04T12:00:00.000Z',
      releaseNotes: 'Updater pill and changelog sheet.'
    }
    const html = renderToStaticMarkup(
      <ChangelogSheet
        open
        onDismiss={() => {}}
        changelogSnapshot={changelogSnapshot}
        updateSnapshot={updateSnapshot}
        onDownloadUpdate={() => {}}
      />
    )
    expect(html).toContain('changelog-sheet-backdrop')
    expect(html).toContain('TaskWraith 1.0.73')
    expect(html).toContain('Updater pill and changelog sheet.')
    expect(html).toContain('Download update')
  })

  it('shows restart action for downloaded updates', () => {
    const html = renderToStaticMarkup(
      <ChangelogSheet
        open
        onDismiss={() => {}}
        changelogSnapshot={changelogSnapshot}
        updateSnapshot={{
          status: 'downloaded',
          enabled: true,
          channel: 'stable',
          latestVersion: '1.0.73',
          releaseNotes: 'Ready.'
        }}
        onInstallUpdateNow={() => {}}
      />
    )
    expect(html).toContain('Restart to install')
  })

  it('falls back to the bundled changelog when release notes are missing', () => {
    const html = renderToStaticMarkup(
      <ChangelogSheet
        open
        onDismiss={() => {}}
        changelogSnapshot={changelogSnapshot}
        updateSnapshot={null}
      />
    )
    expect(html).toContain('Bundled changelog')
    expect(html).toContain('TaskWraith')
  })

  it('formats full changelog arrays from electron-updater metadata', () => {
    expect(
      formatReleaseNotes([
        { version: '1.0.73', note: 'New update UI.' },
        { version: '1.0.72', note: null }
      ])
    ).toBe('## 1.0.73\nNew update UI.')
  })

  it('prefers live update metadata over pending changelog snapshots', () => {
    const entry = resolveChangelogEntry(
      {
        currentVersion: '1.0.72',
        pendingUpdateChangelog: {
          version: '1.0.72',
          releaseNotes: 'Current app.'
        }
      },
      {
        status: 'available',
        enabled: true,
        channel: 'stable',
        latestVersion: '1.0.73',
        releaseNotes: 'Available app.'
      }
    )
    expect(entry).toMatchObject({
      version: '1.0.73',
      releaseNotes: 'Available app.'
    })
  })
})
