import fs from 'fs'
import path from 'path'

const MAX_TREE_ENTRIES = 72
const MAX_TREE_DEPTH = 3
const MAX_SYMBOL_LINES = 36
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  'vendor',
  '.turbo',
  '.cache'
])

export interface OllamaWorkspaceIndexOptions {
  maxEntries?: number
  maxDepth?: number
  maxSymbolLines?: number
}

function toRelative(root: string, fullPath: string): string {
  return path.relative(root, fullPath).replace(/\\/g, '/') || '.'
}

function walkWorkspaceTree(
  workspacePath: string,
  options: Required<OllamaWorkspaceIndexOptions>,
  entries: string[] = [],
  dirPath = workspacePath,
  depth = 0
): string[] {
  if (entries.length >= options.maxEntries || depth > options.maxDepth) return entries
  let dirents: fs.Dirent[]
  try {
    dirents = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return entries
  }
  dirents.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const dirent of dirents) {
    if (entries.length >= options.maxEntries) break
    if (dirent.name.startsWith('.') && dirent.name !== '.env') continue
    if (dirent.isDirectory() && SKIP_DIRS.has(dirent.name)) continue
    const fullPath = path.join(dirPath, dirent.name)
    const rel = toRelative(workspacePath, fullPath)
    entries.push(dirent.isDirectory() ? `${rel}/` : rel)
    if (dirent.isDirectory()) {
      walkWorkspaceTree(workspacePath, options, entries, fullPath, depth + 1)
    }
  }
  return entries
}

function sampleWorkspaceSymbols(workspacePath: string, maxLines: number): string[] {
  const pattern =
    /^\s*(?:(?:export|public|private|internal|open|final|static)\s+)*(class|function|interface|type|enum|const|let|var|struct|actor|protocol|func)\s+[A-Za-z_][A-Za-z0-9_]*/
  const symbols: string[] = []
  const stack = [workspacePath]
  while (stack.length > 0 && symbols.length < maxLines) {
    const dir = stack.pop()!
    let dirents: fs.Dirent[]
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (symbols.length >= maxLines) break
      const fullPath = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        if (dirent.name.startsWith('.') || SKIP_DIRS.has(dirent.name)) continue
        stack.push(fullPath)
        continue
      }
      if (!/\.(ts|tsx|js|jsx|py|go|rs|swift|java|kt|cs|zig|rb|php|m|mm|h|hpp|cpp|c)$/i.test(dirent.name)) {
        continue
      }
      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile() || stat.size > 256_000) continue
        const text = fs.readFileSync(fullPath, 'utf8')
        for (const line of text.split(/\r?\n/)) {
          if (symbols.length >= maxLines) break
          if (pattern.test(line)) {
            symbols.push(`${toRelative(workspacePath, fullPath)}: ${line.trim().slice(0, 120)}`)
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }
  return symbols
}

/** Shallow workspace map injected before the first Ollama tool turn. */
export function buildOllamaWorkspaceIndexBlock(
  workspacePath: string,
  options: OllamaWorkspaceIndexOptions = {}
): string {
  const resolved = path.resolve(workspacePath)
  if (!fs.existsSync(resolved)) return ''
  const resolvedOptions = {
    maxEntries: options.maxEntries ?? MAX_TREE_ENTRIES,
    maxDepth: options.maxDepth ?? MAX_TREE_DEPTH,
    maxSymbolLines: options.maxSymbolLines ?? MAX_SYMBOL_LINES
  }
  const tree = walkWorkspaceTree(resolved, resolvedOptions)
  const symbols = sampleWorkspaceSymbols(resolved, resolvedOptions.maxSymbolLines)
  if (tree.length === 0 && symbols.length === 0) return ''
  const lines = [
    'Workspace index (pre-run — use this before list_directory loops):',
    'Shallow file tree:'
  ]
  for (const entry of tree) lines.push(`- ${entry}`)
  if (symbols.length > 0) {
    lines.push('', 'Sample symbols:')
    for (const symbol of symbols) lines.push(`- ${symbol}`)
  }
  lines.push('', 'Prefer workspace_search → read one file over wide directory walks.')
  return lines.join('\n')
}
