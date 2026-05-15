import { describe, expect, it } from 'vitest';
import { extractDelegationAuditItems } from './DelegationAudit';

describe('extractDelegationAuditItems', () => {
  it('normalizes Gemini invoke_agent events', () => {
    const activities = extractDelegationAuditItems([
      {
        type: 'tool',
        content: JSON.stringify({
          type: 'invoke_agent',
          tool_id: 'delegate-1',
          payload: {
            agent_name: 'generalist',
            summary: 'Inspect source files and report back.'
          }
        })
      }
    ], 'gemini');

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      provider: 'gemini',
      kind: 'subagent',
      name: 'generalist',
      summary: 'Inspect source files and report back.'
    });
  });

  it('normalizes Codex collab tool calls', () => {
    const activities = extractDelegationAuditItems([
      {
        type: 'tool',
        content: JSON.stringify({
          method: 'item/started',
          params: {
            threadId: 'parent-thread',
            item: {
              id: 'collab-1',
              type: 'collabToolCall',
              agentName: 'Explorer',
              prompt: 'Map provider event handling.'
            }
          }
        })
      }
    ], 'codex');

    expect(activities[0]).toMatchObject({
      provider: 'codex',
      kind: 'subagent',
      name: 'Explorer',
      promptPreview: 'Map provider event handling.'
    });
  });

  it('normalizes Claude Agent and Task tool calls', () => {
    const activities = extractDelegationAuditItems([
      {
        type: 'tool',
        content: JSON.stringify({
          type: 'tool_use',
          tool_name: 'Agent',
          tool_id: 'agent-1',
          parameters: {
            agent_name: 'reviewer',
            prompt: 'Review the patch for regressions.'
          }
        })
      },
      {
        type: 'tool',
        content: JSON.stringify({
          type: 'tool_result',
          tool_name: 'Agent',
          tool_id: 'agent-1',
          status: 'success',
          output: 'No regressions found.'
        })
      }
    ], 'claude');

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      provider: 'claude',
      status: 'success',
      name: 'reviewer',
      summary: 'No regressions found.'
    });
  });

  it('normalizes Kimi Wire SubagentEvent payloads', () => {
    const activities = extractDelegationAuditItems([
      {
        type: 'stdout',
        content: JSON.stringify({
          method: 'event',
          params: {
            type: 'SubagentEvent',
            parent_tool_call_id: 'tool-parent',
            agent_id: 'agent-42',
            subagent_type: 'explore',
            payload: {
              status: 'running',
              summary: 'Exploring the source tree.'
            }
          }
        })
      }
    ], 'kimi');

    expect(activities[0]).toMatchObject({
      provider: 'kimi',
      providerAgentId: 'agent-42',
      parentToolCallId: 'tool-parent',
      name: 'explore'
    });
  });
});
