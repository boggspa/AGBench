const toDateTimeLocalValue = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatScheduledRunTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'unscheduled'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export { toDateTimeLocalValue, formatScheduledRunTime }
