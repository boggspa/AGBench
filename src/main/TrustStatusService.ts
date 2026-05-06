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
      return realpathSync(path);
    } catch {
      return path; // Fallback if file doesn't exist yet
    }
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

      let trustedPaths: string[] = [];

      // Defensive parsing
      if (Array.isArray(parsed)) {
        trustedPaths = parsed;
      } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.trustedFolders)) {
        trustedPaths = parsed.trustedFolders;
      } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.folders)) {
        trustedPaths = parsed.folders;
      } else {
        return { status: 'unknown', reason: 'Trust file schema unknown' };
      }

      const targetPath = this.safeRealpath(workspacePath);

      for (const tPath of trustedPaths) {
        if (typeof tPath !== 'string') continue;
        const resolvedTPath = this.safeRealpath(tPath);
        
        if (resolvedTPath === targetPath) {
          return { status: 'trusted' };
        }
        
        // Check if targetPath is inside resolvedTPath (inherited)
        // Add trailing slash to ensure we match whole folder names
        if (targetPath.startsWith(resolvedTPath + '/') || targetPath.startsWith(resolvedTPath + '\\')) {
          return { status: 'inherited', reason: `Inherited from ${resolvedTPath}` };
        }
      }

      return { status: 'untrusted' };

    } catch (error: any) {
      return { status: 'unknown', reason: `Error checking trust: ${error.message}` };
    }
  }
}
