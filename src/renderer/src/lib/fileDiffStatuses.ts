import type { DiffFileSummary } from '../../../main/store/types'

export const FILE_DIFF_STATUSES = new Set<DiffFileSummary['status']>([
  'created',
  'modified',
  'deleted',
  'renamed',
  'untracked',
  'binary',
  'too_large',
  'hidden_sensitive'
])
