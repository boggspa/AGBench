#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')
const baseSvgPath = path.join(scriptDir, 'base-agent-identicon.svg')
const agentIdentityPath = path.join(repoRoot, 'src/renderer/src/lib/agentIdentity.ts')
const outputDir = path.join(scriptDir, 'named')
const manifestPath = path.join(scriptDir, 'agent-identicons.manifest.json')
const catalogPath = path.join(scriptDir, 'agent-identicons.catalog.svg')

const EXTRA_STYLE = `

    .detail {
      fill: none;
      stroke: var(--agent-accent, currentColor);
      stroke-width: 9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .detail-fine {
      fill: none;
      stroke: var(--agent-accent, currentColor);
      stroke-width: 6;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.78;
    }

    .detail-fill {
      fill: var(--agent-accent, currentColor);
      stroke: none;
    }

    .detail-soft {
      fill: var(--agent-accent, currentColor);
      stroke: none;
      opacity: 0.14;
    }

    .detail-dot {
      fill: var(--agent-accent, currentColor);
      stroke: none;
      opacity: 0.9;
    }`

const HAIR_STYLES = [
  {
    id: 'quiff',
    svg: `<path class="detail" d="M246 154 C254 113 288 99 316 128 C342 105 375 118 384 154" />`
  },
  {
    id: 'side-sweep',
    svg: `<path class="detail" d="M224 186 C256 126 334 104 398 178" />
    <path class="detail-fine" d="M248 164 C286 140 328 134 368 150" />`
  },
  {
    id: 'three-spikes',
    svg: `<path class="detail" d="M264 142 l-18 -42" />
    <path class="detail" d="M304 132 l4 -48" />
    <path class="detail" d="M346 144 l28 -38" />`
  },
  {
    id: 'circuit-curl',
    svg: `<path class="detail" d="M238 162 C246 124 292 112 302 148 C314 188 376 160 354 122" />
    <circle class="detail-dot" cx="356" cy="122" r="8" />`
  },
  {
    id: 'visor-ridge',
    svg: `<path class="detail" d="M228 214 C274 178 330 174 386 206" />
    <path class="detail-fine" d="M248 194 C286 180 326 180 366 194" />`
  },
  {
    id: 'top-knot',
    svg: `<circle class="detail" cx="304" cy="104" r="22" />
    <path class="detail" d="M280 134 C298 116 320 116 338 134" />`
  },
  {
    id: 'flat-cap',
    svg: `<path class="detail-fill" d="M218 166 C250 116 340 104 394 158 L382 180 C324 154 270 154 218 180Z" opacity="0.22" />
    <path class="detail" d="M216 178 C270 146 334 146 394 178" />
    <path class="detail-fine" d="M388 178 h38" />`
  },
  {
    id: 'halo-wire',
    svg: `<ellipse class="detail" cx="306" cy="112" rx="76" ry="22" />
    <path class="detail-fine" d="M250 112 C284 126 328 126 362 112" />`
  },
  {
    id: 'double-horns',
    svg: `<path class="detail" d="M246 158 C218 126 226 102 260 94" />
    <path class="detail" d="M358 158 C392 128 384 102 350 94" />`
  }
]

const ACCESSORIES = [
  {
    id: 'star-pin',
    svg: `<path class="detail" d="m402 446 9 18 20 3-14 14 3 20-18-9-18 9 3-20-14-14 20-3Z" />`
  },
  {
    id: 'tie-signal',
    svg: `<path class="detail" d="M300 500 l-18 36 h36Z" />
    <path class="detail-fine" d="M288 522 h24" />`
  },
  {
    id: 'ear-sat',
    svg: `<circle class="detail" cx="440" cy="292" r="17" />
    <path class="detail-fine" d="M452 280 l24 -24" />
    <circle class="detail-dot" cx="484" cy="248" r="7" />`
  },
  {
    id: 'lapel-bars',
    svg: `<path class="detail" d="M206 480 h54" />
    <path class="detail-fine" d="M220 504 h42" />
    <path class="detail-fine" d="M344 504 h42" />`
  },
  {
    id: 'moustache',
    svg: `<path class="detail" d="M286 362 C266 344 242 348 228 372" />
    <path class="detail" d="M314 362 C334 344 358 348 372 372" />`
  },
  {
    id: 'comet-chain',
    svg: `<path class="detail-fine" d="M386 318 C428 328 456 354 470 396" />
    <circle class="detail-dot" cx="474" cy="406" r="9" />
    <path class="detail-fine" d="M486 396 l18 -18" />`
  },
  {
    id: 'shoulder-flashes',
    svg: `<path class="detail" d="M150 502 l48 -20 l-22 38" />
    <path class="detail" d="M450 502 l-48 -20 l22 38" />`
  },
  {
    id: 'cheek-sparks',
    svg: `<path class="detail-fine" d="M232 338 l-20 16" />
    <path class="detail-fine" d="M222 324 l-26 2" />
    <path class="detail-fine" d="M368 338 l20 16" />
    <path class="detail-fine" d="M378 324 l26 2" />`
  },
  {
    id: 'collar-orbit',
    svg: `<path class="detail" d="M218 430 C270 398 330 398 382 430" />
    <circle class="detail-dot" cx="244" cy="416" r="8" />
    <circle class="detail-dot" cx="356" cy="416" r="8" />`
  },
  {
    id: 'antenna',
    svg: `<path class="detail" d="M410 226 C452 198 476 166 480 128" />
    <circle class="detail" cx="482" cy="118" r="17" />
    <path class="detail-fine" d="M506 94 l24 -24" />`
  },
  {
    id: 'tiny-crown',
    svg: `<path class="detail" d="M250 130 l28 -34 l28 34 l28 -34 l28 34" />
    <path class="detail-fine" d="M250 130 h112" />`
  },
  {
    id: 'nameplate',
    svg: `<path class="detail" d="M238 472 h124" />
    <circle class="detail-dot" cx="262" cy="472" r="7" />
    <circle class="detail-dot" cx="338" cy="472" r="7" />`
  }
]

