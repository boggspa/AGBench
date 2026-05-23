import { describe, expect, it } from 'vitest'

import {
  BLENDER_CLASSES,
  escapePythonTripleString,
  findBlenderClass,
  formatBlenderClassName
} from './CreativeBlenderClasses'

describe('CreativeBlenderClasses (K5)', () => {
  it('exposes the curated set of Blender classes', () => {
    const ids = BLENDER_CLASSES.map((c) => c.id).sort()
    expect(ids).toContain('render-still')
    expect(ids).toContain('import-obj')
    expect(ids).toContain('export-gltf')
  })

  it('formatBlenderClassName namespaces ids under blender:', () => {
    expect(formatBlenderClassName('render-still')).toBe('blender:render-still')
  })

  it('escapePythonTripleString neutralises triple-quote sequences in path input', () => {
    expect(escapePythonTripleString('safe path')).toBe('safe path')
    expect(escapePythonTripleString('path with """triple""" quotes')).toBe(
      'path with \\"\\"\\"triple\\"\\"\\" quotes'
    )
  })

  describe('render-still', () => {
    it('rejects non-.blend paths', () => {
      const entry = findBlenderClass('render-still')!
      expect(entry.params[0].validate?.('scene.obj')).toContain('.blend')
      expect(entry.params[0].validate?.('/path/to/scene.blend')).toBeNull()
    })
    it('emits a script that writes render-still.png to cwd', () => {
      const entry = findBlenderClass('render-still')!
      const script = entry.build({ blendPath: '/x.blend' })
      expect(script).toContain('bpy.ops.render.render(write_still=True)')
      expect(script).toContain('render-still.png')
    })
    it('forwards the .blend as Blender CLI input', () => {
      const entry = findBlenderClass('render-still')!
      expect(entry.resolveInputBlendPath?.({ blendPath: '/x.blend' })).toBe('/x.blend')
    })
  })

  describe('import-obj', () => {
    it('escapes obj paths for safe triple-quote embedding', () => {
      const entry = findBlenderClass('import-obj')!
      const script = entry.build({ objPath: '/path/with """sneaky""" quotes.obj' })
      expect(script).not.toContain('"""sneaky"""')
      expect(script).toContain('\\"\\"\\"sneaky\\"\\"\\"')
    })
    it('starts from a clean factory scene before importing', () => {
      const entry = findBlenderClass('import-obj')!
      const script = entry.build({ objPath: '/x.obj' })
      expect(script).toContain('read_factory_settings(use_empty=True)')
      expect(script).toContain('obj_import')
    })
  })

  describe('export-gltf', () => {
    it('uses GLTF_SEPARATE so the agent can inspect bin + textures alongside the .gltf', () => {
      const entry = findBlenderClass('export-gltf')!
      const script = entry.build({ blendPath: '/x.blend' })
      expect(script).toContain("export_format='GLTF_SEPARATE'")
    })
  })

  it('findBlenderClass returns undefined for unknown ids', () => {
    expect(findBlenderClass('nonsense')).toBeUndefined()
  })

  it('every class targets the Blender bundle id', () => {
    for (const entry of BLENDER_CLASSES) {
      expect(entry.targetBundleId).toBe('org.blenderfoundation.blender')
    }
  })
})
