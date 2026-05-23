import type { ReactNode } from 'react'
import type { ToolActivity } from '../../../main/store/types'
import {
  creativeTimelineDiffModelFromActivity,
  creativeTimelineItemLabel,
  type CreativeTimelineChangedItemSummary,
  type CreativeTimelineDiffCardModel,
  type CreativeTimelineDiffItemSummary,
  type CreativeTimelineProjectSummary
} from './CreativeTimelineDiffCardModel'

interface CreativeTimelineDiffCardProps {
  activity: ToolActivity
}

function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path
}

function countLabel(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function itemMeta(item: CreativeTimelineDiffItemSummary): string {
  return [item.type, item.refName, item.duration].filter(Boolean).join(' / ')
}

function ResourceChips({
  label,
  resources
}: {
  label: string
  resources: Array<{ id: string; name: string }>
}) {
  if (resources.length === 0) return null
  return (
    <div className="creative-timeline-resource-row">
      <span className="creative-timeline-resource-label">{label}</span>
      <span className="creative-timeline-resource-chips">
        {resources.slice(0, 6).map((resource) => (
          <span key={resource.id} className="creative-timeline-resource-chip" title={resource.id}>
            {resource.name}
          </span>
        ))}
        {resources.length > 6 && (
          <span className="creative-timeline-resource-chip muted">+{resources.length - 6}</span>
        )}
      </span>
    </div>
  )
}

function TimelineItem({
  item,
  tone,
  fields
}: {
  item: CreativeTimelineDiffItemSummary
  tone: 'added' | 'removed' | 'changed'
  fields?: string[]
}) {
  return (
    <li className={`creative-timeline-item tone-${tone}`}>
      <span className="creative-timeline-item-name">{creativeTimelineItemLabel(item)}</span>
      <span className="creative-timeline-item-meta">{itemMeta(item) || 'timeline item'}</span>
      {fields && fields.length > 0 && (
        <span className="creative-timeline-field-list">{fields.slice(0, 4).join(', ')}</span>
      )}
    </li>
  )
}

function ChangedTimelineItem({ item }: { item: CreativeTimelineChangedItemSummary }) {
  return (
    <TimelineItem
      item={item.after}
      tone="changed"
      fields={item.fields.length > 0 ? item.fields : item.after.fields}
    />
  )
}

function ProjectChangeSection({
  title,
  children,
  count
}: {
  title: string
  children: ReactNode
  count: number
}) {
  if (count === 0) return null
  return (
    <div className="creative-timeline-project-section">
      <div className="creative-timeline-project-section-title">
        <span>{title}</span>
        <span>{count}</span>
      </div>
      <ul className="creative-timeline-item-list">{children}</ul>
    </div>
  )
}

function ProjectDiff({ project }: { project: CreativeTimelineProjectSummary }) {
  return (
    <section className="creative-timeline-project">
      <header className="creative-timeline-project-header">
        <span className="creative-timeline-project-title">{project.title}</span>
        {project.eventName && <span className="creative-timeline-event">{project.eventName}</span>}
      </header>
      {project.fields.length > 0 && (
        <div className="creative-timeline-project-fields">{project.fields.join(', ')}</div>
      )}
      <div className="creative-timeline-project-grid">
        <ProjectChangeSection title="Added" count={project.addedItems.length}>
          {project.addedItems.slice(0, 4).map((item) => (
            <TimelineItem key={`added-${item.index}`} item={item} tone="added" />
          ))}
        </ProjectChangeSection>
        <ProjectChangeSection title="Changed" count={project.changedItems.length}>
          {project.changedItems.slice(0, 4).map((item) => (
            <ChangedTimelineItem key={`changed-${item.index}`} item={item} />
          ))}
        </ProjectChangeSection>
        <ProjectChangeSection title="Removed" count={project.removedItems.length}>
          {project.removedItems.slice(0, 4).map((item) => (
            <TimelineItem key={`removed-${item.index}`} item={item} tone="removed" />
          ))}
        </ProjectChangeSection>
      </div>
    </section>
  )
}

function summaryStats(
  model: CreativeTimelineDiffCardModel
): Array<{ label: string; value: string }> {
  return [
    { label: 'Added', value: String(model.summary.addedItemCount) },
    { label: 'Changed', value: String(model.summary.changedItemCount) },
    { label: 'Removed', value: String(model.summary.removedItemCount) },
    {
      label: 'Affected',
      value: countLabel(
        model.summary.affectedAssetCount + model.summary.affectedEffectCount,
        'resource'
      )
    }
  ]
}

export function CreativeTimelineDiffCard({ activity }: CreativeTimelineDiffCardProps) {
  const model = creativeTimelineDiffModelFromActivity(activity)
  if (!model) return null

  const truncated = model.summary.beforeTruncated || model.summary.afterTruncated

  return (
    <article className="creative-timeline-diff-card" aria-label="Creative timeline diff">
      <header className="creative-timeline-diff-header">
        <div className="creative-timeline-diff-title-row">
          <span className="creative-timeline-app-chip">Final Cut Pro</span>
          <span className="creative-timeline-diff-title">Timeline diff</span>
          {truncated && <span className="creative-timeline-warning-chip">Truncated</span>}
        </div>
        <div className="creative-timeline-path-row">
          <span title={model.beforePath}>{basename(model.beforePath)}</span>
          <span aria-hidden>{'->'}</span>
          <span title={model.afterPath}>{basename(model.afterPath)}</span>
        </div>
      </header>

      <div className="creative-timeline-stat-grid">
        {summaryStats(model).map((stat) => (
          <span key={stat.label} className="creative-timeline-stat">
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </span>
        ))}
      </div>

      <div className="creative-timeline-guard-row" aria-label="Approval safeguards">
        <span>Source unchanged</span>
        <span>Apply to copy</span>
        <span title={model.beforePath}>Rollback: {basename(model.beforePath)}</span>
      </div>

      {model.projects.length > 0 && (
        <div className="creative-timeline-projects">
          {model.projects.slice(0, 3).map((project) => (
            <ProjectDiff key={project.index} project={project} />
          ))}
          {model.projects.length > 3 && (
            <div className="creative-timeline-overflow">+{model.projects.length - 3} projects</div>
          )}
        </div>
      )}

      <div className="creative-timeline-resources">
        <ResourceChips label="Assets" resources={model.affectedAssets} />
        <ResourceChips label="Effects" resources={model.affectedEffects} />
      </div>

      {model.sidecarPath && (
        <div className="creative-timeline-sidecar">
          <span>Sidecar</span>
          <code title={model.sidecarPath}>{model.sidecarPath}</code>
        </div>
      )}

      {model.warnings.length > 0 && (
        <div className="creative-timeline-warnings">
          {model.warnings.slice(0, 2).map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}
    </article>
  )
}
