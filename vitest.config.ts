import { defineConfig, configDefaults } from 'vitest/config'

// Keep vitest's default discovery, but never scan the local-only `ios/` tree
// (the gitignored SwiftUI app + TaskWraithKit package and their interop driver).
// Those are exercised by `swift test` and an explicit, env-gated vitest run
// (`RUN_SWIFT_INTEROP=1 npx vitest run ios/interop/...`), not the main suite.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'ios/**']
  }
})
