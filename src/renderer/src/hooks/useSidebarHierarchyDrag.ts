import { useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { SidebarHierarchySectionId } from '../lib/sidebarSectionOrder'

interface DragGhostState {
  sectionId: SidebarHierarchySectionId
  label: string
  x: number
  y: number
  offsetX: number
  offsetY: number
}

function findSectionUnderPointer(x: number, y: number): SidebarHierarchySectionId | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const section = el?.closest('[data-sidebar-section-id]') as HTMLElement | null
  const id = section?.dataset.sidebarSectionId
  if (!id) return null
  return id as SidebarHierarchySectionId
}

export function useSidebarHierarchyDrag(
  order: SidebarHierarchySectionId[],
  onReorder: (next: SidebarHierarchySectionId[]) => void
): {
  dragGhost: DragGhostState | null
  handleSectionPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    sectionId: SidebarHierarchySectionId,
    label: string
  ) => void
  sectionDragClass: (sectionId: SidebarHierarchySectionId) => string
  sectionOrderStyle: (sectionId: SidebarHierarchySectionId) => { order: number }
} {
  const [dragId, setDragId] = useState<SidebarHierarchySectionId | null>(null)
  const [dragOverId, setDragOverId] = useState<SidebarHierarchySectionId | null>(null)
  const [dragGhost, setDragGhost] = useState<DragGhostState | null>(null)

  const handleReorder = useCallback(
    (sourceId: SidebarHierarchySectionId, targetId: SidebarHierarchySectionId | null) => {
      setDragId(null)
      setDragOverId(null)
      setDragGhost(null)
      if (!targetId || sourceId === targetId) return
      const fromIdx = order.indexOf(sourceId)
      const toIdx = order.indexOf(targetId)
      if (fromIdx === -1 || toIdx === -1) return
      const next = [...order]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      onReorder(next)
    },
    [order, onReorder]
  )

  const handleSectionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, sectionId: SidebarHierarchySectionId, label: string) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement
      if (
        target.closest(
          '.sidebar-section-header-action, .sidebar-overflow-trigger, .sidebar-local-servers-count'
        )
      ) {
        return
      }
      if (!target.closest('.sidebar-section-header-toggle')) return

      const toggle = target.closest('.sidebar-section-header-toggle') as HTMLElement
      const rect = toggle.getBoundingClientRect()
      const offsetX = event.clientX - rect.left
      const offsetY = event.clientY - rect.top
      const startX = event.clientX
      const startY = event.clientY
      let dragged = false

      const handleMove = (moveEvent: PointerEvent): void => {
        const dx = Math.abs(moveEvent.clientX - startX)
        const dy = Math.abs(moveEvent.clientY - startY)
        if (!dragged && (dx > 6 || dy > 6)) {
          dragged = true
          setDragId(sectionId)
          setDragGhost({
            sectionId,
            label,
            x: moveEvent.clientX - offsetX,
            y: moveEvent.clientY - offsetY,
            offsetX,
            offsetY
          })
        }
        if (dragged) {
          setDragGhost((current) =>
            current
              ? {
                  ...current,
                  x: moveEvent.clientX - current.offsetX,
                  y: moveEvent.clientY - current.offsetY
                }
              : null
          )
          const overId = findSectionUnderPointer(moveEvent.clientX, moveEvent.clientY)
          setDragOverId(overId && overId !== sectionId ? overId : null)
        }
      }

      const handleUp = (upEvent: PointerEvent): void => {
        document.removeEventListener('pointermove', handleMove)
        document.removeEventListener('pointerup', handleUp)
        document.removeEventListener('pointercancel', handleUp)
        if (dragged) {
          const dropId = findSectionUnderPointer(upEvent.clientX, upEvent.clientY)
          handleReorder(sectionId, dropId && dropId !== sectionId ? dropId : null)
        }
      }

      document.addEventListener('pointermove', handleMove)
      document.addEventListener('pointerup', handleUp)
      document.addEventListener('pointercancel', handleUp)
    },
    [handleReorder]
  )

  const sectionDragClass = useCallback(
    (sectionId: SidebarHierarchySectionId): string => {
      const parts: string[] = []
      if (dragId === sectionId) parts.push('is-dragging')
      if (dragOverId === sectionId) parts.push('is-drag-over')
      return parts.join(' ')
    },
    [dragId, dragOverId]
  )

  const sectionOrderStyle = useCallback(
    (sectionId: SidebarHierarchySectionId): { order: number } => ({
      order: Math.max(0, order.indexOf(sectionId))
    }),
    [order]
  )

  return {
    dragGhost,
    handleSectionPointerDown,
    sectionDragClass,
    sectionOrderStyle
  }
}
