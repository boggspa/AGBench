import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrustStatusService } from './TrustStatusService';
import fs from 'fs';
import os from 'os';

vi.mock('fs');
vi.mock('os');

describe('TrustStatusService', () => {
  const mockHome = '/mock/home';
  const mockWorkspace = '/mock/workspace';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHome);
  });

  it('returns not_checked when trust file does not exist', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw { code: 'ENOENT' };
    });
    const result = TrustStatusService.checkTrust(mockWorkspace);
    expect(result.status).toBe('not_checked');
  });

  it('returns trusted when workspace is exactly in trust file', () => {
    const trustedPaths = [mockWorkspace];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(trustedPaths));
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
    
    const result = TrustStatusService.checkTrust(mockWorkspace);
    expect(result.status).toBe('trusted');
  });

  it('returns inherited when parent workspace is in trust file', () => {
    const trustedPaths = ['/mock'];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(trustedPaths));
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
    
    const result = TrustStatusService.checkTrust(mockWorkspace);
    expect(result.status).toBe('inherited');
  });

  it('returns untrusted when workspace is not in trust file', () => {
    const trustedPaths = ['/other/path'];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(trustedPaths));
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
    
    const result = TrustStatusService.checkTrust(mockWorkspace);
    expect(result.status).toBe('untrusted');
  });

  it('handles object schema with trustedFolders array', () => {
    const content = JSON.stringify({ trustedFolders: [mockWorkspace] });
    vi.mocked(fs.readFileSync).mockReturnValue(content);
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
    
    const result = TrustStatusService.checkTrust(mockWorkspace);
    expect(result.status).toBe('trusted');
  });

  it('handles Gemini CLI object-map trust files', () => {
    const content = JSON.stringify({
      '/mock': 'DO_NOT_TRUST',
      [mockWorkspace]: 'TRUST_FOLDER'
    });
    vi.mocked(fs.readFileSync).mockReturnValue(content);
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());

    const result = TrustStatusService.checkTrust(mockWorkspace);
    expect(result.status).toBe('trusted');
  });

  it('uses the nearest inherited object-map entry', () => {
    const content = JSON.stringify({
      '/mock': 'DO_NOT_TRUST',
      '/mock/workspace-parent': 'TRUST_FOLDER'
    });
    vi.mocked(fs.readFileSync).mockReturnValue(content);
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());

    const result = TrustStatusService.checkTrust('/mock/workspace-parent/project');
    expect(result.status).toBe('inherited');
    expect(result.reason).toContain('/mock/workspace-parent');
  });

  it('canonicalizes native realpath casing before applying parent deny rules', () => {
    const content = JSON.stringify({
      '/Users/dev': 'DO_NOT_TRUST',
      '/users/chrisizatt/documents/dungeons of darkness': 'TRUST_FOLDER'
    });
    vi.mocked(fs.readFileSync).mockReturnValue(content);
    vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
    vi.mocked(fs.realpathSync.native).mockImplementation((p) => {
      const raw = p.toString();
      return raw.toLowerCase() === '/users/chrisizatt/documents/dungeons of darkness'
        ? '/Users/dev/Documents/Dungeons of Darkness'
        : raw;
    });

    const result = TrustStatusService.checkTrust('/Users/dev/Documents/Dungeons of Darkness');
    expect(result.status).toBe('trusted');
  });

  it('returns unknown when trust file is corrupt', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('corrupt {');
    const result = TrustStatusService.checkTrust(mockWorkspace);
    expect(result.status).toBe('unknown');
    expect(result.reason).toContain('not valid JSON');
  });
});
