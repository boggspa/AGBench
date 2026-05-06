import { describe, it, expect } from 'vitest';
import { parseGitStatusZ, classifyStatus, generateSyntheticNewFileDiff, computeRunDiff } from './DiffService';

describe('DiffService', () => {
  describe('parseGitStatusZ', () => {
    it('parses modified file', () => {
      const input = ' M README.md\0';
      const result = parseGitStatusZ(input);
      expect(result).toEqual([{ statusCode: 'M', filePath: 'README.md' }]);
    });
    it('parses untracked file', () => {
      const input = '?? HelloWorldView.swift\0';
      const result = parseGitStatusZ(input);
      expect(result).toEqual([{ statusCode: '??', filePath: 'HelloWorldView.swift' }]);
    });
    it('parses filenames with spaces using -z output', () => {
      const input = '?? my file.txt\0';
      const result = parseGitStatusZ(input);
      expect(result).toEqual([{ statusCode: '??', filePath: 'my file.txt' }]);
    });
    it('parses multiple entries', () => {
      const input = ' M README.md\0?? new.txt\0';
      const result = parseGitStatusZ(input);
      expect(result).toHaveLength(2);
      expect(result[1].filePath).toBe('new.txt');
    });
  });

  describe('classifyStatus', () => {
    it('classifies ?? as untracked', () => {
      expect(classifyStatus('??')).toBe('untracked');
    });
    it('classifies A as created', () => {
      expect(classifyStatus('A')).toBe('created');
    });
    it('classifies D as deleted', () => {
      expect(classifyStatus('D')).toBe('deleted');
    });
    it('classifies R as renamed', () => {
      expect(classifyStatus('R')).toBe('renamed');
    });
    it('classifies M as modified', () => {
      expect(classifyStatus('M')).toBe('modified');
    });
  });

  describe('generateSyntheticNewFileDiff', () => {
    it('generates synthetic diff for new file', () => {
      const text = generateSyntheticNewFileDiff('HelloWorldView.swift', 'line1\nline2');
      expect(text).toContain('diff --git a/HelloWorldView.swift b/HelloWorldView.swift');
      expect(text).toContain('new file mode 100644');
      expect(text).toContain('--- /dev/null');
      expect(text).toContain('+++ b/HelloWorldView.swift');
      expect(text).toContain('+line1');
      expect(text).toContain('+line2');
    });
  });

  describe('computeRunDiff', () => {
    it('marks file created during run', () => {
      const pre: any = { isGitRepo: true, gitStatus: '' };
      const post: any = { isGitRepo: true, gitStatus: '?? new.swift\0' };
      const result = computeRunDiff(pre, post, 'run1');
      expect(result.createdFiles).toHaveLength(1);
      expect(result.createdFiles[0].path).toBe('new.swift');
      expect(result.preExistingFiles).toHaveLength(0);
    });
    it('marks pre-existing dirty file', () => {
      const pre: any = { isGitRepo: true, gitStatus: ' M old.swift\0' };
      const post: any = { isGitRepo: true, gitStatus: ' M old.swift\0' };
      const result = computeRunDiff(pre, post, 'run1');
      expect(result.preExistingFiles).toHaveLength(1);
      expect(result.preExistingFiles[0].path).toBe('old.swift');
      expect(result.modifiedFiles).toHaveLength(0);
    });
    it('marks modified tracked file during run', () => {
      const pre: any = { isGitRepo: true, gitStatus: 'A old.swift\0' };
      const post: any = { isGitRepo: true, gitStatus: ' M old.swift\0' };
      const result = computeRunDiff(pre, post, 'run1');
      expect(result.modifiedFiles).toHaveLength(1);
      expect(result.modifiedFiles[0].path).toBe('old.swift');
    });
    it('marks untracked new file during run', () => {
      const pre: any = { isGitRepo: true, gitStatus: '' };
      const post: any = { isGitRepo: true, gitStatus: '?? GEMINI.md\0' };
      const result = computeRunDiff(pre, post, 'run1');
      expect(result.createdFiles).toHaveLength(1);
      expect(result.createdFiles[0].path).toBe('GEMINI.md');
    });
    it('marks deleted file during run', () => {
      const pre: any = { isGitRepo: true, gitStatus: ' M gone.swift\0' };
      const post: any = { isGitRepo: true, gitStatus: '' };
      const result = computeRunDiff(pre, post, 'run1');
      expect(result.deletedFiles).toHaveLength(1);
      expect(result.deletedFiles[0].path).toBe('gone.swift');
    });
    it('handles non-git file snapshots', () => {
      const pre: any = { isGitRepo: false, files: [{ path: 'a.txt', sizeBytes: 10, mtimeMs: 1 }] };
      const post: any = { isGitRepo: false, files: [{ path: 'a.txt', sizeBytes: 10, mtimeMs: 1 }, { path: 'b.txt', sizeBytes: 5, mtimeMs: 2 }] };
      const result = computeRunDiff(pre, post, 'run1');
      expect(result.createdFiles).toHaveLength(1);
      expect(result.createdFiles[0].path).toBe('b.txt');
    });
  });
});
