/**
 * Phase M1 — GeminiApiProvider scaffold.
 *
 * Google has announced that the `gemini` CLI is being deprecated
 * (~30 days) in favour of Antigravity / `agy`, which drops the MCP/ACP
 * surfaces AGBench's Gemini integration currently relies on. To hedge,
 * this module is the entry point for an in-process Gemini runtime built
 * on the `@google/genai` SDK that will coexist alongside the existing
 * CLI provider (`runGeminiProvider` in `src/main/index.ts`). Coexistence,
 * not replacement: both paths stay shippable so a regression in either
 * can be rolled back without losing the other.
 *
 * Step 1 (this file) is intentionally a *no-op scaffold*:
 *   - `loadOptionalGeminiSdk` mirrors `loadOptionalClaudeSdk` and tries
 *     a dynamic `import('@google/genai')`, returning `null` if the dep
 *     isn't installed so the CLI fallback path stays default behaviour.
 *   - `tryRunGeminiApi` is a stub that always returns `false`, signalling
 *     "fall through to the CLI provider". No SDK calls, no auth, no
 *     streaming, no MCP translation.
 *   - The new `geminiApiRuntime` setting in `AppSettings` defaults to
 *     `'auto'` but is not yet consulted by anything.
 *
 * Steps 2-10 will wire `tryRunGeminiApi` into `runGeminiProvider`, light
 * up auth resolution from `GeminiAuthProfile`, plumb streaming +
 * function-calling, translate AGBench's MCP bridge surface, add image
 * input, surface settings UI, and add quota tracking. None of that
 * exists yet — adding it here would make the Step 1 diff impossible to
 * review.
 *
 * IMPORTANT: do NOT import `@google/genai` at module load. The dep is
 * `optionalDependencies`-shaped (declared but may not be installed in
 * every environment, e.g. the worktree where this lands before
 * `npm install` runs in the parent). Use only the dynamic `import()`
 * inside `loadOptionalGeminiSdk` so typecheck and bundling stay clean
 * when the SDK is absent.
 */

import type { AgentRunPayload, AgentRunRoute } from './index'

/**
 * Attempt to dynamically import `@google/genai`. Returns `null` if the
 * dep is absent so the caller can fall back to the CLI provider. Mirrors
 * `loadOptionalClaudeSdk` in `src/main/index.ts`. The `new Function`
 * wrapper around `import` is the same trick used there to keep bundlers
 * from statically resolving the specifier — without it, electron-vite
 * would either fail at build time or bake the missing dep into the
 * production bundle.
 */
export async function loadOptionalGeminiSdk(): Promise<any | null> {
  try {
    const importer = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<any>
    return await importer('@google/genai')
  } catch {
    return null
  }
}

/**
 * Attempt to run a Gemini run via the API SDK path. Returns `true` if it
 * handled the run; `false` to fall through to the CLI provider. Mirrors
 * `tryRunClaudeSdk`'s shape — the future Step-2 wiring will live in the
 * same place inside `runGeminiProvider`, choosing between API and CLI
 * based on `AppSettings.geminiApiRuntime` and whether an API key /
 * profile is resolvable.
 *
 * Step 1 is intentionally a no-op: this function returns `false` for
 * every input so the existing CLI path remains the only execution path.
 */
export async function tryRunGeminiApi(
  _event: Electron.IpcMainInvokeEvent,
  _payload: AgentRunPayload,
  _route: AgentRunRoute
): Promise<boolean> {
  return false
}
