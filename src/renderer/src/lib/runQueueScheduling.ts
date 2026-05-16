import type { ProviderId } from '../../../main/store/types'

export function findNextRunnableQueueIndex<T extends { provider: ProviderId }>(
  jobs: T[],
  isProviderBusy: (provider: ProviderId) => boolean
): number {
  if (!jobs || jobs.length === 0) return -1
  return jobs.findIndex((job) => !isProviderBusy(job.provider))
}
