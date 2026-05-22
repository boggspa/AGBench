#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const outDir = path.join(repoRoot, 'design-assets', 'ghost')
const defaultSizes = [128, 256, 512, 1024]

const parseSizes = () => {
  const arg = process.argv.find((item) => item.startsWith('--sizes='))
  if (!arg) return defaultSizes

  const sizes = arg
    .slice('--sizes='.length)
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item >= 16 && item <= 4096)

  return sizes.length > 0 ? Array.from(new Set(sizes)) : defaultSizes
}

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const buildGhostSvg = ({ id, title, shadow }) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 128 128" role="img" aria-labelledby="${id}-title">
  <title id="${id}-title">${escapeXml(title)}</title>
  <defs>
    <linearGradient id="${id}-fill" x1="38" y1="30" x2="98" y2="96" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.98"/>
      <stop offset="0.34" stop-color="#f2fbff" stop-opacity="0.94"/>
      <stop offset="0.63" stop-color="#d8f0ff" stop-opacity="0.86"/>
      <stop offset="1" stop-color="#9fc6de" stop-opacity="0.76"/>
    </linearGradient>
    <linearGradient id="${id}-rim" x1="32" y1="24" x2="104" y2="102" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#25324b" stop-opacity="0.92"/>
      <stop offset="0.62" stop-color="#121b2e" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#07101f" stop-opacity="0.72"/>
    </linearGradient>
    <radialGradient id="${id}-glow" cx="50%" cy="44%" r="58%">
      <stop offset="0" stop-color="#a8dcff" stop-opacity="0.34"/>
      <stop offset="0.48" stop-color="#638aff" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#638aff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g shape-rendering="crispEdges">
    ${
      shadow
        ? `<ellipse cx="68" cy="116" rx="34" ry="7" fill="#050a18" opacity="0.28"/>
    <ellipse cx="68" cy="58" rx="50" ry="58" fill="url(#${id}-glow)"/>`
        : ''
    }
    <polygon fill="url(#${id}-fill)" stroke="url(#${id}-rim)" stroke-width="7" stroke-linejoin="miter" points="56 30 80 30 92 36 98 48 98 84 92 84 86 90 80 84 74 96 68 84 56 96 50 84 38 84 38 48 44 36"/>
    <polygon fill="#ffffff" opacity="0.34" points="46 34 64 37 56 52 48 47"/>
    <polygon fill="#40689d" opacity="0.18" points="78 44 94 49 90 72 78 64"/>
    <rect x="51" y="54" width="10" height="12" fill="#111827"/>
    <rect x="75" y="54" width="10" height="12" fill="#111827"/>
    <rect x="54" y="51" width="3" height="3" fill="#ffffff" opacity="0.24"/>
    <rect x="78" y="51" width="3" height="3" fill="#ffffff" opacity="0.24"/>
    <rect x="51" y="66" width="10" height="4" fill="#111827" opacity="0.2"/>
    <rect x="75" y="66" width="10" height="4" fill="#111827" opacity="0.2"/>
    <rect x="44" y="92" width="12" height="12" fill="#f7fcff"/>
    <rect x="62" y="92" width="12" height="12" fill="#e6f6ff"/>
    <rect x="80" y="92" width="12" height="12" fill="#c8e4f5"/>
    ${
      shadow
        ? `<rect x="44" y="104" width="12" height="4" fill="#11192b" opacity="0.38"/>
    <rect x="62" y="104" width="12" height="4" fill="#11192b" opacity="0.38"/>
    <rect x="80" y="104" width="12" height="4" fill="#11192b" opacity="0.38"/>`
        : ''
    }
  </g>
</svg>
`

const renderPng = (svgPath, pngPath, size) => {
  const result = spawnSync(
    'sips',
    ['-s', 'format', 'png', '-z', String(size), String(size), svgPath, '--out', pngPath],
    {
      encoding: 'utf8'
    }
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sips failed for ${pngPath}`)
  }
}

const exportSvgAssets = (sizes) => {
  fs.mkdirSync(outDir, { recursive: true })

  const variants = [
    {
      name: 'ghost-guy-mark',
      title: 'AGBench ghost mark',
      shadow: false
    },
    {
      name: 'ghost-guy-sticker',
      title: 'AGBench ghost sticker',
      shadow: true
    }
  ]

  for (const variant of variants) {
    const svgPath = path.join(outDir, `${variant.name}.svg`)
    fs.writeFileSync(
      svgPath,
      buildGhostSvg({ id: variant.name, title: variant.title, shadow: variant.shadow })
    )

    for (const size of sizes) {
      renderPng(svgPath, path.join(outDir, `${variant.name}-${size}.png`), size)
    }
  }

  console.log(`Exported ghost assets to ${outDir}`)
  console.log(`Sizes: ${sizes.join(', ')}`)
}

const main = () => {
  const sizes = parseSizes()
  exportSvgAssets(sizes)
}

main()
