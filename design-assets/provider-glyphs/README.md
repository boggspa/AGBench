# Provider Glyphs

Original monoline mnemonic glyphs for representing providers without bundling official logo PNGs.

These are deliberately simplified and slightly "wrong" visual hints. The provider label remains the actual product identifier; the glyph is only supporting iconography.

Design constraints:

- `24x24` SVG viewBox.
- No container baked into the glyph.
- Fully provider-accented linework via `--provider-accent`.
- No official raster assets.
- No exact provider logo geometry.

Regenerate:

```bash
node design-assets/provider-glyphs/generate-provider-glyphs.mjs
```

Outputs:

- `glyphs/*.svg`: individual provider glyphs.
- `provider-glyphs.catalog.svg`: review sheet with large and small previews.
- `provider-glyphs.manifest.json`: provider ids, accents, and drawing notes.
