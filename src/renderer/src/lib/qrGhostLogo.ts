/*
 * qrGhostLogo — brand the pairing QR with the TaskWraith ghost mark.
 *
 * Takes the self-contained SVG string `qrcode` produces and injects a
 * centered, rounded dark plate + the ghost vector (inlined as a nested
 * <svg>) just before `</svg>`. Because the logo is baked into the STRING,
 * every render site (the inline pane, the maximise overlay) and any future
 * export gets the branded QR from the single `qrSvg` source — no CSS
 * overlay choreography, no async <image> load flashing an empty plate.
 *
 * Scan-safety budget: the plate is 20% of the symbol width → ~4% of the
 * module area obscured, concentrated at the center (which on mid-size
 * versions covers a central alignment pattern — standard for branded QRs;
 * iOS Vision / AVFoundation decode these reliably). The caller pairs this
 * with errorCorrectionLevel 'H' (~30% recoverable), leaving >25 points of
 * budget for screen glare — more slack than the previous unbranded 'Q'
 * (~25%) setup had. The plate uses the exact module color so a scanner
 * sees it as a contiguous dark blob (plain erasure damage), and the pale
 * ghost reads crisply against it.
 *
 * Defensive by design: if either SVG fails to parse, the ORIGINAL QR
 * string is returned unchanged — a scannable plain QR always beats a
 * broken branded one.
 */

interface ParsedSvg {
  viewBoxWidth: number
  viewBoxHeight: number
  inner: string
}

function parseSvg(svg: string): ParsedSvg | null {
  const viewBoxMatch = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/)
  if (!viewBoxMatch) return null
  const innerMatch = svg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/)
  if (!innerMatch) return null
  return {
    viewBoxWidth: Number(viewBoxMatch[1]),
    viewBoxHeight: Number(viewBoxMatch[2]),
    inner: innerMatch[1]
  }
}

/** Fraction of the QR's width the dark backing plate occupies. */
const PLATE_FRACTION = 0.2
/** Corner radius as a fraction of the plate size. */
const PLATE_RADIUS_FRACTION = 0.22
/** The ghost's size within the plate (leaves a visual quiet ring). */
const LOGO_WITHIN_PLATE = 0.86
/** Matches the QR `dark` module color in PairingPage — the scanner reads
 * the plate as a contiguous dark blob, and the pale ghost pops against it. */
const PLATE_FILL = '#1f2328'

export function embedQrCenterLogo(qrSvg: string, logoSvg: string): string {
  const qr = parseSvg(qrSvg)
  const logo = parseSvg(logoSvg)
  if (!qr || !logo || qr.viewBoxWidth <= 0 || logo.viewBoxWidth <= 0) return qrSvg
  const closeIndex = qrSvg.lastIndexOf('</svg>')
  if (closeIndex < 0) return qrSvg

  const size = qr.viewBoxWidth
  const plate = size * PLATE_FRACTION
  const plateXY = (size - plate) / 2
  const radius = plate * PLATE_RADIUS_FRACTION
  const logoSize = plate * LOGO_WITHIN_PLATE
  const logoXY = (size - logoSize) / 2

  const fixed = (value: number): string => value.toFixed(3).replace(/\.?0+$/, '')
  const overlay = [
    `<g aria-hidden="true">`,
    `<rect x="${fixed(plateXY)}" y="${fixed(plateXY)}" width="${fixed(plate)}" height="${fixed(plate)}" rx="${fixed(radius)}" fill="${PLATE_FILL}"/>`,
    `<svg x="${fixed(logoXY)}" y="${fixed(logoXY)}" width="${fixed(logoSize)}" height="${fixed(logoSize)}" viewBox="0 0 ${logo.viewBoxWidth} ${logo.viewBoxHeight}">${logo.inner}</svg>`,
    `</g>`
  ].join('')

  return qrSvg.slice(0, closeIndex) + overlay + qrSvg.slice(closeIndex)
}
