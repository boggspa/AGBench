import { describe, it, expect } from 'vitest'
import { describeExternalPath } from './ExternalPathRepoDetect'

describe('describeExternalPath', () => {
  it('returns the path basename for a non-repo path', () => {
    expect(describeExternalPath('/Users/me/Downloads/file.txt')).toEqual({
      isRepo: false,
      repoRoot: '/Users/me/Downloads/file.txt',
      basename: 'file.txt'
    })
  })

  it('returns repo descriptor when gitMetadata indicates a repo', () => {
    expect(
      describeExternalPath('/Users/me/code/AGBench/src/main.ts', {
        gitMetadata: { isRepo: true, repoRoot: '/Users/me/code/AGBench', branch: 'main' }
      })
    ).toEqual({
      isRepo: true,
      repoRoot: '/Users/me/code/AGBench',
      basename: 'AGBench',
      branch: 'main',
      repoName: 'AGBench'
    })
  })

  it('falls back to non-repo when gitMetadata is null', () => {
    expect(describeExternalPath('/Users/me/code/some-folder', { gitMetadata: null })).toEqual({
      isRepo: false,
      repoRoot: '/Users/me/code/some-folder',
      basename: 'some-folder'
    })
  })

  it('falls back to non-repo when gitMetadata.isRepo is false', () => {
    expect(
      describeExternalPath('/Users/me/code/dummy', {
        gitMetadata: { isRepo: false, repoRoot: '' }
      })
    ).toEqual({
      isRepo: false,
      repoRoot: '/Users/me/code/dummy',
      basename: 'dummy'
    })
  })

  it('handles trailing slashes on the input path', () => {
    expect(describeExternalPath('/Users/me/folder/')).toEqual({
      isRepo: false,
      repoRoot: '/Users/me/folder',
      basename: 'folder'
    })
  })

  it('keeps repo basename even when the queried path is deep inside', () => {
    expect(
      describeExternalPath('/Users/me/code/Big-Project/src/nested/deep/file.swift', {
        gitMetadata: {
          isRepo: true,
          repoRoot: '/Users/me/code/Big-Project',
          branch: 'feature/x'
        }
      })
    ).toEqual({
      isRepo: true,
      repoRoot: '/Users/me/code/Big-Project',
      basename: 'Big-Project',
      branch: 'feature/x',
      repoName: 'Big-Project'
    })
  })

  it('repo with detached HEAD has no branch field', () => {
    expect(
      describeExternalPath('/Users/me/code/Repo', {
        gitMetadata: { isRepo: true, repoRoot: '/Users/me/code/Repo' }
      })
    ).toEqual({
      isRepo: true,
      repoRoot: '/Users/me/code/Repo',
      basename: 'Repo',
      branch: undefined,
      repoName: 'Repo'
    })
  })

  it('returns "/" basename for the root path', () => {
    expect(describeExternalPath('/')).toEqual({
      isRepo: false,
      repoRoot: '/',
      basename: '/'
    })
  })
})