const ORBITALS = [
  {
    id: 'north-west-dot',
    svg: `<circle class="detail-dot" cx="154" cy="154" r="10" />
    <path class="detail-fine" d="M170 170 l28 28" />`
  },
  {
    id: 'east-moon',
    svg: `<path class="detail" d="M468 208 a23 23 0 1 0 0 46 a15 23 0 1 1 0 -46Z" />`
  },
  {
    id: 'south-spark',
    svg: `<path class="detail" d="M456 536 l12 -26 l12 26 l26 12 l-26 12 l-12 26 l-12 -26 l-26 -12Z" />`
  },
  {
    id: 'west-radar',
    svg: `<path class="detail-fine" d="M126 276 C104 298 104 332 126 354" />
    <path class="detail-fine" d="M104 252 C66 292 66 338 104 378" />`
  },
  {
    id: 'north-satellite',
    svg: `<path class="detail" d="M430 104 h36 v24 h-36Z" />
    <path class="detail-fine" d="M430 116 h-28" />
    <path class="detail-fine" d="M466 116 h28" />`
  },
  {
    id: 'low-orbit',
    svg: `<path class="detail-fine" d="M132 444 C214 512 386 512 468 444" />
    <circle class="detail-dot" cx="424" cy="468" r="8" />`
  },
  {
    id: 'signal-pips',
    svg: `<circle class="detail-dot" cx="132" cy="220" r="7" />
    <circle class="detail-dot" cx="118" cy="254" r="9" />
    <circle class="detail-dot" cx="132" cy="290" r="7" />`
  },
  {
    id: 'upper-orbit',
    svg: `<path class="detail-fine" d="M150 180 C222 92 380 92 452 180" />
    <circle class="detail-dot" cx="396" cy="128" r="8" />`
  }
]

function readNicknamePool() {
  const source = fs.readFileSync(agentIdentityPath, 'utf8')
  const match = source.match(/const AGENT_NICKNAME_POOL: readonly string\[] = \[([\s\S]*?)\]/)
  if (!match) {
    throw new Error(`Could not find AGENT_NICKNAME_POOL in ${agentIdentityPath}`)
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1])
}

