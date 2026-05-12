import { useEffect, useState, type RefObject } from 'react';
import { DiffViewer } from './DiffViewer';
import { TerminalPanel } from './TerminalPanel';
import type { DiffFileSummary, ProviderId, ExternalPathGrant, GeminiMcpBridgeStatus, ProviderCapabilityContract, ProviderToolingCapability } from '../../../main/store/types';

type InspectorTab = 'diff' | 'raw' | 'safety' | 'capabilities';
type CapabilityKind = 'mcp' | 'extensions' | 'skills';
type CapabilityFormat = 'json' | 'raw' | 'error';

interface GeminiCapabilityItem {
  id: string;
  name: string;
  status?: string;
  detail?: string;
  raw: string;
}

interface GeminiCapabilitySection {
  kind: CapabilityKind;
  command: string[];
  format: CapabilityFormat;
  items: GeminiCapabilityItem[];
  stdout: string;
  stderr: string;
  status: number | null;
  timedOut: boolean;
  error?: string;
  parsingError?: string;
  truncated?: boolean;
}

interface GeminiCapabilitiesState {
  refreshedAt: string;
  workspace?: string;
  sections: Record<CapabilityKind, GeminiCapabilitySection>;
}

const CAPABILITY_ORDER: CapabilityKind[] = ['mcp', 'extensions', 'skills'];
const CAPABILITY_LABELS: Record<CapabilityKind, string> = {
  mcp: 'MCP servers',
  extensions: 'Extensions',
  skills: 'Skills',
};

function providerLabel(provider: ProviderId): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'claude') return 'Claude';
  if (provider === 'kimi') return 'Kimi';
  return 'Gemini';
}

interface InspectorProps {
  rightTab: InspectorTab;
  setRightTab: (tab: InspectorTab) => void;
  activeDiff: any;
  refreshDiff: () => void;
  currentWorkspace: any;
  diffView: 'this_run' | 'workspace';
  setDiffView: (v: 'this_run' | 'workspace') => void;
  runDiff: DiffFileSummary[] | null;
  diffRefreshStatus: string;
  rawLogs: Array<{
    type: 'stdout' | 'stderr' | 'tool' | 'info';
    content: string;
    sequence?: number;
    hash?: string;
    spanId?: string;
    toolCallId?: string;
    artifactCount?: number;
  }>;
  rawFilter: 'all' | 'stdout' | 'stderr' | 'tool';
  setRawFilter: (f: 'all' | 'stdout' | 'stderr' | 'tool') => void;
  setRawLogs: (logs: any[]) => void;
  rawLogsEndRef: RefObject<HTMLDivElement | null>;
  geminiVersion: string;
  isOldVersion: boolean;
  trustResult: any;
  sessionTrust: boolean;
  setSessionTrust: (v: boolean) => void;
  showTerminal: boolean;
  setShowTerminal: (v: boolean) => void;
  workspacePath?: string;
  provider: ProviderId;
  approvalMode: string;
  codexStatus?: any;
  codexModels?: Array<{ id: string; label?: string; defaultReasoningEffort?: string | null; additionalSpeedTiers?: string[]; supportedReasoningEfforts?: Array<{ reasoningEffort: string }> }>;
  codexMcpStatus?: any;
  providerCapabilities?: ProviderCapabilityContract | null;
  codexThreads?: any[];
  codexExternalPathGrants?: ExternalPathGrant[];
  geminiMcpBridgeEnabled?: boolean;
  geminiMcpBridgeStatus?: GeminiMcpBridgeStatus | null;
  onRefreshCodexThreads?: () => void;
  onResumeCodexThread?: (threadId: string) => void;
  onForkCodexThread?: (threadId: string) => void;
  onRollbackCodexThread?: (threadId: string) => void;
  onImportCodexUsageCredential?: () => void;
  onClearCodexUsageCredential?: () => void;
  onInstallGeminiMcpBridge?: () => void;
  onRefreshGeminiMcpBridgeStatus?: () => void;
}

