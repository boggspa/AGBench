import { describe, it, expect } from 'vitest'
import QRCode from 'qrcode'
import { embedQrCenterLogo } from './qrGhostLogo'
import ghostMarkRaw from '../assets/taskwraith-ghost-mark.svg?raw'

async function realQr(): Promise<string> {
  return QRCode.toString(JSON.stringify({ v: 1, sessionId: 'qr-test', relayUrl: 'ws://x' }), {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 2,
    color: { dark: '#1f2328', light: '#ffffff00' }
  })
}

describe('embedQrCenterLogo', () => {
  it('injects a centered plate + the inlined ghost vector into a real qrcode SVG', async () => {
    const qr = await realQr()
    const branded = embedQrCenterLogo(qr, ghostMarkRaw)

    // Still one well-formed outer SVG, ending exactly where it used to.
    expect(branded.startsWith(qr.slice(0, 40))).toBe(true)
    expect(branded.trimEnd().endsWith('</svg>')).toBe(true)
    expect(branded.match(/<\/svg>/g)?.length).toBe(2) // nested logo + outer

    // The dark plate matches the module color and sits ahead of the logo.
    expect(branded).toContain('fill="#1f2328"/>')
    expect(branded).toContain('aria-hidden="true"')

    // The ghost vector was inlined (its gradient ids travel with it) —
    // no external <image href>, so nothing async can flash or fail.
    expect(branded).toContain('ghost-guy-mark-fill')
    expect(branded).not.toContain('<image')

    // Plate geometry: 20% of the symbol width, centered.
    const viewBox = Number(qr.match(/viewBox="0 0 (\d+)/)?.[1])
    const rect = branded.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/)
    expect(rect).not.toBeNull()
    const [, x, , width] = rect!
    expect(Number(width)).toBeCloseTo(viewBox * 0.2, 1)
    expect(Number(x)).toBeCloseTo((viewBox - viewBox * 0.2) / 2, 1)
  })

  it('returns the original QR unchanged when either SVG cannot be parsed', async () => {
    const qr = await realQr()
    expect(embedQrCenterLogo(qr, 'not an svg at all')).toBe(qr)
    expect(embedQrCenterLogo('<div>not a qr</div>', ghostMarkRaw)).toBe('<div>not a qr</div>')
  })
})
