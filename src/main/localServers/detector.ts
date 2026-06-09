/*
 * Local-server detector factory. Platform-pluggable seam so the service is
 * platform-agnostic: darwin → MacDetector, win32 → WindowsDetector (Phase D),
 * anything else → a Null detector that reports detection unavailable.
 */

import { MacDetector } from './MacDetector'
import { WindowsDetector } from './WindowsDetector'
import type { LocalServerDetector, LocalServerDetectorContext, LocalServersSnapshot } from './types'

/** Detector for unsupported platforms — reports detectionAvailable: false. */
export class NullDetector implements LocalServerDetector {
  readonly platform: NodeJS.Platform
  constructor(platform: NodeJS.Platform) {
    this.platform = platform
  }
  async detect(_ctx: LocalServerDetectorContext): Promise<LocalServersSnapshot> {
    return {
      sampledAt: new Date().toISOString(),
      servers: [],
      platform: this.platform,
      detectionAvailable: false
    }
  }
}

export function createDetectorForPlatform(platform: NodeJS.Platform): LocalServerDetector {
  if (platform === 'darwin') return new MacDetector()
  if (platform === 'win32') return new WindowsDetector()
  return new NullDetector(platform)
}
