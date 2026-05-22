export interface FileTypeMeta {
  kind: 'swift' | 'c' | 'cpp' | 'python' | 'shell' | 'metal' | 'cocoa' | 'generic'
  label: string
  glyph: string
}

const FILE_TYPES: Array<{ kind: FileTypeMeta['kind']; exts: string[] }> = [
  { kind: 'swift', exts: ['swift', 'swiftinterface'] },
  { kind: 'cpp', exts: ['cpp', 'cxx', 'cc', 'hxx', 'hpp', 'hh', 'h++'] },
  { kind: 'c', exts: ['c'] },
  { kind: 'python', exts: ['py', 'pyi', 'pyw'] },
  { kind: 'shell', exts: ['sh', 'bash', 'zsh', 'fish', 'ksh', 'csh', 'tcsh', 'command'] },
  { kind: 'metal', exts: ['metal', 'msl'] },
  {
    kind: 'cocoa',
    exts: ['m', 'mm', 'xib', 'storyboard', 'nib', 'pbxproj', 'entitlements', 'xcconfig']
  }
]

const SPECIAL_FILES: Record<string, FileTypeMeta> = {
  'package.swift': { kind: 'swift', label: 'Swift Package', glyph: 'S' },
  podfile: { kind: 'shell', label: 'Podfile', glyph: '$' },
  gemfile: { kind: 'shell', label: 'Gemfile', glyph: '$' },
  makefile: { kind: 'shell', label: 'Makefile', glyph: '$' }
}

const KIND_META: Record<FileTypeMeta['kind'], { label: string; glyph: string }> = {
  swift: { label: 'Swift', glyph: 'S' },
  cpp: { label: 'C++', glyph: 'C++' },
  c: { label: 'C', glyph: 'C' },
  python: { label: 'Python', glyph: 'Py' },
  shell: { label: 'Shell', glyph: '$' },
  metal: { label: 'Metal', glyph: 'MTL' },
  cocoa: { label: 'Cocoa', glyph: 'Ck' },
  generic: { label: 'File', glyph: 'F' }
}

export const getFileBaseName = (value: string): string => {
  if (!value) {
    return ''
  }
  return value.split(/[/\\]/).filter(Boolean).pop() || value
}

const getExtension = (value: string): string => {
  const name = getFileBaseName(value).toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) {
    return ''
  }
  return name.slice(dot + 1)
}

export const getFileTypeMeta = (path: string): FileTypeMeta => {
  const fileName = getFileBaseName(path).toLowerCase()
  const extension = getExtension(path)

  if (SPECIAL_FILES[fileName]) {
    return SPECIAL_FILES[fileName]
  }

  for (const entry of FILE_TYPES) {
    if (entry.exts.includes(extension)) {
      return { kind: entry.kind, ...KIND_META[entry.kind] }
    }
  }

  if (
    fileName.includes('makefile') ||
    fileName.includes('podfile') ||
    fileName.includes('gemfile')
  ) {
    return { kind: 'shell', ...KIND_META.shell }
  }

  if (
    fileName.endsWith('.h') ||
    fileName.endsWith('.hpp') ||
    fileName.endsWith('.hh') ||
    fileName.endsWith('.hxx')
  ) {
    return { kind: 'cpp', ...KIND_META.cpp }
  }

  if (fileName.endsWith('.swift') || fileName.endsWith('.swiftinterface')) {
    return { kind: 'swift', ...KIND_META.swift }
  }

  return { kind: 'generic', ...KIND_META.generic }
}
