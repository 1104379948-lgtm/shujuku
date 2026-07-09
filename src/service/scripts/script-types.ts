export type ScriptHookName_ACU =
  | 'chat.loaded'
  | 'db.loaded'
  | 'plot.before_task_request'
  | 'plot.after_task_response'
  | 'plot.after_stage'
  | 'main_reply.before_generation'
  | 'main_reply.after_response'
  | 'table_fill.before_request'
  | 'table_fill.after_commit'
  | 'plot_worldbook.before_render'
  | 'table_fill_worldbook.before_render'
  | 'manual_table_save.after_commit';

export interface ScriptBinding_ACU {
  hook: ScriptHookName_ACU;
  enabled: boolean;
  target?: {
    presetName?: string;
    stage?: number;
    taskId?: string;
  };
  order?: number;
  config?: unknown;
  outputKey?: string;
  outputTtl?: 'request' | 'chat' | 'session';
  failurePolicy?: 'continue' | 'block';
}

export interface ScriptScope_ACU {
  type: 'global' | 'character';
  characterNames?: string[];
}

export interface UserScriptDefinition_ACU {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  version: number;
  language: 'javascript';
  source: string;
  libraryNames: string[];
  bindings: ScriptBinding_ACU[];
  scope: ScriptScope_ACU;
  order: number;
  timeoutSeconds: number;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastError?: string;
  defaultVariableInput?: unknown;
}

export interface UserScriptLibrary_ACU {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  version: number;
  language: 'javascript';
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScriptVariableCall_ACU {
  raw: string;
  kind: 'execute' | 'read_output';
  scriptId?: string;
  scriptName?: string;
  outputKey?: string;
  outputTtl?: 'request' | 'chat' | 'session';
  input?: unknown;
  format?: 'text' | 'json';
  errorPlaceholder?: string;
}

export interface ScriptRunResult_ACU {
  scriptId: string;
  scriptName: string;
  success: boolean;
  value?: unknown;
  error?: string;
  durationMs: number;
  runId?: string;
}

export interface ScriptLogEntry_ACU {
  id: string;
  scriptId: string;
  scriptName: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  runId?: string;
  callType?: 'hook' | 'variable' | 'manual';
  hook?: ScriptHookName_ACU;
  durationMs?: number;
  error?: string;
}

export type ScriptOutputTtl_ACU = 'request' | 'chat' | 'session';

export interface ScriptStoredOutput_ACU {
  key: string;
  value: unknown;
  scope: {
    chatId?: string;
    characterId?: string;
  };
}

export type ScriptOutputBucket_ACU = Map<string, ScriptStoredOutput_ACU>;

export interface ScriptOutputContext_ACU {
  request: {
    currentCycleId: string;
    byCycleId: Map<string, ScriptOutputBucket_ACU>;
  };
  chat: ScriptOutputBucket_ACU;
  session: ScriptOutputBucket_ACU;
}

export interface ScriptOutputAccessOptions_ACU {
  requestId?: string;
  scope?: {
    chatId?: string;
    characterId?: string;
  };
}
