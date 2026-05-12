import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, realpathSync } from 'fs';
import { TrustStatusResult } from './store/types';

export class TrustStatusService {
  private static getTrustedFoldersPath(): string {
    if (process.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH) {
      return process.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH;
    }
    return join(homedir(), '.gemini', 'trustedFolders.json');
  }

  private static safeRealpath(path: string): string {
    try {
      const nativeRealpath = typeof realpathSync.native === 'function'
        ? realpathSync.native
        : realpathSync;
      const resolved = nativeRealpath(path);
      return typeof resolved === 'string' ? resolved : path;
    } catch {
      return path; // Fallback if file doesn't exist yet
    }
  }

  private static normalizePathForComparison(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    return process.platform === 'darwin' ? normalized.toLocaleLowerCase() : normalized;
  }

  private static normalizeTrustedFolders(parsed: any): Array<{ path: string; status: string }> | null {
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string')
        .map((path) => ({ path, status: 'TRUST_FOLDER' }));
    }

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (Array.isArray(parsed.trustedFolders)) {
      return parsed.trustedFolders
        .filter((item: unknown): item is string => typeof item === 'string')
        .map((path: string) => ({ path, status: 'TRUST_FOLDER' }));
    }

    if (Array.isArray(parsed.folders)) {
      return parsed.folders
        .filter((item: unknown): item is string => typeof item === 'string')
        .map((path: string) => ({ path, status: 'TRUST_FOLDER' }));
    }

    const entries = Object.entries(parsed)
      .filter(([path, status]) => typeof path === 'string' && typeof status === 'string')
      .map(([path, status]) => ({ path, status: String(status) }));

    return entries.length > 0 ? entries : null;
  }

  private static trustResultForStatus(status: string, inheritedFrom?: string): TrustStatusResult | null {
    const normalized = status.toUpperCase();
    if (normalized === 'DO_NOT_TRUST' || normalized === 'UNTRUSTED') {
      return { status: 'untrusted', reason: inheritedFrom ? `Blocked by ${inheritedFrom}` : undefined };
    }
    if (normalized === 'TRUST_FOLDER' || normalized === 'TRUST_PARENT' || normalized === 'TRUSTED') {
      return inheritedFrom
        ? { status: 'inherited', reason: `Inherited from ${inheritedFrom}` }
        : { status: 'trusted' };
    }
    return null;
  }

  public static checkTrust(workspacePath: string): TrustStatusResult {
    try {
      const trustFilePath = this.getTrustedFoldersPath();
      let content: string;
      try {
        content = readFileSync(trustFilePath, 'utf8');
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          return { status: 'not_checked', reason: 'No trust file found' };
        }
        return { status: 'unknown', reason: `Failed to read trust file: ${err.message}` };
      }

      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        return { status: 'unknown', reason: 'Trust file is not valid JSON' };
      }

      const trustedEntries = this.normalizeTrustedFolders(parsed);
      if (!trustedEntries) {
        return { status: 'unknown', reason: 'Trust file schema unknown' };
      }

      const targetPath = this.safeRealpath(workspacePath);
      const targetKey = this.normalizePathForComparison(targetPath);
      const resolvedEntries = trustedEntries
        .map((entry) => {
          const path = this.safeRealpath(entry.path);
          return {
            path,
            key: this.normalizePathForComparison(path),
            status: entry.status
          };
        })
        .filter((entry) => entry.path);

      const exact = resolvedEntries.find((entry) => entry.key === targetKey);
      const exactResult = exact ? this.trustResultForStatus(exact.status) : null;
      if (exactResult) {
        return exactResult;
      }

      const inherited = resolvedEntries
        .filter((entry) => targetKey.startsWith(entry.key + '/'))
        .sort((a, b) => b.key.length - a.key.length)[0];
      const inheritedResult = inherited ? this.trustResultForStatus(inherited.status, inherited.path) : null;
      if (inheritedResult) {
        return inheritedResult;
      }

      return { status: 'untrusted' };

    } catch (error: any) {
      return { status: 'unknown', reason: `Error checking trust: ${error.message}` };
    }
  }
}
