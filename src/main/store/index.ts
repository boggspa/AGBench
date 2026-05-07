import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppSettings, WorkspaceRecord, ChatRecord, UsageRecord, ScheduledTask, RunQueueJob, RunQueueJobFilter, RunEventFilter, RunEventInput, RunEventRecord, ApprovalLedgerFilter, ApprovalLedgerRecord, ApprovalLedgerRequestInput, AgentApprovalAction, ApprovalLedgerScope, ProviderId, RunRecoveryFilter, RunRecoveryRecord, WorkspaceChangeFilter, WorkspaceChangeSet, WorkspaceChangeSetInput, WorkspaceEditorChangeInput, WorkspaceRunChangeInput, ProductCrashFilter, ProductCrashInput, ProductCrashRecord } from './types';
import { randomUUID } from 'crypto';
import { createRunQueueJob, filterRunQueueJobs, recoverInterruptedRunQueueJobs as recoverInterruptedQueueJobs, sortRunQueueJobs, updateRunQueueJobRecord, type RunQueueJobInput } from '../RunQueue';
import { createRunEventRecord, createRunEventReplay, filterRunEvents, nextRunEventSequence, parseRunEventLine, safeRunEventFileName, serializeRunEventRecord } from '../RunEventStore';
import { createApprovalLedgerRecord, expireScopedApprovalLedgerRecords, filterApprovalLedgerRecords, recoverExpiredApprovalLedgerRecords, resolveApprovalLedgerRecord } from '../ApprovalLedger';
import { filterRunRecoveryRecords, recoverRunQueueJobsAfterStartup } from '../RunRecovery';
import { createWorkspaceChangeSet, createWorkspaceChangeSetFromEditorWrite, createWorkspaceChangeSetFromRunDiff, filterWorkspaceChangeSets } from '../WorkspaceChangeModel';
import { createProductCrashRecord, filterProductCrashRecords } from '../ProductOperations';

const userDataPath = app.getPath('userData');
const settingsPath = path.join(userDataPath, 'settings.json');
const workspacesPath = path.join(userDataPath, 'workspaces.json');
const usagePath = path.join(userDataPath, 'usage.json');
const scheduledTasksPath = path.join(userDataPath, 'scheduled-tasks.json');
const runQueuePath = path.join(userDataPath, 'run-queue.json');
const runRecoveryPath = path.join(userDataPath, 'run-recovery.json');
const workspaceChangesPath = path.join(userDataPath, 'workspace-changes.json');
const approvalLedgerPath = path.join(userDataPath, 'approval-ledger.json');
const productCrashesPath = path.join(userDataPath, 'product-crashes.json');
const chatsDir = path.join(userDataPath, 'chats');
const runEventsDir = path.join(userDataPath, 'run-events');
const runEventSequenceCache = new Map<string, number>();

const defaultSettings: AppSettings = {
  activeProvider: 'gemini',
  claudeBinaryPath: '',
  kimiBinaryPath: '',
  storeLocalChatHistory: true,
  storeRawEvents: false,
  storePromptResponseInUsage: false,
  geminiCheckpointingEnabled: false,
  chatContextTurns: 6,
  appearanceMode: 'soft_glass',
  visualEffectStyle: 'auto',
  themeAppearance: 'system',
  themeCornerStyle: 'rounded',
  themeAccentStyle: 'system',
  promptSurfaceStyle: 'liquid_glass',
  reduceTransparency: false,
  reduceMotion: false,
  compactDensity: false,
  showInspector: true,
  inspectorWidth: 380,
  sidebarWidth: 260,
  agenticServices: {
    shellCommands: 'workspace',
    fileChanges: 'ask',
    mcpTools: 'ask',
    networkAccess: 'allow'
  },
  agenticWorkspaceGrants: [],
  geminiMcpBridgeEnabled: false,
  geminiMcpBridgeLastStatus: undefined,
  codexSandboxFallback: 'ask_rerun',
  updateChannel: 'debug',
};

