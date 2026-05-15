#!/usr/bin/env node

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const tools = ['run_shell_command', 'write_file', 'replace', 'read_file', 'list_directory']
const geminiBin = process.env.GEMINI_BIN || 'gemini'
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agbench-gemini-mcp-'))
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agbench-gemini-mcp-project-'))

try {
  const buildArgs = (scope) => [
    'mcp',
    'add',
    'agentbench',
    '/bin/cat',
    '--agentbench-gemini-mcp-bridge',
    '--socket',
    '/tmp/agbench-gemini-mcp-test.sock',
    '--token',
    'test-token',
    '--scope',
    scope,
    '--trust',
    ...tools.map((tool) => `--include-tools=${tool}`)
  ]
  const args = buildArgs('user')

  const result = spawnSync(geminiBin, args, {
    env: {
      ...process.env,
      GEMINI_CLI_HOME: home,
      FORCE_COLOR: '0',
      NO_COLOR: '1'
    },
    encoding: 'utf8'
  })

  if (result.status !== 0) {
    throw new Error(`gemini ${args.join(' ')} failed with ${result.status}:\n${result.stderr || result.stdout}`)
  }

  const settingsPath = path.join(home, '.gemini', 'settings.json')
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  const server = settings?.mcpServers?.agentbench
  if (!server) throw new Error('agentbench MCP server was not written to settings.json.')
  if (server.command !== '/bin/cat') throw new Error(`Unexpected command: ${server.command}`)
  if (server.trust !== true) throw new Error('agentbench MCP server was not marked trusted.')
  if (JSON.stringify(server.args) !== JSON.stringify([
    '--agentbench-gemini-mcp-bridge',
    '--socket',
    '/tmp/agbench-gemini-mcp-test.sock',
    '--token',
    'test-token'
  ])) {
    throw new Error(`Bridge args were not preserved correctly: ${JSON.stringify(server.args)}`)
  }
  if (JSON.stringify(server.includeTools) !== JSON.stringify(tools)) {
    throw new Error(`includeTools were not written as separate entries: ${JSON.stringify(server.includeTools)}`)
  }

  const projectResult = spawnSync(geminiBin, buildArgs('project'), {
    cwd: project,
    env: {
      ...process.env,
      GEMINI_CLI_HOME: home,
      FORCE_COLOR: '0',
      NO_COLOR: '1'
    },
    encoding: 'utf8'
  })

  if (projectResult.status !== 0) {
    throw new Error(`project-scoped gemini mcp add failed with ${projectResult.status}:\n${projectResult.stderr || projectResult.stdout}`)
  }

  const projectSettingsPath = path.join(project, '.gemini', 'settings.json')
  const projectSettings = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf8'))
  const projectServer = projectSettings?.mcpServers?.agentbench
  if (!projectServer) throw new Error('project-scoped agentbench MCP server was not written to .gemini/settings.json.')
  if (projectServer.command !== '/bin/cat') throw new Error(`Unexpected project command: ${projectServer.command}`)
  if (JSON.stringify(projectServer.includeTools) !== JSON.stringify(tools)) {
    throw new Error(`project includeTools were not written as separate entries: ${JSON.stringify(projectServer.includeTools)}`)
  }

  console.log('gemini MCP add args smoke ok')
} finally {
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(project, { recursive: true, force: true })
}
