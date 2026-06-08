import { describe, expect, it } from 'vitest'
import {
  extractOllamaPeakRssGb,
  formatOllamaComposerPeakGb,
  formatOllamaSummaryMemoryGb
} from './ollamaMemoryDisplay'

describe('ollamaMemoryDisplay', () => {
  it('reads peak RSS from nested hardware stats', () => {
    expect(
      extractOllamaPeakRssGb({
        hardware: { ram: { peakRssGb: 17.2 } }
      })
    ).toBeCloseTo(17.2)
  })

  it('formats composer peak RAM compactly', () => {
    expect(formatOllamaComposerPeakGb(17.2)).toBe('17.2GB')
    expect(formatOllamaComposerPeakGb(2.42)).toBe('2.4GB')
  })

  it('formats summary peak RAM with a space before GB', () => {
    expect(formatOllamaSummaryMemoryGb(17.2)).toBe('17 GB')
    expect(formatOllamaSummaryMemoryGb(2.42)).toBe('2.4 GB')
  })
})