function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function hashString(value) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function hslToHex(hue, saturation, lightness) {
  const s = saturation / 100
  const l = lightness / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  const [r1, g1, b1] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x]
  const toHex = (channel) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`.toUpperCase()
}

function stripTrailingWhitespace(value) {
  return value.replace(/[ \t]+$/gm, '')
}

function pickUniqueHue(name, index, usedHues) {
  const hash = hashString(name.toLowerCase())
  let hue = Math.round((index * 137.508 + (hash % 23)) % 360)
  while (usedHues.has(hue)) {
    hue = (hue + 7) % 360
  }
  usedHues.add(hue)
  return hue
}

function pickVariant(name, index, usedHues) {
  const hash = hashString(name.toLowerCase())
  const hue = pickUniqueHue(name, index, usedHues)
  const hair = HAIR_STYLES[hash % HAIR_STYLES.length]
  const accessory = ACCESSORIES[Math.floor(hash / HAIR_STYLES.length) % ACCESSORIES.length]
  const orbital =
    ORBITALS[Math.floor(hash / HAIR_STYLES.length / ACCESSORIES.length) % ORBITALS.length]
  return {
    hash,
    hue,
    accent: hslToHex(hue, 72, 52),
    hair,
    accessory,
    orbital
  }
}

function buildSvg({ name, slug, baseBody, styleBlock, variant }) {
  const id = `agent-identicon-${slug}`
  const escapedName = escapeXml(name)
  const desc = `${escapedName} agent identicon with ${variant.hair.id}, ${variant.accessory.id}, ${variant.orbital.id}, and a ${variant.accent} accent.`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-labelledby="${id}-title ${id}-desc" data-agent-name="${escapedName}" data-agent-accent="${variant.accent}" data-agent-hue="${variant.hue}" style="color: ${variant.accent}; --agent-accent: ${variant.accent};">
  <title id="${id}-title">${escapedName}</title>
  <desc id="${id}-desc">${desc}</desc>
${styleBlock}
${baseBody}

  <g id="${id}-details" data-hair="${variant.hair.id}" data-accessory="${variant.accessory.id}" data-orbital="${variant.orbital.id}">
    ${variant.hair.svg}
    ${variant.accessory.svg}
    ${variant.orbital.svg}
  </g>
</svg>
`
}

function buildCatalog(entries, baseBody, styleContent) {
  const columns = 9
  const cellWidth = 188
  const cellHeight = 176
  const rows = Math.ceil(entries.length / columns)
  const width = columns * cellWidth
  const height = rows * cellHeight
  const items = entries
    .map((entry, index) => {
      const x = (index % columns) * cellWidth
      const y = Math.floor(index / columns) * cellHeight
      return `  <g transform="translate(${x} ${y})">
    <g transform="translate(44 6) scale(0.166667)" style="color: ${entry.accent}; --agent-accent: ${entry.accent};">
${baseBody}
      <g data-hair="${entry.hair}" data-accessory="${entry.accessory}" data-orbital="${entry.orbital}">
        ${entry.detailSvg}
      </g>
    </g>
    <text class="name" x="94" y="128">${escapeXml(entry.name)}</text>
    <text class="meta" x="94" y="146">${entry.accent}</text>
    <text class="meta" x="94" y="160">${entry.hair} · ${entry.accessory}</text>
  </g>`
    })
    .join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>TaskWraith named agent identicons</title>
  <style>
${styleContent}

    .name {
      fill: #202631;
      font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      text-anchor: middle;
    }
    .meta {
      fill: #727888;
      font: 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
      text-anchor: middle;
    }
  </style>
${items}
</svg>
`
}

function main() {
  const names = readNicknamePool()
  const base = fs.readFileSync(baseSvgPath, 'utf8')
  const styleMatch = base.match(/<style>([\s\S]*?)<\/style>/)
  if (!styleMatch) {
    throw new Error(`Could not find <style> block in ${baseSvgPath}`)
  }
  const scaleFriendlyBaseStyle = styleMatch[1].replace(
    /\n\s*vector-effect: non-scaling-stroke;/g,
    ''
  )
  const styleContent = `${scaleFriendlyBaseStyle}${EXTRA_STYLE}`
  const styleBlock = `  <style>${styleContent}
  </style>`
  const baseBody = base
    .slice(base.indexOf('</style>') + '</style>'.length, base.lastIndexOf('</svg>'))
    .trimEnd()
    .replace(/^/gm, '  ')

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  const seenSlugs = new Set()
  const usedHues = new Set()
  const entries = names.map((name, index) => {
    const baseSlug = slugify(name)
    let slug = baseSlug
    let suffix = 2
    while (seenSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`
      suffix += 1
    }
    seenSlugs.add(slug)

    const variant = pickVariant(name, index, usedHues)
    const file = `${slug}.svg`
    const detailSvg = `${variant.hair.svg}
    ${variant.accessory.svg}
    ${variant.orbital.svg}`
    fs.writeFileSync(
      path.join(outputDir, file),
      stripTrailingWhitespace(buildSvg({ name, slug, baseBody, styleBlock, variant })),
      'utf8'
    )
    return {
      name,
      slug,
      file,
      accent: variant.accent,
      hue: variant.hue,
      hair: variant.hair.id,
      accessory: variant.accessory.id,
      orbital: variant.orbital.id,
      hash: variant.hash,
      detailSvg
    }
  })

  const manifestEntries = entries.map(({ detailSvg: _detailSvg, ...entry }) => entry)
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifestEntries, null, 2)}\n`, 'utf8')
  fs.writeFileSync(
    catalogPath,
    stripTrailingWhitespace(buildCatalog(entries, baseBody, styleContent)),
    'utf8'
  )
  console.log(`Generated ${entries.length} named agent identicons in ${outputDir}`)
}

main()
