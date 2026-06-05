#!/usr/bin/env node

const REQUIRED_ENV = ['CSC_LINK', 'CSC_KEY_PASSWORD']

const missing = REQUIRED_ENV.filter((name) => !process.env[name])

if (missing.length > 0) {
  console.error(
    `[require-windows-signing-env] Missing Windows signing environment: ${missing.join(', ')}.`
  )
  console.error(
    '[require-windows-signing-env] Map WINDOWS_CSC_LINK/WINDOWS_CSC_KEY_PASSWORD to electron-builder CSC_LINK/CSC_KEY_PASSWORD before running build:win:signed.'
  )
  process.exitCode = 2
} else {
  console.log('[require-windows-signing-env] Windows signing environment detected.')
}
