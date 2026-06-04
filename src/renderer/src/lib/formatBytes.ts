/**
 * Humanise a raw byte count to B / KB / MB so inspector rows read
 * "180 KB" instead of "184320 bytes". Mirrors the formatter in
 * FileEditorPanel; kept local because that one isn't exported.
 */
export const formatBytes = (value?: number): string => {
  if (value === undefined || !Number.isFinite(value)) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
