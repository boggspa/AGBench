import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildGeminiFunctionDeclarations,
  jsonSchemaToGeminiSchema,
  type GeminiFunctionDeclaration
} from './GeminiApiToolDeclarations'

/**
 * Phase M1 Step 3 — Pins every conversion quirk for the JSONSchema →
 * Gemini Schema bridge that feeds `tryRunGeminiApi`'s function-calling
 * loop. The converter is pure, so each test can assert the exact output
 * without setting up any provider context.
 *
 * The "sanity check" at the bottom mirrors `mcpToolDefinitions()` from
 * `src/main/index.ts` (a snapshot — see comment on that block). If you
 * touch the AGBench MCP tool list, refresh the snapshot below so we
 * keep verifying that every tool round-trips cleanly. Re-importing
 * `mcpToolDefinitions` directly from `index.ts` is impractical in unit
 * tests because the module boots Electron at import time.
 */

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

afterEach(() => {
  warnSpy.mockClear()
})

describe('jsonSchemaToGeminiSchema', () => {
  it('converts a bare object schema with string properties + required', () => {
    const result = jsonSchemaToGeminiSchema({
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
    })
    expect(result).toEqual({
      type: 'OBJECT',
      properties: { path: { type: 'STRING' } },
      required: ['path']
    })
  })

  it('uppercases each JSONSchema scalar type to the Gemini enum', () => {
    expect(jsonSchemaToGeminiSchema({ type: 'string' })?.type).toBe('STRING')
    expect(jsonSchemaToGeminiSchema({ type: 'number' })?.type).toBe('NUMBER')
    expect(jsonSchemaToGeminiSchema({ type: 'integer' })?.type).toBe('INTEGER')
    expect(jsonSchemaToGeminiSchema({ type: 'boolean' })?.type).toBe('BOOLEAN')
    expect(jsonSchemaToGeminiSchema({ type: 'array', items: { type: 'string' } })?.type).toBe(
      'ARRAY'
    )
    expect(jsonSchemaToGeminiSchema({ type: 'object', properties: {} })?.type).toBe('OBJECT')
  })

  it('recurses into nested object properties', () => {
    const result = jsonSchemaToGeminiSchema({
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: {
            inner: { type: 'string' }
          },
          required: ['inner']
        }
      }
    })
    expect(result?.properties?.outer).toEqual({
      type: 'OBJECT',
      properties: { inner: { type: 'STRING' } },
      required: ['inner']
    })
  })

  it('recurses into array items', () => {
    const result = jsonSchemaToGeminiSchema({
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' } } }
    })
    expect(result?.items).toEqual({
      type: 'OBJECT',
      properties: { id: { type: 'STRING' } }
    })
  })

  it('preserves description on objects, properties, and arrays', () => {
    const result = jsonSchemaToGeminiSchema({
      type: 'object',
      description: 'top-level',
      properties: {
        x: { type: 'string', description: 'an x' }
      }
    })
    expect(result?.description).toBe('top-level')
    expect(result?.properties?.x.description).toBe('an x')
  })

  it('preserves string enums verbatim', () => {
    const result = jsonSchemaToGeminiSchema({
      type: 'string',
      enum: ['gemini', 'codex', 'claude']
    })
    expect(result).toEqual({ type: 'STRING', enum: ['gemini', 'codex', 'claude'] })
  })

  it('strips additionalProperties without leaking a warning', () => {
    const result = jsonSchemaToGeminiSchema({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false
    } as unknown)
    expect(result).toEqual({
      type: 'OBJECT',
      properties: { a: { type: 'STRING' } }
    })
    // additionalProperties is silently dropped — should NOT trigger a warning.
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('coerces oneOf to the first variant and emits a warning', () => {
    const result = jsonSchemaToGeminiSchema({
      oneOf: [{ type: 'string' }, { type: 'integer' }]
    })
    expect(result).toEqual({ type: 'STRING' })
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/oneOf\/anyOf\/allOf/)
  })

  it('coerces anyOf the same way as oneOf', () => {
    const result = jsonSchemaToGeminiSchema({
      anyOf: [{ type: 'number' }, { type: 'null' }]
    })
    expect(result?.type).toBe('NUMBER')
  })

  it('handles type: ["string", "null"] as nullable STRING', () => {
    const result = jsonSchemaToGeminiSchema({ type: ['string', 'null'] })
    expect(result).toEqual({ type: 'STRING', nullable: true })
  })

  it('drops $ref-only schemas with a warning', () => {
    const result = jsonSchemaToGeminiSchema({ $ref: '#/definitions/X' })
    expect(result).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/\$ref/)
  })

  it('drops properties whose schemas are unconvertible but keeps the rest', () => {
    const result = jsonSchemaToGeminiSchema({
      type: 'object',
      properties: {
        ok: { type: 'string' },
        bad: { $ref: '#/definitions/Other' }
      },
      required: ['ok', 'bad']
    })
    expect(result?.properties?.ok).toEqual({ type: 'STRING' })
    expect(result?.properties?.bad).toBeUndefined()
    // `required` filters down to surviving properties only.
    expect(result?.required).toEqual(['ok'])
  })

  it('infers OBJECT when type is missing but properties is present', () => {
    const result = jsonSchemaToGeminiSchema({ properties: { a: { type: 'string' } } })
    expect(result?.type).toBe('OBJECT')
    expect(result?.properties?.a).toEqual({ type: 'STRING' })
  })

  it('returns undefined when the input is not a plain object', () => {
    expect(jsonSchemaToGeminiSchema(undefined)).toBeUndefined()
    expect(jsonSchemaToGeminiSchema(null)).toBeUndefined()
    expect(jsonSchemaToGeminiSchema('string')).toBeUndefined()
    expect(jsonSchemaToGeminiSchema(42)).toBeUndefined()
    expect(jsonSchemaToGeminiSchema([])).toBeUndefined()
  })

  it('falls back to STRING items when array items are unconvertible', () => {
    const result = jsonSchemaToGeminiSchema({
      type: 'array',
      items: { $ref: '#/definitions/X' }
    })
    expect(result?.type).toBe('ARRAY')
    expect(result?.items).toEqual({ type: 'STRING' })
    expect(warnSpy).toHaveBeenCalled()
  })

  it('produces deterministic output for identical input', () => {
    const a = jsonSchemaToGeminiSchema({
      type: 'object',
      properties: { x: { type: 'string' }, y: { type: 'integer' } },
      required: ['x']
    })
    const b = jsonSchemaToGeminiSchema({
      type: 'object',
      properties: { x: { type: 'string' }, y: { type: 'integer' } },
      required: ['x']
    })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('buildGeminiFunctionDeclarations', () => {
  it('emits an empty OBJECT for tools with no inputSchema', () => {
    const result = buildGeminiFunctionDeclarations([
      { name: 'no_args_tool', description: 'A tool that takes no args.' }
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      name: 'no_args_tool',
      description: 'A tool that takes no args.',
      parameters: { type: 'OBJECT', properties: {} }
    } as GeminiFunctionDeclaration)
  })

  it('emits an empty OBJECT when inputSchema is explicitly null', () => {
    const result = buildGeminiFunctionDeclarations([{ name: 't', inputSchema: null }])
    expect(result[0].parameters).toEqual({ type: 'OBJECT', properties: {} })
  })

  it('skips tools with a missing or empty name and warns', () => {
    const result = buildGeminiFunctionDeclarations([
      { name: '', inputSchema: { type: 'object' } },
      { description: 'no name' } as { name?: string; description?: string },
      { name: 'good', inputSchema: { type: 'object' } }
    ])
    expect(result.map((d) => d.name)).toEqual(['good'])
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('falls back to no-arg OBJECT when inputSchema cannot be converted', () => {
    const result = buildGeminiFunctionDeclarations([
      { name: 'broken', inputSchema: { $ref: '#/definitions/X' } }
    ])
    expect(result[0]).toEqual({
      name: 'broken',
      parameters: { type: 'OBJECT', properties: {} }
    })
  })

  it('round-trips every tool in the AGBench MCP surface', () => {
    // Snapshot copy of `mcpToolDefinitions()` from src/main/index.ts —
    // a pure literal. Kept here (rather than imported) so the test
    // doesn't have to boot Electron via index.ts. If you add or change
    // a tool, mirror the change here.
    const tools = MCP_TOOL_DEFINITIONS_SNAPSHOT
    const declarations = buildGeminiFunctionDeclarations(tools)

    expect(declarations.map((d) => d.name)).toEqual(tools.map((t) => t.name))
    for (const declaration of declarations) {
      // Every declaration should at minimum have an OBJECT parameters
      // shape. None should be missing the name or have a non-object
      // parameters.
      expect(typeof declaration.name).toBe('string')
      expect(declaration.parameters?.type).toBe('OBJECT')
      // Properties is always an object (possibly empty for no-arg tools).
      expect(typeof declaration.parameters?.properties).toBe('object')
    }
  })

  it('warns are silenced for plain conversions (regression guard)', () => {
    buildGeminiFunctionDeclarations([
      {
        name: 'tidy',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id']
        }
      }
    ])
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

/**
 * Snapshot of `mcpToolDefinitions()` from `src/main/index.ts`. The
 * function is a pure literal, but importing `src/main/index.ts` in
 * tests pulls in Electron + node-pty + the rest of the main-process
 * world — too heavy for a unit test. The shape below mirrors the
 * literal so the round-trip test exercises every AGBench MCP tool.
 *
 * The list is intentionally exhaustive (37 entries). Each entry is the
 * minimal subset of fields the converter touches: `name`, optional
 * `description`, optional `inputSchema`. We do NOT need the
 * `annotations` block, so it's omitted to keep this snapshot compact.
 */
const MCP_TOOL_DEFINITIONS_SNAPSHOT: Array<{
  name: string
  description?: string
  inputSchema?: unknown
}> = [
  {
    name: 'run_shell_command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: {
          type: 'string',
          description: 'Optional workspace-relative or in-workspace absolute cwd.'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'write_file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'replace',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'read_file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
  },
  {
    name: 'workspace_search',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        path: { type: 'string' },
        globs: { type: 'array', items: { type: 'string' } },
        contextLines: { type: 'number' },
        maxResults: { type: 'number' }
      },
      required: ['query']
    }
  },
  {
    name: 'apply_patch',
    inputSchema: {
      type: 'object',
      properties: {
        patch: { type: 'string' },
        dryRun: { type: 'boolean' },
        check: { type: 'boolean' }
      },
      required: ['patch']
    }
  },
  {
    name: 'git_status',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'git_diff',
    inputSchema: {
      type: 'object',
      properties: {
        cached: { type: 'boolean' },
        staged: { type: 'boolean' },
        stat: { type: 'boolean' },
        paths: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'git_stage',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' } },
        patch: {
          type: 'string',
          description: 'Optional unified diff to stage with git apply --cached.'
        },
        all: { type: 'boolean' },
        update: { type: 'boolean' }
      }
    }
  },
  {
    name: 'git_commit',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message']
    }
  },
  {
    name: 'run_task',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        timeoutMs: { type: 'number' }
      },
      required: ['task']
    }
  },
  {
    name: 'test_result_summary',
    inputSchema: {
      type: 'object',
      properties: { output: { type: 'string' }, runId: { type: 'string' } }
    }
  },
  {
    name: 'list_subthreads',
    inputSchema: {
      type: 'object',
      properties: {
        parentChatId: { type: 'string' },
        includeArchived: { type: 'boolean' },
        includePrompt: { type: 'boolean' }
      }
    }
  },
  {
    name: 'read_subthread_result',
    inputSchema: {
      type: 'object',
      properties: {
        subThreadId: { type: 'string' },
        depth: { type: 'string', enum: ['summary', 'final-only', 'full', 'events-only'] },
        includeRuns: { type: 'boolean' },
        includeMessages: { type: 'boolean' },
        includeEvents: { type: 'boolean' },
        messageLimit: { type: 'number' },
        eventLimit: { type: 'number' }
      },
      required: ['subThreadId']
    }
  },
  {
    name: 'cancel_subthread',
    inputSchema: {
      type: 'object',
      properties: { subThreadId: { type: 'string' }, reason: { type: 'string' } },
      required: ['subThreadId']
    }
  },
  {
    name: 'workspace_symbols',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        path: { type: 'string' },
        maxResults: { type: 'number' }
      }
    }
  },
  {
    name: 'browser_open',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        path: { type: 'string' },
        show: { type: 'boolean' },
        width: { type: 'number' },
        height: { type: 'number' }
      }
    }
  },
  {
    name: 'browser_click',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' }
      }
    }
  },
  {
    name: 'browser_screenshot',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional workspace-relative output path.' }
      }
    }
  },
  {
    name: 'attached_window_capture',
    inputSchema: {
      type: 'object',
      properties: {
        include_ocr: { type: 'boolean' },
        max_dimension_px: { type: 'number' }
      }
    }
  },
  {
    name: 'attached_window_status',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'browser_console',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['browser', 'app', 'all'] },
        clear: { type: 'boolean' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'approval_status',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['gemini', 'codex', 'claude', 'kimi'] },
        service: {
          type: 'string',
          enum: ['shellCommands', 'fileChanges', 'mcpTools', 'subThreadDelegation']
        },
        approvalId: { type: 'string' },
        runId: { type: 'string' },
        chatId: { type: 'string' },
        statuses: { type: 'array', items: { type: 'string' } },
        scopes: { type: 'array', items: { type: 'string' } },
        includeExpired: { type: 'boolean' },
        includePreview: { type: 'boolean' },
        all: { type: 'boolean' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'provider_auth_status',
    inputSchema: {
      type: 'object',
      properties: { provider: { type: 'string', enum: ['gemini', 'codex', 'claude', 'kimi'] } }
    }
  },
  {
    name: 'run_timeline',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        limit: { type: 'number' },
        includeEvents: { type: 'boolean' },
        includePayload: { type: 'boolean' }
      }
    }
  },
  {
    name: 'raw_provider_events',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        chatId: { type: 'string' },
        provider: { type: 'string', enum: ['gemini', 'codex', 'claude', 'kimi'] },
        includeArtifacts: { type: 'boolean' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'open_workspace_file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, reveal: { type: 'boolean' } },
      required: ['path']
    }
  },
  {
    name: 'creative_app_status',
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', enum: ['final-cut-pro', 'logic-pro', 'blender'] }
      }
    }
  },
  {
    name: 'creative_app_capabilities',
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', enum: ['final-cut-pro', 'logic-pro', 'blender'] }
      }
    }
  },
  {
    name: 'creative_project_snapshot',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'creative_timeline_validate',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'creative_timeline_ir',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'create_handoff_card',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        finalPrompt: { type: 'string' },
        recommendedProvider: { type: 'string', enum: ['gemini', 'codex', 'claude', 'kimi'] },
        selectedFiles: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'switch_auth_profile',
    inputSchema: {
      type: 'object',
      properties: { provider: { type: 'string' }, profileId: { type: 'string' } }
    }
  },
  {
    name: 'agent_delegation_role',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['gemini', 'codex', 'claude', 'kimi'] },
        role: { type: 'string' },
        instructions: { type: 'string' }
      },
      required: ['provider', 'role']
    }
  },
  {
    name: 'delegate_to_subthread',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['gemini', 'codex', 'claude', 'kimi'] },
        prompt: { type: 'string' },
        returnResult: { type: 'boolean' },
        subThreadId: { type: 'string' }
      },
      required: ['provider', 'prompt']
    }
  }
]
