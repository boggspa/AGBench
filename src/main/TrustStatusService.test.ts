import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TrustStatusService } from './TrustStatusService'
import fs from 'fs'
import os from 'os'

vi.mock('fs')
vi.mock('os')

describe('TrustStatusService', () => {
  const mockHome = '/mock/home'
  const mockWorkspace = '/mock/workspace'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(os.homedir).mockReturnValue(mockHome)
  })

  it('returns not_checked when trust file does not exist', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw { code: 'ENOENT' }
    })
    const result = TrustStatusService.checkTrust(mockWorkspace)
    expect(result.status).toBe('not_checked')
  })

  it('returns trusted when workspace is exactly in trust file', () => {
    const trustedPaths = [mockWorkspace]
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(trustedPaths))
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString())

    const result = TrustStatusService.checkTrust(mockWorkspace)
    expect(result.status).toBe('trusted')
  })

  it('returns inherited when parent workspace is in trust file', () => {
    const trustedPaths = ['/mock']
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(trustedPaths))
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString())

    const result = TrustStatusService.checkTrust(mockWorkspace)
    expect(result.status).toBe('inherited')
  })

  it('returns untrusted when workspace is not in trust file', () => {
    const trustedPaths = ['/other/path']
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(trustedPaths))
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString())

    const result = TrustStatusService.checkTrust(mockWorkspace)
    expect(result.status).toBe('untrusted')
  })

  it('handles object schema with trustedFolders array', () => {
    const content = JSON.stringify({ trustedFolders: [mockWorkspace] })
    vi.mocked(fs.readFileSync).mockReturnValue(content)
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString())

    const result = TrustStatusService.checkTrust(mockWorkspace)
    expect(result.status).toBe('trusted')
  })

  it('handles Gemini CLI object-map trust files', () => {
    const content = JSON.stringify({
      '/mock': 'DO_NOT_TRUST',
      [mockWorkspace]: 'TRUST_FOLDER'
    })
    vi.mocked(fs.readFileSync).mockReturnValue(content)
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString())

    const result = TrustStatusService.checkTrust(mockWorkspace)
    expect(result.status).toBe('trusted')
  })

  it('uses the nearest inherited object-map entry', () => {
    const content = JSON.stringify({
      '/mock': 'DO_NOT_TRUST',
      '/mock/workspace-parent': 'TRUST_FOLDER'
    })
    vi.mocked(fs.readFileSync).mockReturnValue(content)
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString())

    const result = TrustStatusService.checkTrust('/mock/workspace-parent/project')
    expect(result.status).toBe('inherited')
    expect(result.reason).toContain('/mock/workspace-parent')
  })

  it('canonicalizes native realpath casing before applying parent deny rules', () => {
    const content = JSON.stringify({
      '/Users/dev': 'DO_NOT_TRUST',
      '/users/chrisizatt/documents/dungeons of darkness': 'TRUST_FOLDER'
    })
    vi.mocked(fs.readFileSync).mockReturnValue(content)
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString())
    vi.mocked(fs.realpathSync.native).mockImplementation((p) => {
      const raw = p.toString()
      return raw.toLowerCase() === '/users/chrisizatt/documents/dungeons of darkness'
        ? '/Users/dev/Documents/Dungeons of Darkness'
        : raw
    })

    const result = TrustStatusService.checkTrust('/Users/dev/Documents/Dungeons of Darkness')
    expect(result.status).toBe('trusted')
  })

  it('returns unknown when trust file is corrupt', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('corrupt {')
    const result = TrustStatusService.checkTrust(mockWorkspace)
    expect(result.status).toBe('unknown')
    expect(result.reason).toContain('not valid JSON')
  })

  describe('trustWorkspace (#272 one-click persistent trust)', () => {
    const originalPlatform = process.platform

    beforeEach(() => {
      // Identity realpath so paths stay verbatim in assertions.
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString())
      if (fs.realpathSync.native) {
        vi.mocked(fs.realpathSync.native).mockImplementation((p) => p.toString())
      }
      // Force darwin so the casing-dedup path is deterministic on any host.
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    })

    const lastWrite = (): { path: string; content: any } => {
      const call = vi.mocked(fs.writeFileSync).mock.calls.at(-1)
      expect(call).toBeTruthy()
      const [writtenPath, writtenContent] = call as [string, string]
      return { path: writtenPath, content: JSON.parse(writtenContent) }
    }

    it('writes TRUST_FOLDER into a brand-new trust file', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw { code: 'ENOENT' }
      })

      const result = TrustStatusService.trustWorkspace(mockWorkspace)

      expect(result.ok).toBe(true)
      expect(result.status).toBe('trusted')
      expect(result.path).toBe(mockWorkspace)
      // Creates ~/.gemini before writing.
      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/home/.gemini', { recursive: true })
      const { path, content } = lastWrite()
      expect(path).toBe('/mock/home/.gemini/trustedFolders.json')
      expect(content).toEqual({ [mockWorkspace]: 'TRUST_FOLDER' })
    })

    it('preserves existing entries (incl. DO_NOT_TRUST) and adds the target', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ '/other': 'TRUST_FOLDER', '/blocked': 'DO_NOT_TRUST' })
      )

      const result = TrustStatusService.trustWorkspace(mockWorkspace)

      expect(result.ok).toBe(true)
      const { content } = lastWrite()
      expect(content['/other']).toBe('TRUST_FOLDER')
      expect(content['/blocked']).toBe('DO_NOT_TRUST')
      expect(content[mockWorkspace]).toBe('TRUST_FOLDER')
    })

    it('collapses casing-variant duplicate keys for the same folder', () => {
      // Pre-existing mis-cased entry for the same folder the user is now
      // trusting — the bug this fixes is two keys for one folder.
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ '/Users/Me/Proj': 'TRUST_FOLDER' })
      )

      const result = TrustStatusService.trustWorkspace('/users/me/proj')

      expect(result.ok).toBe(true)
      const { content } = lastWrite()
      const keys = Object.keys(content)
      expect(keys).toHaveLength(1)
      expect(content['/users/me/proj']).toBe('TRUST_FOLDER')
    })

    it('flips a previously DO_NOT_TRUST target to TRUST_FOLDER', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ [mockWorkspace]: 'DO_NOT_TRUST' })
      )

      TrustStatusService.trustWorkspace(mockWorkspace)

      const { content } = lastWrite()
      expect(content[mockWorkspace]).toBe('TRUST_FOLDER')
    })

    it('rejects an empty workspace path without writing', () => {
      const result = TrustStatusService.trustWorkspace('')
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('No workspace path')
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('starts fresh from a clean map when the existing file is corrupt', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('not json {')

      const result = TrustStatusService.trustWorkspace(mockWorkspace)

      expect(result.ok).toBe(true)
      const { content } = lastWrite()
      expect(content).toEqual({ [mockWorkspace]: 'TRUST_FOLDER' })
    })
  })
})
