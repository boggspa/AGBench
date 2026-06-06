import { describe, expect, it } from 'vitest'
import {
  dedupePaths,
  getImageName,
  getImagePreviewSrc,
  sanitizeImagePath
} from './imageAttachments'

describe('image attachment path helpers', () => {
  it('normalizes Windows file URIs for provider payloads and previews', () => {
    expect(sanitizeImagePath('file:///C:/Users/chris/Pictures/capture.png')).toBe(
      'C:/Users/chris/Pictures/capture.png'
    )
    expect(getImageName('file:///C:/Users/chris/Pictures/capture.png')).toBe('capture.png')
    expect(getImagePreviewSrc('C:\\Users\\chris\\Pictures\\capture.png')).toBe(
      'file:///C:/Users/chris/Pictures/capture.png'
    )
  })

  it('dedupes Windows drive paths case-insensitively', () => {
    expect(dedupePaths(['C:/Temp/Capture.png', 'c:/temp/capture.png'])).toEqual([
      'C:/Temp/Capture.png'
    ])
  })
})
