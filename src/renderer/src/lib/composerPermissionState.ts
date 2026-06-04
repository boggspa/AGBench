import type { GeminiPermissionRequest } from './GeminiPermissionParser'

export interface ComposerPermissionState {
  paths: string[]
  message: string
  kind: GeminiPermissionRequest['kind'] | null
  source: GeminiPermissionRequest['source'] | null
}

export const EMPTY_PERMISSION_STATE: ComposerPermissionState = {
  paths: [],
  message: '',
  kind: null,
  source: null
}