export function Inspector(props: InspectorProps) {
  return (
    <div className="app-inspector">
      <div className="inspector-tabs">
        {(['diff', 'raw', 'safety', 'capabilities'] as const).map(tab => (
          <button
            key={tab}
            className={`inspector-tab ${props.rightTab === tab ? 'active' : ''}`}
            onClick={() => props.setRightTab(tab)}
          >
            {tab === 'diff' ? 'Diff Studio' : tab === 'raw' ? 'Raw Events' : tab === 'safety' ? 'Safety' : 'Capabilities'}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {props.rightTab === 'diff' && <DiffTab {...props} />}
        {props.rightTab === 'raw' && <RawTab {...props} />}
        {props.rightTab === 'safety' && <SafetyTab {...props} />}
        {props.rightTab === 'capabilities' && <CapabilitiesTab {...props} />}
      </div>
    </div>
  );
}

function useGeminiCapabilities(workspacePath?: string) {
  const [capabilities, setCapabilities] = useState<GeminiCapabilitiesState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshCapabilities = () => {
    if (!workspacePath) {
      setCapabilities(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    window.api.getGeminiCapabilities(workspacePath)
      .then((nextCapabilities) => {
        setCapabilities(nextCapabilities);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    if (!workspacePath) {
      setCapabilities(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    window.api.getGeminiCapabilities(workspacePath)
      .then((nextCapabilities) => {
        if (!cancelled) setCapabilities(nextCapabilities);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  return { capabilities, isLoading, error, refreshCapabilities };
}

function DiffTab(props: InspectorProps) {
  return (
    <div className="diff-studio">
      <div className="diff-studio-toolbar">
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button
            className={`btn btn-sm ${props.diffView === 'this_run' ? '' : 'btn-ghost'}`}
            onClick={() => props.setDiffView('this_run')}
            disabled={!props.runDiff}
          >
            This run
          </button>
          <button
            className={`btn btn-sm ${props.diffView === 'workspace' ? '' : 'btn-ghost'}`}
            onClick={() => props.setDiffView('workspace')}
          >
            Workspace
          </button>
          {props.diffRefreshStatus && (
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--success)' }}>{props.diffRefreshStatus}</span>
          )}
        </div>
        <button className="btn btn-sm btn-ghost" onClick={props.refreshDiff} disabled={!props.currentWorkspace}>
          Refresh
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DiffViewer diff={props.activeDiff} workspacePath={props.workspacePath} />
      </div>
    </div>
  );
}

function RawTab({ rawLogs, rawFilter, setRawFilter, setRawLogs, rawLogsEndRef }: InspectorProps) {
  return (
    <div className="diff-studio raw-events-panel">
      <div className="diff-studio-toolbar">
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['all', 'stdout', 'stderr', 'tool'] as const).map(f => (
            <button
              key={f}
              className={`btn btn-sm ${rawFilter === f ? '' : 'btn-ghost'}`}
              onClick={() => setRawFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              const text = rawLogs.map(l => `[${l.type.toUpperCase()}] ${l.content}`).join('\n');
              navigator.clipboard.writeText(text);
            }}
          >
            Copy
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setRawLogs([])}>Clear</button>
        </div>
      </div>
      <div className="raw-events-body">
        {rawLogs.filter(l => rawFilter === 'all' || l.type === rawFilter).map((log, i) => (
          <div
            key={i}
            className="raw-log-line"
            style={{
              color: log.type === 'stderr' ? 'var(--danger)' : log.type === 'tool' ? 'var(--success)' : log.type === 'info' ? 'var(--accent)' : 'var(--text-secondary)'
            }}
          >
            {(log.sequence || log.hash || log.spanId || log.toolCallId || log.artifactCount) && (
              <span className="raw-log-meta">
                {log.sequence ? `#${log.sequence}` : ''}
                {log.hash ? ` ${log.hash.slice(0, 10)}` : ''}
                {log.toolCallId ? ` tool:${log.toolCallId}` : log.spanId ? ` span:${log.spanId}` : ''}
                {log.artifactCount ? ` artifacts:${log.artifactCount}` : ''}
              </span>
            )}
            {log.content}
          </div>
        ))}
        <div ref={rawLogsEndRef} />
      </div>
    </div>
  );
}

function formatCapabilityTime(value?: string): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function commandStatusLabel(section: GeminiCapabilitySection): string {
  if (section.timedOut) return 'Timed out';
  if (section.error) return 'Error';
  if (section.status === 0) return 'OK';
  if (section.status === null) return 'Unknown';
  return `Exit ${section.status}`;
}

function commandStatusColor(section: GeminiCapabilitySection): string {
  if (section.status === 0 && !section.error && !section.timedOut) return 'var(--success)';
  if (section.timedOut || section.error || (section.status !== null && section.status !== 0)) return 'var(--danger)';
  return 'var(--text-secondary)';
}

function capabilityStatusColor(status?: string): string {
  const normalized = status?.toLowerCase() || '';
  if (/(enabled|active|running|connected|ok|installed|trusted|loaded)/.test(normalized)) return 'var(--success)';
  if (/(disabled|inactive|disconnected|unavailable)/.test(normalized)) return 'var(--warning)';
  if (/(error|failed|untrusted)/.test(normalized)) return 'var(--danger)';
  return 'var(--text-secondary)';
}

function truncateRawOutput(value: string, maxLength: number = 1800): string {
  if (!value.trim()) return '';
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n[preview truncated]`;
}

function toolingStateColor(state: ProviderToolingCapability['state']): string {
  if (state === 'available') return 'var(--success)';
  if (state === 'gated' || state === 'delegated') return 'var(--warning)';
  if (state === 'blocked' || state === 'unavailable') return 'var(--danger)';
  return 'var(--text-secondary)';
}

function toolingEnforcementLabel(tool: ProviderToolingCapability): string {
  if (tool.enforcedByAgentBench) return 'AGBench-enforced';
  if (tool.enforcement === 'provider') return 'provider-managed';
  if (tool.enforcement === 'best_effort') return 'best-effort';
  if (tool.enforcement === 'none') return 'not enforced';
  return tool.source === 'provider' ? 'provider-managed' : 'not enforced';
}

function toolingEnforcementColor(tool: ProviderToolingCapability): string {
  if (tool.enforcedByAgentBench) return 'var(--success)';
  if (tool.enforcement === 'best_effort') return 'var(--warning)';
  return 'var(--text-secondary)';
}

function ToolingContractCard({ contract }: { contract?: ProviderCapabilityContract | null }) {
  if (!contract) {
    return (
      <div className="safety-card">
        <h4>Tooling contract</h4>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
          Provider capability state has not been loaded yet.
        </p>
      </div>
    );
  }

  const tools = [contract.tools.shellCommands, contract.tools.fileChanges, contract.tools.mcpTools, contract.tools.networkAccess];
  const enforcedCount = tools.filter((tool) => tool.enforcedByAgentBench).length;
  return (
    <div className="safety-card">
      <h4>{contract.label} tooling contract</h4>
      <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
        Shared AGBench view of shell, file, MCP, approval, and unavailable-tool behavior for this provider.
      </p>
      <div className="safety-row"><span>Availability</span><span style={{ color: contract.availability.available ? 'var(--success)' : 'var(--danger)' }}>{contract.availability.available ? 'available' : 'unavailable'}</span></div>
      <div className="safety-row"><span>Version</span><span>{contract.availability.version || 'unknown'}</span></div>
      <div className="safety-row"><span>Approval mode</span><span>{contract.approvals.providerMode}</span></div>
      <div className="safety-row"><span>In-app approvals</span><span>{contract.approvals.inAppApprovals ? 'yes' : 'provider-managed'}</span></div>
      <div className="safety-row"><span>AGBench enforcement</span><span style={{ color: enforcedCount > 0 ? 'var(--success)' : 'var(--warning)' }}>{enforcedCount}/{tools.length} controls</span></div>
      <div className="safety-row"><span>MCP</span><span style={{ color: toolingStateColor(contract.mcp.state) }}>{contract.mcp.state}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
        {tools.map((tool) => (
          <div key={tool.id} style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 'var(--space-sm)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>{tool.label}</span>
              <span style={{ fontSize: 'var(--font-size-xs)', color: toolingStateColor(tool.state), whiteSpace: 'nowrap' }}>{tool.state}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)', marginTop: 2 }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Enforcement</span>
              <span style={{ fontSize: 'var(--font-size-xs)', color: toolingEnforcementColor(tool), whiteSpace: 'nowrap' }}>{toolingEnforcementLabel(tool)}</span>
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', marginTop: 2 }}>
              {tool.details || `${tool.source}${tool.policy ? ` · ${tool.policy}` : ''}`}
            </div>
            {tool.tools.length > 0 && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                {tool.tools.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
      {contract.warnings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', marginTop: 'var(--space-md)' }}>
          {contract.warnings.slice(0, 4).map((item) => (
            <div key={item.id} style={{ fontSize: 'var(--font-size-xs)', color: item.severity === 'error' ? 'var(--danger)' : item.severity === 'warning' ? 'var(--warning)' : 'var(--text-secondary)' }}>
              <strong>{item.title}</strong>: {item.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CapabilitiesTab(props: InspectorProps) {
  if (props.provider === 'codex') {
    return (
      <div className="safety-panel">
        <ToolingContractCard contract={props.providerCapabilities} />
        <div className="safety-card">
          <h4>Codex capabilities</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
            Codex capability discovery is provider-owned through app-server. Model list is available; richer MCP/plugin/app status can be layered onto this panel as the app-server status APIs are expanded.
          </p>
          <div className="safety-row"><span>CLI</span><span>{props.codexStatus?.version || 'unknown'}</span></div>
          <div className="safety-row"><span>App-server</span><span>{props.codexStatus?.appServer || 'lazy'}</span></div>
          <div className="safety-row"><span>Models</span><span>{props.codexModels?.length || 0}</span></div>
          <div className="safety-row"><span>MCP servers</span><span>{props.codexMcpStatus?.data?.length || 0}</span></div>
        </div>
        {(props.codexModels || []).slice(0, 10).map((model) => (
          <div key={model.id} className="safety-card">
            <h4>{model.label || model.id}</h4>
            <div className="safety-row"><span>Model id</span><span>{model.id}</span></div>
            <div className="safety-row"><span>Default effort</span><span>{model.defaultReasoningEffort || 'default'}</span></div>
            <div className="safety-row"><span>Speed tiers</span><span>{model.additionalSpeedTiers?.join(', ') || 'standard'}</span></div>
          </div>
        ))}
        {(props.codexMcpStatus?.data || []).slice(0, 8).map((server: any) => (
          <div key={server.name} className="safety-card">
            <h4>{server.name}</h4>
            <div className="safety-row"><span>Auth</span><span>{server.authStatus || 'unknown'}</span></div>
            <div className="safety-row"><span>Tools</span><span>{server.tools ? Object.keys(server.tools).length : 0}</span></div>
          </div>
        ))}
        <div className="safety-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <h4>Codex threads</h4>
            <button className="btn btn-sm btn-ghost" onClick={props.onRefreshCodexThreads} disabled={!props.onRefreshCodexThreads}>
              Refresh
            </button>
          </div>
          {(props.codexThreads || []).length === 0 ? (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              No persisted Codex threads found for this workspace yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
              {(props.codexThreads || []).slice(0, 8).map((thread: any) => (
                <div key={thread.id} style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 'var(--space-sm)' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {thread.name || thread.preview || thread.id}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {thread.status || 'unknown'} · {thread.modelProvider || 'openai'} · {thread.id}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                    <button className="btn btn-sm" onClick={() => props.onResumeCodexThread?.(thread.id)}>
                      Resume
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => props.onForkCodexThread?.(thread.id)}>
                      Fork
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => props.onRollbackCodexThread?.(thread.id)}
                      title="Rollback Codex thread history only. This does not revert workspace files."
                    >
                      Rollback thread
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (props.provider === 'claude' || props.provider === 'kimi') {
    const label = providerLabel(props.provider);
    return (
      <div className="safety-panel">
        <ToolingContractCard contract={props.providerCapabilities} />
        <div className="safety-card">
          <h4>{label} capabilities</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
            {label} is registered as a first-class provider. Structured quota, thread browser, and MCP status are shown only when the provider exposes safe machine-readable APIs.
          </p>
          <div className="safety-row"><span>Binary</span><span>{props.codexStatus?.binaryPath || 'not found'}</span></div>
          <div className="safety-row"><span>Version</span><span>{props.codexStatus?.version || 'unknown'}</span></div>
          <div className="safety-row"><span>Models</span><span>{props.codexModels?.length || 0}</span></div>
          <div className="safety-row"><span>Quota</span><span>unavailable</span></div>
          <div className="safety-row"><span>MCP status</span><span>{props.codexMcpStatus?.available ? 'available' : 'unavailable'}</span></div>
        </div>
        {(props.codexModels || []).map((model) => (
          <div key={model.id} className="safety-card">
            <h4>{model.label || model.id}</h4>
            <div className="safety-row"><span>Model id</span><span>{model.id}</span></div>
          </div>
        ))}
        <div className="safety-card">
          <h4>Sessions and review</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            Resume/fork/rollback controls stay disabled until {label} exposes stable structured session IDs and rollback semantics. Diff Studio remains shared for file changes.
          </p>
        </div>
      </div>
    );
  }

  const { currentWorkspace } = props;
  const workspacePath = currentWorkspace?.path;
  const { capabilities, isLoading, error, refreshCapabilities } = useGeminiCapabilities(workspacePath);

  return (
    <div className="safety-panel">
      <div className="diff-studio-toolbar">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            Gemini capability state
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {workspacePath || 'No workspace selected'}
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={refreshCapabilities} disabled={!workspacePath || isLoading}>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <ToolingContractCard contract={props.providerCapabilities} />

      <div className="safety-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)', alignItems: 'center' }}>
          <h4>AGBench MCP bridge</h4>
          <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
            <button className="btn btn-sm btn-ghost" onClick={props.onRefreshGeminiMcpBridgeStatus} disabled={!props.onRefreshGeminiMcpBridgeStatus}>
              Test
            </button>
            <button className="btn btn-sm" onClick={props.onInstallGeminiMcpBridge} disabled={!props.onInstallGeminiMcpBridge}>
              Install / repair
            </button>
          </div>
        </div>
        <div className="safety-row"><span>App setting</span><span>{props.geminiMcpBridgeEnabled ? 'enabled' : 'disabled'}</span></div>
        <div className="safety-row"><span>Gemini config</span><span>{props.geminiMcpBridgeStatus?.installed ? 'installed' : 'not installed'}</span></div>
        <div className="safety-row"><span>Status</span><span style={{ color: props.geminiMcpBridgeStatus?.available ? 'var(--success)' : 'var(--warning)' }}>{props.geminiMcpBridgeStatus?.available ? 'available' : 'unavailable'}</span></div>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 'var(--space-sm) 0 0 0' }}>
          {props.geminiMcpBridgeStatus?.message || 'Use Install / repair only when you want AGBench to update your Gemini MCP configuration.'}
        </p>
      </div>

      {!workspacePath && (
        <div className="safety-card">
          <h4>Workspace required</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            Select a workspace to inspect MCP servers, extensions, and skills in that Gemini CLI context.
          </p>
        </div>
      )}

      {workspacePath && isLoading && !capabilities && (
        <div className="safety-card">
          <h4>Loading capabilities...</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            Running read-only Gemini CLI list commands.
          </p>
        </div>
      )}

      {error && (
        <div className="safety-card">
          <h4>Capability scan failed</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--danger)', margin: 0 }}>{error}</p>
        </div>
      )}

      {capabilities && (
        <>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', padding: '0 var(--space-xs)' }}>
            Last refreshed {formatCapabilityTime(capabilities.refreshedAt)}
          </div>
          {CAPABILITY_ORDER.map((kind) => (
            <CapabilityCard key={kind} section={capabilities.sections[kind]} />
          ))}
        </>
      )}
    </div>
  );
}

function CapabilityCard({ section }: { section: GeminiCapabilitySection }) {
  const previewStdout = truncateRawOutput(section.stdout);
  const previewStderr = truncateRawOutput(section.stderr);

  return (
    <div className="safety-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <h4>{CAPABILITY_LABELS[section.kind]}</h4>
        <span style={{ fontSize: 'var(--font-size-xs)', color: commandStatusColor(section), whiteSpace: 'nowrap' }}>
          {commandStatusLabel(section)}
        </span>
      </div>

      <div className="safety-row">
        <span>Command</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>{section.command.join(' ')}</span>
      </div>
      <div className="safety-row"><span>Format</span><span>{section.format}</span></div>
      <div className="safety-row"><span>Entries</span><span>{section.items.length}</span></div>

      {section.parsingError && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--warning)', marginTop: 'var(--space-sm)' }}>
          JSON parse failed, using raw list output.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
        {section.items.length === 0 ? (
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            {section.status === 0 ? 'No entries parsed from command output.' : 'Command did not complete successfully.'}
          </div>
        ) : (
          section.items.slice(0, 8).map((item) => (
            <div key={`${section.kind}-${item.id}-${item.name}`} style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 'var(--space-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </span>
                {item.status && (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: capabilityStatusColor(item.status), whiteSpace: 'nowrap' }}>
                    {item.status}
                  </span>
                )}
              </div>
              {item.detail && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.detail}
                </div>
              )}
            </div>
          ))
        )}
        {section.items.length > 8 && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
            +{section.items.length - 8} more entries in raw output
          </div>
        )}
      </div>

      <details style={{ marginTop: 'var(--space-md)' }}>
        <summary style={{ cursor: 'pointer', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
          Raw stdout/stderr
        </summary>
        <pre style={{ margin: 'var(--space-sm) 0 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
{previewStdout || previewStderr ? `${previewStdout}${previewStdout && previewStderr ? '\n\n[stderr]\n' : ''}${previewStderr}` : 'No output'}
        </pre>
      </details>
    </div>
  );
}

function SafetyTab({
  provider,
  approvalMode,
  codexStatus,
  geminiVersion,
  isOldVersion,
  trustResult,
  showTerminal,
  setShowTerminal,
  currentWorkspace,
  onImportCodexUsageCredential,
  onClearCodexUsageCredential,
  codexExternalPathGrants = [],
}: InspectorProps) {
  if (provider === 'codex') {
    const sandbox = approvalMode === 'plan' ? 'read-only' : 'workspace-write';
    const approvalPolicy = approvalMode === 'auto_edit' || approvalMode === 'plan' ? 'never' : 'on-request';
    return (
      <div className="safety-panel">
        <div className="safety-card">
          <h4>Codex safety</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
            Codex runs through an app-owned app-server thread. Command and file approvals are routed back into this UI when the selected mode prompts.
          </p>
          <div className="safety-row"><span>Sandbox</span><span>{sandbox}</span></div>
          <div className="safety-row"><span>Approval policy</span><span>{approvalPolicy}</span></div>
          <div className="safety-row"><span>Auth state</span><span>{codexStatus?.authState || 'unknown'}</span></div>
          <div className="safety-row"><span>Plan</span><span>{codexStatus?.planType || 'unknown'}</span></div>
          <div className="safety-row"><span>Usage source</span><span>{codexStatus?.codexUsage?.windows?.length ? 'ChatGPT usage endpoint' : 'local fallback'}</span></div>
          <div className="safety-row"><span>Usage account</span><span>{codexStatus?.codexUsage?.accountId || 'not imported'}</span></div>
          <div className="safety-row"><span>External grants</span><span>{codexExternalPathGrants.length}</span></div>
          <div className="safety-row"><span>CLI</span><span>{codexStatus?.version || 'unknown'}</span></div>
          {codexStatus?.rateLimits && (
            <>
              <div className="safety-row"><span>Primary usage</span><span>{Math.round(codexStatus.rateLimits.primary?.usedPercent || 0)}%</span></div>
              <div className="safety-row"><span>Window</span><span>{codexStatus.rateLimits.primary?.windowDurationMins ? `${codexStatus.rateLimits.primary.windowDurationMins}m` : 'unknown'}</span></div>
            </>
          )}
        </div>
        {codexExternalPathGrants.length > 0 && (
          <div className="safety-card">
            <h4>Codex external path grants</h4>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
              These selected files or folders are passed as scoped sandbox roots for Codex app-server runs in this chat. Revoke them from the composer chip before the next run.
            </p>
            {codexExternalPathGrants.map((grant) => (
              <div className="safety-row" key={grant.id}>
                <span>{grant.access === 'write' ? 'Edit' : 'Read'} {grant.kind}</span>
                <span title={grant.path}>{grant.path}</span>
              </div>
            ))}
          </div>
        )}
        <div className="safety-card">
          <h4>Codex usage import</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
            For accurate 5h, weekly, and Spark meters, explicitly import your Codex session from <span style={{ fontFamily: 'var(--font-mono)' }}>~/.codex/auth.json</span>. The token is encrypted with Electron safeStorage when available and is only used to call ChatGPT usage limits.
          </p>
          {codexStatus?.codexUsage?.error && (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--warning)', margin: '0 0 var(--space-md) 0' }}>
              {codexStatus.codexUsage.error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
            <button className="btn" style={{ flex: 1 }} onClick={onImportCodexUsageCredential} disabled={!onImportCodexUsageCredential}>
              Import Codex usage session
            </button>
            <button className="btn btn-ghost" onClick={onClearCodexUsageCredential} disabled={!onClearCodexUsageCredential}>
              Clear
            </button>
          </div>
        </div>
        <div className="safety-card">
          <h4>Codex login</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
            If Codex reports missing auth in Raw Events, use this scoped terminal and run <span style={{ fontFamily: 'var(--font-mono)' }}>codex login</span>. Credentials are handled by the Codex CLI.
          </p>
          {currentWorkspace && !showTerminal && (
            <button className="btn" style={{ width: '100%' }} onClick={() => setShowTerminal(true)}>
              Open Codex login terminal...
            </button>
          )}
          {currentWorkspace && showTerminal && (
            <div className="trust-assistant-panel">
              <div className="trust-assistant-copy">
                <strong>Codex login terminal</strong>
                <span>Run codex login here if the app-server reports missing authentication.</span>
              </div>
              <TerminalPanel
                workspacePath={currentWorkspace.path}
                onClose={() => setShowTerminal(false)}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (provider === 'claude' || provider === 'kimi') {
    const label = providerLabel(provider);
    const setupCommand = provider === 'claude' ? 'claude auth login' : 'kimi login';
    const permissionText = provider === 'claude'
      ? approvalMode === 'plan' ? 'Claude plan mode' : approvalMode === 'auto_edit' ? 'Claude acceptEdits' : 'Claude default permissions'
      : approvalMode === 'plan' ? 'Kimi plan/read-only intent' : approvalMode === 'auto_edit' ? 'Kimi Wire approvals; YOLO not enabled' : 'Kimi Wire approvals';
    return (
      <div className="safety-panel">
        <div className="safety-card">
          <h4>{label} safety</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
            {label} runs through the provider adapter. Credential files are not read by this app; setup stays delegated to the provider CLI.
          </p>
          <div className="safety-row"><span>Binary</span><span>{codexStatus?.available ? 'available' : 'missing'}</span></div>
          <div className="safety-row"><span>Path</span><span>{codexStatus?.binaryPath || 'auto-detect failed'}</span></div>
          <div className="safety-row"><span>Version</span><span>{codexStatus?.version || 'unknown'}</span></div>
          <div className="safety-row"><span>Auth state</span><span>{codexStatus?.authState || 'unknown'}</span></div>
          <div className="safety-row"><span>Permissions</span><span>{permissionText}</span></div>
          {codexStatus?.error && (
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--warning)', margin: 'var(--space-sm) 0 0 0' }}>
              {codexStatus.error}
            </p>
          )}
        </div>
        <div className="safety-card">
          <h4>{label} setup</h4>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
            Use a scoped terminal for provider login/setup. For binary overrides, open Settings.
          </p>
          {currentWorkspace && !showTerminal && (
            <button className="btn" style={{ width: '100%' }} onClick={() => setShowTerminal(true)}>
              Open {label} setup terminal...
            </button>
          )}
          {currentWorkspace && showTerminal && (
            <div className="trust-assistant-panel">
              <div className="trust-assistant-copy">
                <strong>{label} setup terminal</strong>
                <span>Run {setupCommand} if this provider needs authentication or first-time setup.</span>
              </div>
              <TerminalPanel
                workspacePath={currentWorkspace.path}
                onClose={() => setShowTerminal(false)}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="safety-panel">
      <div className="safety-card">
        <h4>Workspace Trust</h4>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md) 0' }}>
          Gemini CLI enforces interactive workspace trust checks to prevent accidental execution in untrusted folders.
        </p>
        {currentWorkspace && trustResult?.status !== 'trusted' && trustResult?.status !== 'inherited' && (
          <div style={{ marginBottom: 'var(--space-md)' }}>
            {!showTerminal ? (
              <button className="btn" style={{ width: '100%', marginBottom: 'var(--space-sm)' }} onClick={() => setShowTerminal(true)}>
                Open Trust Assistant...
              </button>
            ) : (
              <div className="trust-assistant-panel">
                <div className="trust-assistant-copy">
                  <strong>Trust Assistant</strong>
                  <span>Use this scoped terminal only for Gemini workspace trust prompts.</span>
                </div>
                <TerminalPanel
                  workspacePath={currentWorkspace.path}
                  onClose={() => {
                    setShowTerminal(false);
                    window.api.checkTrust(currentWorkspace.path).then(() => {});
                  }}
                />
              </div>
            )}
          </div>
        )}
        <button className="btn btn-sm btn-ghost" style={{ width: '100%' }} onClick={() => navigator.clipboard.writeText('/permissions trust')}>
          Copy '/permissions trust'
        </button>
      </div>

      <div className="safety-card">
        <h4>CLI Details</h4>
        <div className="safety-row"><span>Version</span><span>{geminiVersion}</span></div>
        <div className="safety-row"><span>Sandbox</span><span style={{ color: 'var(--success)' }}>On</span></div>
        <div className="safety-row"><span>Yolo mode</span><span style={{ color: 'var(--danger)' }}>Blocked</span></div>
        <div className="safety-row"><span>Trust status</span><span style={{ color: trustResult?.status === 'trusted' || trustResult?.status === 'inherited' ? 'var(--success)' : trustResult?.status === 'untrusted' ? 'var(--danger)' : 'var(--text-secondary)' }}>{trustResult?.status || 'Unknown'}</span></div>
        {isOldVersion && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--warning)', marginTop: 'var(--space-sm)' }}>
            Upgrade to &gt;= 0.39.1 recommended for secure headless trust.
          </div>
        )}
      </div>
    </div>
  );
}
