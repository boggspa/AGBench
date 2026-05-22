#!/usr/bin/env node

/*
 * smoke-gemini-api-sdk.cjs — Phase M1 Step 10.
 *
 * Confirms that the `@google/genai` SDK loads at the project's installed
 * version and exposes the API surface `GeminiApiProvider` depends on.
 * Catches regressions when the SDK ships a breaking change (the
 * `^minor` pin in package.json deliberately allows minor bumps).
 *
 * Surface we depend on (kept in lockstep with src/main/GeminiApiProvider.ts):
 *  - `new GoogleGenAI({ apiKey })` constructor
 *  - `client.models.generateContentStream({ model, contents, tools? })`
 *  - `client.files.upload(...)` (used by Step 7 large-image path)
 *
 * We don't make a real network call here (no API key). We instantiate
 * the client with a dummy key and assert the methods exist with the
 * expected arity / shape. If the SDK breaks any of these, the smoke
 * fails fast with a clear message — much faster than catching it during
 * a packaged-app run.
 */

let exitCode = 0
function fail(msg) {
  console.error(`[smoke-gemini-api-sdk] FAIL: ${msg}`)
  exitCode = 1
}
function ok(msg) {
  console.log(`[smoke-gemini-api-sdk] ok — ${msg}`)
}

async function main() {
  let sdk
  try {
    sdk = await import('@google/genai')
  } catch (err) {
    fail(`could not import @google/genai: ${err && err.message ? err.message : err}`)
    return
  }
  ok('@google/genai imported')

  const GoogleGenAI = sdk.GoogleGenAI
  if (typeof GoogleGenAI !== 'function') {
    fail(`expected GoogleGenAI to be a constructor (typeof: ${typeof GoogleGenAI})`)
    return
  }
  ok('GoogleGenAI constructor present')

  let client
  try {
    client = new GoogleGenAI({ apiKey: 'smoke-test-not-a-real-key' })
  } catch (err) {
    fail(`GoogleGenAI({apiKey}) threw: ${err && err.message ? err.message : err}`)
    return
  }
  ok('GoogleGenAI client instantiated with apiKey')

  if (!client.models || typeof client.models.generateContentStream !== 'function') {
    fail(
      `client.models.generateContentStream missing — got ${typeof (client.models && client.models.generateContentStream)}`
    )
    return
  }
  ok('client.models.generateContentStream is a function')

  if (!client.files || typeof client.files.upload !== 'function') {
    // Files API is only required for Step 7's large-image path. Warn,
    // don't fail — small images use inline base64 and don't need it.
    console.warn(
      '[smoke-gemini-api-sdk] WARN: client.files.upload missing — large-image uploads will fall back to inline base64'
    )
  } else {
    ok('client.files.upload is a function')
  }
}

main()
  .catch((err) => {
    fail(`unhandled error: ${err && err.message ? err.message : err}`)
  })
  .finally(() => {
    process.exit(exitCode)
  })