function readJson<T>(filePath: string, defaultData: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error(`Failed to read ${filePath}`, e);
  }
  return defaultData;
}

function writeJson<T>(filePath: string, data: T) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error(`Failed to write ${filePath}`, e);
  }
}

function runEventFilePath(runId: string): string {
  return path.join(runEventsDir, safeRunEventFileName(runId));
}

function readRunEventFile(filePath: string): RunEventRecord[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs
      .readFileSync(filePath, 'utf-8')
      .split(/\r?\n/)
      .map(parseRunEventLine)
      .filter((event): event is RunEventRecord => Boolean(event));
  } catch (e) {
    console.error(`Failed to read ${filePath}`, e);
    return [];
  }
}

function readAllRunEventFiles(): RunEventRecord[] {
  try {
    if (!fs.existsSync(runEventsDir)) return [];
    return fs
      .readdirSync(runEventsDir)
      .filter((file) => file.endsWith('.jsonl'))
      .flatMap((file) => readRunEventFile(path.join(runEventsDir, file)));
  } catch (e) {
    console.error(`Failed to read ${runEventsDir}`, e);
    return [];
  }
}

export class AppStore {
  // Settings
  static getSettings(): AppSettings {
    const stored = readJson<Partial<AppSettings>>(settingsPath, {});
    return {
      ...defaultSettings,
      ...stored,
      agenticServices: {
        ...defaultSettings.agenticServices,
        ...(stored.agenticServices || {})
      },
      agenticWorkspaceGrants: Array.isArray(stored.agenticWorkspaceGrants) ? stored.agenticWorkspaceGrants : []
    };
  }

  static updateSettings(partial: Partial<AppSettings>) {
    const current = this.getSettings();
    writeJson(settingsPath, { ...current, ...partial });
  }

  // Workspaces
  static getWorkspaces(): WorkspaceRecord[] {
    return readJson<WorkspaceRecord[]>(workspacesPath, []);
  }

  static addOrUpdateWorkspace(workspacePath: string, partial: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
    const workspaces = this.getWorkspaces();
    let ws = workspaces.find(w => w.path === workspacePath);
    if (!ws) {
      ws = {
        id: randomUUID(),
        path: workspacePath,
        displayName: path.basename(workspacePath) || workspacePath,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        pinned: false,
        ...partial
      };
      workspaces.push(ws);
    } else {
      ws = { ...ws, ...partial, lastOpenedAt: Date.now() };
      const index = workspaces.findIndex(w => w.path === workspacePath);
      workspaces[index] = ws;
    }
    writeJson(workspacesPath, workspaces);
    return ws;
  }

  static removeWorkspace(workspaceId: string) {
    const workspaces = this.getWorkspaces().filter(w => w.id !== workspaceId);
    writeJson(workspacesPath, workspaces);
  }

  static clearWorkspaces() {
    writeJson(workspacesPath, []);
  }

