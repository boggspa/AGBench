import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { DiffFileSummary, DiffFileStatus, DiffPreviewKind, WorkspaceSnapshot, RunDiffResult, FileSnapshot } from './store/types';

const NOISE_PATHS = ['.DS_Store', 'Thumbs.db', 'node_modules', 'dist', 'build', '.vite'];
const SENSITIVE_PATTERNS = [/\.env$/i, /\.pem$/i, /\.key$/i, /secret/i, /password/i, /token/i];
const MAX_PREVIEW_SIZE = 1024 * 100; // 100KB

function isNoiseFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return NOISE_PATHS.some(n => basename === n || filePath.includes(`/${n}/`));
}

function isSensitiveFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return SENSITIVE_PATTERNS.some(p => p.test(lower));
}

function isBinaryFile(filePath: string): boolean {
  try {
    const buffer = fs.readFileSync(filePath);
    for (let i = 0; i < Math.min(buffer.length, 8000); i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function resolveWorkspacePath(workspace: string, filePath: string): string | null {
  const resolved = path.resolve(workspace, filePath);
  const rel = path.relative(workspace, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

async function spawnGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, code: -1 });
    });
  });
}

function spawnGitSync(cwd: string, args: string[]): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('git', args, { cwd, shell: false, encoding: 'utf-8' });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    code: result.status ?? 0,
  };
}

function countDiffLines(diffText: string): { additions?: number; deletions?: number } {
  if (!diffText.trim()) {
    return {};
  }
  const lines = diffText.split('\n');
  return {
    additions: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
    deletions: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length,
  };
}

export function parseGitStatusZ(statusOutput: string): Array<{ statusCode: string; filePath: string }> {
  const entries: Array<{ statusCode: string; filePath: string }> = [];
  const parts = statusOutput.split('\0');
  let i = 0;
  while (i < parts.length) {
    const entry = parts[i];
    if (!entry || entry.length < 3) { i++; continue; }
    const statusCode = entry.substring(0, 2);
    let filePath = entry.substring(3);
    // For renames, the next part is the original path
    if (statusCode.startsWith('R') && i + 1 < parts.length) {
      filePath = parts[i + 1];
      i += 2;
    } else {
      i++;
    }
    entries.push({ statusCode: statusCode.trim(), filePath });
  }
  return entries;
}

export function classifyStatus(statusCode: string): DiffFileStatus {
  if (statusCode === '??') return 'untracked';
  if (statusCode === '!!') return 'noise';
  if (statusCode === 'A') return 'created';
  if (statusCode === 'D') return 'deleted';
  if (statusCode.startsWith('R')) return 'renamed';
  if (statusCode.startsWith('M') || statusCode.endsWith('M')) return 'modified';
  return 'modified';
}

export function generateSyntheticNewFileDiff(filePath: string, content: string): string {
  const lines = content.split('\n');
  const header = `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@`;
  const body = lines.map(l => '+' + l).join('\n');
  return header + '\n' + body;
}

