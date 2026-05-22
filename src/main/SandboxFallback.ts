export function isCodexSandboxToolingFailure(output: string): boolean {
  const text = String(output || '')
  if (!text.trim()) return false
  const lower = text.toLowerCase()

  if (/sandbox-exec:\s*sandbox_apply:\s*operation not permitted/i.test(text)) {
    return true
  }

  if (
    lower.includes('operation not permitted') &&
    (lower.includes('sandbox') ||
      lower.includes('swiftpm') ||
      lower.includes('swift package manager') ||
      lower.includes('xcode') ||
      lower.includes('xcrun'))
  ) {
    return true
  }

  if (
    /swiftpm|swift package manager|xcode|xcrun|\.build|sourcepackages/i.test(text) &&
    /(cache|config|configuration|library|deriveddata).{0,120}(not writable|permission denied|operation not permitted|denied)/i.test(
      text
    )
  ) {
    return true
  }

  if (
    /(not writable|permission denied|operation not permitted|denied)/i.test(text) &&
    /(?:~\/Library|\/Library\/Caches|\/Library\/Preferences|\/Library\/Developer|org\.swift\.swiftpm|swiftpm)/i.test(
      text
    )
  ) {
    return true
  }

  return false
}

export function isSwiftPmCommand(command: unknown): boolean {
  const text = Array.isArray(command)
    ? command.map((part) => String(part || '')).join(' ')
    : String(command || '')
  return /\bswift\s+(test|run|package\s+dump-package)\b/i.test(text)
}

export function isSwiftPmNestedSandboxFailure(command: unknown, output: string): boolean {
  return isSwiftPmCommand(command) && isCodexSandboxToolingFailure(output)
}