  // Chats
  static getChats(workspaceId?: string): ChatRecord[] {
    if (!fs.existsSync(chatsDir)) return [];
    const files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.json'));
    const chats: ChatRecord[] = [];
    for (const file of files) {
      const chat = readJson<ChatRecord | null>(path.join(chatsDir, file), null);
      if (chat) {
        if (!workspaceId || chat.workspaceId === workspaceId) {
          chats.push(chat);
        }
      }
    }
    return chats.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  static getChat(chatId: string): ChatRecord | null {
    const chatPath = path.join(chatsDir, `${chatId}.json`);
    return readJson<ChatRecord | null>(chatPath, null);
  }

  static createChat(workspaceId: string, workspacePath: string): ChatRecord {
    const settings = this.getSettings();
    const chat: ChatRecord = {
      appChatId: randomUUID(),
      provider: settings.activeProvider || 'gemini',
      title: 'New Chat',
      workspaceId,
      workspacePath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archived: false,
      messages: [],
      runs: []
    };
    if (settings.storeLocalChatHistory) {
      this.saveChat(chat);
    }
    return chat;
  }

  static saveChat(chat: ChatRecord) {
    const settings = this.getSettings();
    if (!settings.storeLocalChatHistory) return;

    chat.updatedAt = Date.now();
    const chatPath = path.join(chatsDir, `${chat.appChatId}.json`);
    writeJson(chatPath, chat);
  }

  static deleteChat(chatId: string) {
    const chatPath = path.join(chatsDir, `${chatId}.json`);
    if (fs.existsSync(chatPath)) {
      fs.unlinkSync(chatPath);
    }
  }

  static clearChats(workspaceId?: string) {
    const chats = this.getChats(workspaceId);
    for (const chat of chats) {
      this.deleteChat(chat.appChatId);
    }
  }

  // Usage
  static getUsage(workspaceId?: string, chatId?: string) {
    const records = readJson<UsageRecord[]>(usagePath, []);
    return records.filter((record) => {
      if (workspaceId && record.workspaceId !== workspaceId) return false;
      if (chatId && record.chatId !== chatId) return false;
      return true;
    });
  }

  static recordUsage(usage: Omit<UsageRecord, 'id' | 'timestamp'>) {
    const settings = this.getSettings();
    const records = readJson<UsageRecord[]>(usagePath, []);
    
    const record: UsageRecord = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...usage
    };

    if (!settings.storePromptResponseInUsage) {
      delete record.promptText;
      delete record.responseText;
    }

    records.push(record);
    writeJson(usagePath, records);
  }