function buildCurrentFileSummary(workspace: string | undefined, filePath: string, status: DiffFileStatus): DiffFileSummary {
  const baseSummary: DiffFileSummary = {
    path: filePath,
    status,
    previewKind: 'none',
    isNoise: isNoiseFile(filePath),
    isSensitive: isSensitiveFile(filePath),
  };

  if (!workspace) {
    return baseSummary;
  }

  const fullPath = resolveWorkspacePath(workspace, filePath);
  if (!fullPath) {
    return baseSummary;
  }

  const exists = fs.existsSync(fullPath);
  const sizeBytes = exists ? fs.statSync(fullPath).size : 0;
  let previewKind: DiffPreviewKind = 'none';
  let diffText: string | undefined;
  let isBinary = false;
  let additions: number | undefined;
  let deletions: number | undefined;

  if (baseSummary.isSensitive) {
    previewKind = 'hidden';
  } else if ((status === 'created' || status === 'untracked') && exists && !fs.statSync(fullPath).isDirectory()) {
    isBinary = isBinaryFile(fullPath);
    if (isBinary) {
      previewKind = 'binary';
    } else if (sizeBytes <= MAX_PREVIEW_SIZE) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      diffText = generateSyntheticNewFileDiff(filePath, content);
      previewKind = 'synthetic_new_file';
      additions = content.split('\n').length;
      deletions = 0;
    }
  } else if (status === 'modified' || status === 'deleted' || status === 'renamed') {
    const unstagedDiff = spawnGitSync(workspace, ['diff', '--no-ext-diff', '--', filePath]).stdout;
    const stagedDiff = spawnGitSync(workspace, ['diff', '--cached', '--no-ext-diff', '--', filePath]).stdout;
    const currentDiff = [stagedDiff, unstagedDiff].filter(text => text.trim()).join('\n');
    if (currentDiff.trim()) {
      diffText = currentDiff;
      previewKind = 'git_diff';
      const counts = countDiffLines(currentDiff);
      additions = counts.additions;
      deletions = counts.deletions;
    }
  }

  return {
    ...baseSummary,
    additions,
    deletions,
    isBinary,
    previewKind,
    diffText,
    sizeBytes,
  };
}

