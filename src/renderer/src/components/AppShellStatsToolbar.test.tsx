import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppShellStatsToolbar } from './AppShellStatsToolbar'

describe('AppShellStatsToolbar', () => {
  it('renders unavailable CPU/RAM as explicit placeholders', () => {
    const html = renderToStaticMarkup(
      <AppShellStatsToolbar
        initialSnapshot={{
          schemaVersion: 1,
          sampledAt: 1,
          sampleWindowMs: 0,
          cpuPercent: null,
          ramPercent: null,
          ramUsedMB: null,
          activeThreadCount: 0,
          processCount: 0
        }}
      />
    )

    expect(html).toContain('TaskWraith app stats')
    expect(html).toContain('TaskWraith Electron CPU --')
    expect(html).toContain('TaskWraith Electron RAM --')
    expect(html).toContain('Running TaskWraith threads 0')
    expect(html).toContain('>CPU</span>')
    expect(html).toContain('>Memory</span>')
    expect(html).toContain('>Threads</span>')
    expect(html).not.toContain('app-shell-stat-detail')
  })

  it('renders compact app-only CPU, RAM, and running-thread values', () => {
    const html = renderToStaticMarkup(
      <AppShellStatsToolbar
        initialSnapshot={{
          schemaVersion: 1,
          sampledAt: 1,
          sampleWindowMs: 2_000,
          cpuPercent: 3.8,
          ramPercent: 12.4,
          ramUsedMB: 2048,
          activeThreadCount: 2,
          processCount: 4
        }}
      />
    )

    expect(html).toContain('3.8%')
    expect(html).toContain('TaskWraith Electron RAM 12.4% 2.0GB')
    expect(html).toContain('Running TaskWraith threads 2')
  })
})
