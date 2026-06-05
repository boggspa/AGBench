export type MacUpdateArtifactArch = 'universal' | 'arm64' | 'x64' | 'unknown'

export interface UpdateFileLike {
  url?: string
  path?: string
}

export interface UpdateInfoLike {
  path?: string
  files?: UpdateFileLike[]
}

export interface UpdateArchitectureCompatibility {
  platform: string
  arch: string
  artifactName?: string
  artifactArch: MacUpdateArtifactArch
  compatible: boolean
  reason?: string
}

export function selectedMacUpdateArtifact(info: UpdateInfoLike): string | undefined {
  const path = cleanArtifactName(info.path)
  if (path) return path
  const files = Array.isArray(info.files) ? info.files : []
  const zipFile = files
    .map((file) => cleanArtifactName(file.url || file.path))
    .find((name) => Boolean(name && name.toLowerCase().endsWith('.zip')))
  if (zipFile) return zipFile
  return files.map((file) => cleanArtifactName(file.url || file.path)).find(Boolean)
}

export function classifyMacUpdateArtifact(name: string | undefined): MacUpdateArtifactArch {
  const cleanName = cleanArtifactName(name)?.toLowerCase()
  if (!cleanName) return 'unknown'
  if (/\buniversal\b|[-_.]universal[-_.]/i.test(cleanName)) return 'universal'
  if (/\barm64\b|[-_.]arm64[-_.]/i.test(cleanName)) return 'arm64'
  if (/\bx64\b|\bx86_64\b|[-_.](?:x64|x86_64)[-_.]/i.test(cleanName)) return 'x64'
  // electron-builder's universal mac zip commonly has no arch token.
  // Treat the conventional shared mac zip as universal at runtime; the
  // release-feed validator still enforces explicit universal naming for
  // publish safety when configured to do so.
  if (/(?:^|[-_.])mac\.zip$/i.test(cleanName)) return 'universal'
  return 'unknown'
}

export function evaluateUpdateArchitectureCompatibility(
  info: UpdateInfoLike,
  host: { platform: string; arch: string }
): UpdateArchitectureCompatibility {
  const artifactName = selectedMacUpdateArtifact(info)
  const artifactArch = classifyMacUpdateArtifact(artifactName)
  const base: UpdateArchitectureCompatibility = {
    platform: host.platform,
    arch: host.arch,
    ...(artifactName ? { artifactName } : {}),
    artifactArch,
    compatible: true
  }

  if (host.platform !== 'darwin') return base
  if (host.arch !== 'x64' && host.arch !== 'arm64') return base
  if (artifactArch === 'unknown') {
    return {
      ...base,
      reason: `Unknown mac update artifact architecture: ${artifactName || 'none'}`
    }
  }
  if (artifactArch === 'universal' || artifactArch === host.arch) return base
  return {
    ...base,
    compatible: false,
    reason: `Incompatible update artifact: host=darwin-${host.arch} artifact=${artifactArch}`
  }
}

function cleanArtifactName(value: string | undefined): string | undefined {
  if (!value || typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const withoutQuery = trimmed.split(/[?#]/)[0]
  return withoutQuery.split('/').filter(Boolean).pop() || withoutQuery
}
