export const MIN_GEMINI_TERMINAL_HEIGHT = 150
export const DEFAULT_GEMINI_TERMINAL_HEIGHT = 260
export const MAX_GEMINI_TERMINAL_HEIGHT_RATIO = 0.55

export const clampGeminiTerminalHeight = (value: number): number => {
  const maxHeight = Math.max(
    MIN_GEMINI_TERMINAL_HEIGHT,
    Math.floor(window.innerHeight * MAX_GEMINI_TERMINAL_HEIGHT_RATIO)
  )
  return Math.max(MIN_GEMINI_TERMINAL_HEIGHT, Math.min(maxHeight, Math.round(value)))
}