export async function getWorkspaceDiff(workspace: string): Promise<{ type: string; text?: string; statusText?: string; diffText?: string; summaries?: DiffFileSummary[] }> {
  const { stdout: statusOut, stderr: statusErr } = await spawnGit(workspace, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (statusErr.includes('not a git repository')) {
    return { type: 'not_repo', text: 'This folder is not a git repository. Run git init if you want diff tracking.' };
  }

  const { stdout: diffOut } = await spawnGit(workspace, ['diff', '--no-ext-diff']);

  if (!statusOut.trim() && !diffOut.trim()) {
    return { type: 'no_changes', text: 'No changes were made.' };
  }

  const statusEntries = parseGitStatusZ(statusOut);

  const summaries: DiffFileSummary[] = [];
  const diffChunks: Record<string, string> = {};

  // Parse git diff chunks
  if (diffOut) {
    const parts = diffOut.split(/^diff --git/m);
    for (const part of parts) {
      if (!part.trim()) continue;
      const match = part.match(/^ a\/(.*?)\s+b\//);
      if (match) {
        const fp = match[1];
        diffChunks[fp] = 'diff --git' + part;
      }
    }
  }

  for (const entry of statusEntries) {
    const status = classifyStatus(entry.statusCode);
    const fullPath = resolveWorkspacePath(workspace, entry.filePath);
    if (!fullPath) continue;

    const isNoise = isNoiseFile(entry.filePath);
    const isSensitive = isSensitiveFile(entry.filePath);
    const sizeBytes = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;

    let previewKind: DiffPreviewKind = 'none';
    let diffText: string | undefined;
    let isBinary = false;
    let additions: number | undefined;
    let deletions: number | undefined;

    if (isSensitive) {
      previewKind = 'hidden';
    } else if (status === 'untracked' || status === 'created') {
      if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isDirectory()) {
        isBinary = isBinaryFile(fullPath);
        if (isBinary) {
          previewKind = 'binary';
        } else if (sizeBytes > MAX_PREVIEW_SIZE) {
          previewKind = 'none';
        } else {
          const content = fs.readFileSync(fullPath, 'utf-8');
          diffText = generateSyntheticNewFileDiff(entry.filePath, content);
          previewKind = 'synthetic_new_file';
          additions = content.split('\n').length;
          deletions = 0;
        }
      }
    } else if (diffChunks[entry.filePath]) {
      previewKind = 'git_diff';
      diffText = diffChunks[entry.filePath];
      // Parse additions/deletions from diff text
      const addMatch = diffText.match(/^(\+[^+])/gm);
      const delMatch = diffText.match(/^(-[^-])/gm);
      additions = addMatch?.length;
      deletions = delMatch?.length;
    }

    summaries.push({
      path: entry.filePath,
      status,
      additions,
      deletions,
      isBinary,
      isNoise,
      isSensitive,
      previewKind,
      diffText,
      sizeBytes,
    });
  }

  return {
    type: 'changes',
    statusText: statusOut,
    diffText: diffOut,
    summaries,
  };
}

export async function captureWorkspaceSnapshot(workspace: string): Promise<WorkspaceSnapshot> {
  const { stdout: statusOut, stderr: statusErr } = await spawnGit(workspace, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const isGitRepo = !statusErr.includes('not a git repository');

  if (isGitRepo) {
    return {
      capturedAt: new Date().toISOString(),
      isGitRepo: true,
      workspacePath: workspace,
      gitStatus: statusOut,
    };
  }

  // Non-git: lightweight file tree snapshot
  const files: FileSnapshot[] = [];
  function walk(dir: string, base: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (isNoiseFile(entry.name)) continue;
      const rel = path.relative(workspace, path.join(dir, entry.name));
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), base);
      } else {
        const stat = fs.statSync(path.join(dir, entry.name));
        files.push({
          path: rel,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  }
  try { walk(workspace, workspace); } catch { /* ignore */ }

  return {
    capturedAt: new Date().toISOString(),
    isGitRepo: false,
    workspacePath: workspace,
    files,
  };
}

export function computeRunDiff(pre: WorkspaceSnapshot, post: WorkspaceSnapshot, runId: string): RunDiffResult {
  const createdFiles: DiffFileSummary[] = [];
  const modifiedFiles: DiffFileSummary[] = [];
  const deletedFiles: DiffFileSummary[] = [];
  const preExistingFiles: DiffFileSummary[] = [];
  const workspace = post.workspacePath || pre.workspacePath;

  if (pre.isGitRepo && post.isGitRepo && typeof pre.gitStatus === 'string' && typeof post.gitStatus === 'string') {
    const preEntries = parseGitStatusZ(pre.gitStatus);
    const postEntries = parseGitStatusZ(post.gitStatus);

    const preMap = new Map(preEntries.map(e => [e.filePath, e]));
    const postMap = new Map(postEntries.map(e => [e.filePath, e]));

    for (const [filePath, postEntry] of postMap) {
      const status = classifyStatus(postEntry.statusCode);
      const preEntry = preMap.get(filePath);

      if (!preEntry) {
        // Didn't exist before run
        if (status === 'untracked' || status === 'created') {
          createdFiles.push(buildCurrentFileSummary(workspace, filePath, 'created'));
        } else {
          modifiedFiles.push(buildCurrentFileSummary(workspace, filePath, 'modified'));
        }
      } else {
        const preStatus = classifyStatus(preEntry.statusCode);
        if (preStatus === status) {
          // Unchanged status: pre-existing
          preExistingFiles.push({ path: filePath, status, previewKind: 'none' });
        } else {
          // Changed during run
          modifiedFiles.push(buildCurrentFileSummary(workspace, filePath, 'modified'));
        }
      }
    }

    for (const [filePath] of preMap) {
      if (!postMap.has(filePath)) {
        deletedFiles.push(buildCurrentFileSummary(workspace, filePath, 'deleted'));
      }
    }
  } else if (!pre.isGitRepo && !post.isGitRepo && pre.files && post.files) {
    const preMap = new Map(pre.files.map(f => [f.path, f]));
    const postMap = new Map(post.files.map(f => [f.path, f]));

    for (const [filePath, postFile] of postMap) {
      const preFile = preMap.get(filePath);
      if (!preFile) {
        createdFiles.push(buildCurrentFileSummary(workspace, filePath, 'created'));
      } else if (preFile.mtimeMs !== postFile.mtimeMs || preFile.sizeBytes !== postFile.sizeBytes) {
        modifiedFiles.push(buildCurrentFileSummary(workspace, filePath, 'modified'));
      }
    }

    for (const [filePath] of preMap) {
      if (!postMap.has(filePath)) {
        deletedFiles.push(buildCurrentFileSummary(workspace, filePath, 'deleted'));
      }
    }
  }

  return {
    runId,
    preSnapshot: pre,
    postSnapshot: post,
    createdFiles,
    modifiedFiles,
    deletedFiles,
    preExistingFiles,
  };
}
