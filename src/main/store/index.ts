import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppSettings, WorkspaceRecord, ChatRecord, UsageRecord, ScheduledTask, RunQueueJob, RunQueueJobFilter } from './types';
import { randomUUID } from 'crypto';
import { createRunQueueJob, filterRunQueueJobs, recoverInterruptedRunQueueJobs as recoverInterruptedQueueJobs, sortRunQueueJobs, updateRunQueueJobRecord, type RunQueueJobInput } from '../RunQueue';

const userDataPath = app.getPath('userData');
const settingsPath = path.join(userDataPath, 'settings.json');
const workspacesPath = path.join(userDataPath, 'workspaces.json');
const usagePath = path.join(userDataPath, 'usage.json');
const scheduledTasksPath = path.join(userDataPath, 'scheduled-tasks.json');
const runQueuePath = path.join(userDataPath, 'run-queue.json');
const chatsDir = path.join(userDataPath, 'chats');

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
}
