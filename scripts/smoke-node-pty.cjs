#!/usr/bin/env node

const pty = require('node-pty')

const marker = `agentbench-node-pty-smoke-${Date.now()}`
const timeoutMs = Number(process.env.PTY_SMOKE_TIMEOUT_MS || 8000)
const isWindows = process.platform === 'win32'
const shell = isWindows ? 'powershell.exe' : process.env.SHELL || '/bin/sh'
const unixShellArgs = pathBasename(shell) === 'sh'
  ? ['-c', `printf '%s\\n' '${marker}'`]
  : ['-lc', `printf '%s\\n' '${marker}'`]
const args = isWindows
  ? ['-NoProfile', '-NonInteractive', '-Command', `Write-Output "${marker}"`]
  : unixShellArgs

let output = ''
let finished = false

const term = pty.spawn(shell, args, {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: {
    ...process.env,
    TERM: 'xterm-256color'
  }
})

const timer = setTimeout(() => {
  finish(1, `Timed out waiting for node-pty output marker ${marker}.`)
}, timeoutMs)

term.onData((data) => {
  output += data
  if (output.includes(marker)) {
    finish(0)
  }
})

term.onExit(({ exitCode, signal }) => {
  if (finished) return
  if (output.includes(marker)) {
    finish(0)
    return
  }
  finish(1, `node-pty process exited before marker. exitCode=${exitCode} signal=${signal || ''}`)
})

function finish(code, error) {
  if (finished) return
  finished = true
  clearTimeout(timer)

  try {
    term.kill()
  } catch {
    // The shell may already have exited.
  }

  if (code === 0) {
    console.log(`node-pty smoke ok: ${shell}`)
  } else {
    console.error(error)
    if (output.trim()) {
      console.error(output)
    }
  }

  process.exitCode = code
}

function pathBasename(value) {
  return value.replace(/\\/g, '/').split('/').pop() || value
}
