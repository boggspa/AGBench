/**
 * Phase K5 — Named Blender Python class library.
 *
 * Mirrors the K4 AppleScript class library pattern: curated, named,
 * parameterised script templates that the agent dispatches by class id.
 * The session-class approval cache scopes "Approve & remember" to the
 * className, so "blender.render-still" approved once auto-approves all
 * future `blender.render-still` invocations until app restart.
 *
 * Raw `bpy` execution lives at the separate `blender.run-script` class
 * which never caches — every invocation prompts because the source IS
 * the script and the class name is shared.
 */

export interface BlenderParamSpec {
  name: string
  description: string
  validate?: (value: string) => string | null
}

export interface BlenderClassEntry {
  /**
   * Public-facing class id. Used by the approval cache as
   * `blender:<id>`. The `blender:` prefix keeps Blender classes
   * namespaced separately from K4 (applescript:...) and K6 (midi:...).
   */
  id: string
  label: string
  description: string
  /**
   * Bundle id for the approval modal. Blender's bundle id is
   * 'org.blenderfoundation.blender' — same as the runningHint key.
   */
  targetBundleId: string
  params: BlenderParamSpec[]
  /**
   * Optionally accepts an inputBlendPath as a positional pre-arg to
   * `--background`. When the class is "operate on this file", set
   * this to a param-derived path; otherwise leave undefined for
   * "start from empty scene" semantics.
   */
  resolveInputBlendPath?: (params: Record<string, string>) => string | undefined
  /**
   * Build the Python source. Implementations escape param values
   * via the supplied helper before interpolating.
   */
  build: (params: Record<string, string>) => string
}

/**
 * Helper: escape for embedding inside a Python triple-quoted string.
 * Python triple-quotes accept any character except a matching triple-
 * quote sequence. The simplest robust path is to just replace any
 * occurrences of the closing delimiter with an escaped variant.
 *
 * We use `"""..."""` triple-quotes so `'` and `"` (single) pass through.
 */
export function escapePythonTripleString(value: string): string {
  return value.replace(/"""/g, '\\"\\"\\"')
}

export const BLENDER_CLASSES: BlenderClassEntry[] = [
  {
    id: 'render-still',
    label: 'Render a single frame from a Blender file',
    description:
      'Open the given .blend file and render the current frame to PNG. The output lands inside the AGBench sandbox tempdir for the invocation.',
    targetBundleId: 'org.blenderfoundation.blender',
    params: [
      {
        name: 'blendPath',
        description: 'Absolute path to the source .blend file',
        validate: (value) =>
          value.endsWith('.blend')
            ? null
            : 'blendPath must end in .blend'
      }
    ],
    resolveInputBlendPath: ({ blendPath }) => blendPath,
    build: () => {
      // The agent's per-invocation tempdir is Blender's cwd, so a
      // relative output path lands inside the sandbox.
      return `
import bpy
import os
bpy.context.scene.render.filepath = os.path.abspath("render-still.png")
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print(f"WROTE {bpy.context.scene.render.filepath}")
      `.trim()
    }
  },
  {
    id: 'import-obj',
    label: 'Import an OBJ file into a new scene',
    description:
      'Start from an empty Blender scene, import the given .obj, and save the result to scene.blend in the sandbox tempdir.',
    targetBundleId: 'org.blenderfoundation.blender',
    params: [
      {
        name: 'objPath',
        description: 'Absolute path to the source .obj file',
        validate: (value) =>
          value.endsWith('.obj') ? null : 'objPath must end in .obj'
      }
    ],
    build: ({ objPath }) => {
      const escaped = escapePythonTripleString(objPath)
      return `
import bpy
# Clear the default cube + lights so the import is the only scene content.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath="""${escaped}""")
bpy.ops.wm.save_as_mainfile(filepath="scene.blend")
print(f"WROTE scene.blend with {len(bpy.data.objects)} object(s)")
      `.trim()
    }
  },
  {
    id: 'export-gltf',
    label: 'Export the current scene to glTF',
    description: 'Open a .blend file and export its active scene to scene.gltf in the sandbox tempdir.',
    targetBundleId: 'org.blenderfoundation.blender',
    params: [
      {
        name: 'blendPath',
        description: 'Absolute path to the source .blend file',
        validate: (value) =>
          value.endsWith('.blend') ? null : 'blendPath must end in .blend'
      }
    ],
    resolveInputBlendPath: ({ blendPath }) => blendPath,
    build: () => {
      return `
import bpy
import os
bpy.ops.export_scene.gltf(filepath=os.path.abspath("scene.gltf"), export_format='GLTF_SEPARATE')
print(f"WROTE {os.path.abspath('scene.gltf')}")
      `.trim()
    }
  }
]

export function findBlenderClass(id: string): BlenderClassEntry | undefined {
  return BLENDER_CLASSES.find((entry) => entry.id === id)
}

export function formatBlenderClassName(id: string): string {
  return `blender:${id}`
}