  // Scheduled tasks
  static getScheduledTasks(workspaceId?: string): ScheduledTask[] {
    const tasks = readJson<ScheduledTask[]>(scheduledTasksPath, []);
    return tasks
      .filter((task) => !workspaceId || task.workspaceId === workspaceId)
      .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime());
  }

  static saveScheduledTask(task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'> & Partial<Pick<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'status'>>): ScheduledTask {
    const tasks = this.getScheduledTasks();
    const now = new Date().toISOString();
    const record: ScheduledTask = {
      ...task,
      id: task.id || randomUUID(),
      status: task.status || 'pending',
      createdAt: task.createdAt || now,
      updatedAt: now
    };
    const index = tasks.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      tasks[index] = { ...tasks[index], ...record, updatedAt: now };
    } else {
      tasks.push(record);
    }
    writeJson(scheduledTasksPath, tasks);
    return record;
  }

  static updateScheduledTask(id: string, partial: Partial<ScheduledTask>): ScheduledTask | null {
    const tasks = this.getScheduledTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    const updated = { ...tasks[index], ...partial, id, updatedAt: new Date().toISOString() };
    tasks[index] = updated;
    writeJson(scheduledTasksPath, tasks);
    return updated;
  }

  static deleteScheduledTask(id: string) {
    writeJson(scheduledTasksPath, this.getScheduledTasks().filter((task) => task.id !== id));
  }

  static getDueScheduledTasks(nowMs: number = Date.now()): ScheduledTask[] {
    return this.getScheduledTasks().filter((task) => {
      if (task.status !== 'pending') return false;
      const runAtMs = new Date(task.runAt).getTime();
      return Number.isFinite(runAtMs) && runAtMs <= nowMs;
    });
  }

  // Run queue
  static getRunQueueJobs(filter: RunQueueJobFilter = {}): RunQueueJob[] {
    const jobs = readJson<RunQueueJob[]>(runQueuePath, []);
    return sortRunQueueJobs(filterRunQueueJobs(jobs, filter));
  }

  static getRunQueueJob(runIdOrId: string): RunQueueJob | null {
    const jobs = readJson<RunQueueJob[]>(runQueuePath, []);
    return jobs.find((job) => job.id === runIdOrId || job.runId === runIdOrId) || null;
  }

  static saveRunQueueJob(input: RunQueueJobInput): RunQueueJob {
    const jobs = readJson<RunQueueJob[]>(runQueuePath, []);
    const index = jobs.findIndex((job) => job.id === input.id || job.runId === input.runId);
    const now = new Date().toISOString();
    const record = index >= 0
      ? updateRunQueueJobRecord(jobs[index], input, now)
      : createRunQueueJob(input, now);

    if (index >= 0) {
      jobs[index] = record;
    } else {
      jobs.push(record);
    }
    writeJson(runQueuePath, sortRunQueueJobs(jobs));
    return record;
  }

  static updateRunQueueJob(runIdOrId: string, partial: Partial<RunQueueJob>): RunQueueJob | null {
    const jobs = readJson<RunQueueJob[]>(runQueuePath, []);
    const index = jobs.findIndex((job) => job.id === runIdOrId || job.runId === runIdOrId);
    if (index < 0) return null;
    const updated = updateRunQueueJobRecord(jobs[index], partial);
    jobs[index] = updated;
    writeJson(runQueuePath, sortRunQueueJobs(jobs));
    return updated;
  }

  static deleteRunQueueJob(runIdOrId: string) {
    const jobs = readJson<RunQueueJob[]>(runQueuePath, []);
    writeJson(runQueuePath, jobs.filter((job) => job.id !== runIdOrId && job.runId !== runIdOrId));
  }

  static recoverInterruptedRunQueueJobs(): RunQueueJob[] {
    const jobs = readJson<RunQueueJob[]>(runQueuePath, []);
    const recovered = recoverInterruptedQueueJobs(jobs);
    writeJson(runQueuePath, sortRunQueueJobs(recovered));
    return recovered;
  }

  static recoverRunQueueAfterStartup(): RunRecoveryRecord[] {
    const jobs = readJson<RunQueueJob[]>(runQueuePath, []);
    const recovered = recoverRunQueueJobsAfterStartup(jobs);
    writeJson(runQueuePath, sortRunQueueJobs(recovered.jobs));
    if (recovered.records.length > 0) {
      const records = readJson<RunRecoveryRecord[]>(runRecoveryPath, []);
      writeJson(runRecoveryPath, [...records, ...recovered.records]);
    }
    return recovered.records;
  }

  static getRunRecoveryRecords(filter: RunRecoveryFilter = {}): RunRecoveryRecord[] {
    const records = readJson<RunRecoveryRecord[]>(runRecoveryPath, []);
    return filterRunRecoveryRecords(Array.isArray(records) ? records : [], filter);
  }

  // Run transcript/event store
  static appendRunEvent(input: RunEventInput): RunEventRecord {
    const filePath = runEventFilePath(input.runId);
    const cachedSequence = runEventSequenceCache.get(input.runId);
    const sequence = cachedSequence !== undefined
      ? cachedSequence + 1
      : nextRunEventSequence(readRunEventFile(filePath));
    const settings = this.getSettings();
    const record = createRunEventRecord(input, sequence, {
      storeRawPayload: settings.storeRawEvents
    });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, serializeRunEventRecord(record), 'utf-8');
    runEventSequenceCache.set(input.runId, record.sequence);
    return record;
  }

  static appendRunEvents(inputs: RunEventInput[]): RunEventRecord[] {
    return inputs.map((input) => this.appendRunEvent(input));
  }

  static getRunEvents(filter: RunEventFilter = {}): RunEventRecord[] {
    const events = filter.runId
      ? readRunEventFile(runEventFilePath(filter.runId))
      : readAllRunEventFiles();
    return filterRunEvents(events, filter);
  }

  static getRunEventReplay(runId: string) {
    return createRunEventReplay(runId, readRunEventFile(runEventFilePath(runId)));
  }

  // Workspace change model
  static getWorkspaceChangeSets(filter: WorkspaceChangeFilter = {}): WorkspaceChangeSet[] {
    const records = readJson<WorkspaceChangeSet[]>(workspaceChangesPath, []);
    return filterWorkspaceChangeSets(Array.isArray(records) ? records : [], filter);
  }

  static saveWorkspaceChangeSet(input: WorkspaceChangeSetInput): WorkspaceChangeSet {
    const records = readJson<WorkspaceChangeSet[]>(workspaceChangesPath, []);
    const record = createWorkspaceChangeSet(input);
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      records[index] = {
        ...records[index],
        ...record,
        id: records[index].id,
        createdAt: records[index].createdAt
      };
    } else {
      records.push(record);
    }
    writeJson(workspaceChangesPath, filterWorkspaceChangeSets(records));
    return index >= 0 ? records[index] : record;
  }

  static recordWorkspaceRunChange(input: WorkspaceRunChangeInput): WorkspaceChangeSet {
    return this.saveWorkspaceChangeSet(createWorkspaceChangeSetFromRunDiff(input));
  }

  static recordWorkspaceEditorChange(input: WorkspaceEditorChangeInput): WorkspaceChangeSet {
    return this.saveWorkspaceChangeSet(createWorkspaceChangeSetFromEditorWrite(input));
  }

  // Approval ledger
  static getApprovalLedger(filter: ApprovalLedgerFilter = {}): ApprovalLedgerRecord[] {
    const records = this.recoverExpiredApprovalLedger();
    return filterApprovalLedgerRecords(records, filter);
  }

  static recordApprovalRequest(input: ApprovalLedgerRequestInput): ApprovalLedgerRecord {
    const records = this.recoverExpiredApprovalLedger();
    const record = createApprovalLedgerRecord(input);
    const index = records.findIndex((item) => item.approvalId === record.approvalId);
    if (index >= 0) {
      records[index] = {
        ...records[index],
        ...record,
        id: records[index].id,
        requestedAt: records[index].requestedAt
      };
    } else {
      records.push(record);
    }
    writeJson(approvalLedgerPath, records);
    return index >= 0 ? records[index] : record;
  }

  static resolveApprovalRequest(approvalId: string, action: AgentApprovalAction): ApprovalLedgerRecord | null {
    const records = this.recoverExpiredApprovalLedger();
    const index = records.findIndex((record) => record.approvalId === approvalId);
    if (index < 0) return null;
    const updated = resolveApprovalLedgerRecord(records[index], action);
    records[index] = updated;
    writeJson(approvalLedgerPath, records);
    return updated;
  }

  static expireApprovalLedgerScope(filter: {
    runId?: string;
    provider?: ProviderId;
    workspacePath?: string;
    scopes: ApprovalLedgerScope[];
    reason: string;
  }): ApprovalLedgerRecord[] {
    const records = this.recoverExpiredApprovalLedger();
    const updated = expireScopedApprovalLedgerRecords(records, filter);
    writeJson(approvalLedgerPath, updated);
    return updated;
  }

  static recoverExpiredApprovalLedger(): ApprovalLedgerRecord[] {
    const stored = readJson<ApprovalLedgerRecord[] | unknown>(approvalLedgerPath, []);
    const records = Array.isArray(stored) ? stored : [];
    const recovered = recoverExpiredApprovalLedgerRecords(records);
    const changed = !Array.isArray(stored) || recovered.some((record, index) => record !== records[index]);
    if (changed) {
      writeJson(approvalLedgerPath, recovered);
    }
    return recovered;
  }

  // Product operations
  static getProductCrashes(filter: ProductCrashFilter = {}): ProductCrashRecord[] {
    const records = readJson<ProductCrashRecord[] | unknown>(productCrashesPath, []);
    return filterProductCrashRecords(Array.isArray(records) ? records : [], filter);
  }

  static recordProductCrash(input: ProductCrashInput): ProductCrashRecord {
    const records = readJson<ProductCrashRecord[] | unknown>(productCrashesPath, []);
    const current = Array.isArray(records) ? records : [];
    const record = createProductCrashRecord(input, {
      appVersion: app.getVersion() || 'unknown',
      platform: process.platform,
      arch: process.arch
    });
    current.push(record);
    writeJson(productCrashesPath, filterProductCrashRecords(current, { limit: 200 }));
    return record;
  }
}
