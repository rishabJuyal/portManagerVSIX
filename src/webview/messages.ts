import {
  PortInfo,
  SavedCommand,
  TerminalSessionInfo,
  AvailableShell,
  ExtensionSettings,
  WorkspaceFolderInfo,
  ProcessInfo
} from '../types';
import { CreateCommandDto, UpdateCommandDto } from '../savedCommands/types';

export interface InitialStatePayload {
  activeTab: 'terminal' | 'ports' | 'commands' | 'settings';
  sessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  ports: PortInfo[];
  commands: SavedCommand[];
  settings: ExtensionSettings;
  workspaceFolders: WorkspaceFolderInfo[];
  currentWorkspace: string;
  availableShells: AvailableShell[];
}

export type WebviewToExtensionMessage =
  | { type: 'init' }
  | { type: 'switchTab'; tab: 'terminal' | 'ports' | 'commands' | 'settings' }
  | { type: 'terminal:create'; options?: { name?: string; cwd?: string; shell?: string } }
  | { type: 'terminal:select'; id: string }
  | { type: 'terminal:close'; id: string }
  | { type: 'terminal:rename'; id: string; name: string }
  | { type: 'terminal:restart'; id: string }
  | { type: 'terminal:kill'; id: string }
  | { type: 'terminal:input'; id: string; data: string }
  | { type: 'terminal:resize'; id: string; cols: number; rows: number }
  | { type: 'terminal:requestScrollback'; id: string }
  | { type: 'ports:refresh' }
  | { type: 'ports:toggleAutoRefresh'; enabled: boolean }
  | { type: 'ports:openBrowser'; port: number }
  | { type: 'ports:copyUrl'; port: number }
  | { type: 'ports:killProcess'; pid: number; port: number; processName: string }
  | { type: 'ports:inspectProcess'; port: number; pid: number }
  | { type: 'commands:add'; dto: CreateCommandDto }
  | { type: 'commands:update'; id: string; dto: UpdateCommandDto }
  | { type: 'commands:delete'; id: string }
  | { type: 'commands:duplicate'; id: string }
  | { type: 'commands:run'; id: string; inNewTerminal?: boolean }
  | { type: 'settings:update'; key: keyof ExtensionSettings; value: any }
  | { type: 'workspace:pickFolder' };

export type ExtensionToWebviewMessage =
  | { type: 'state:init'; payload: InitialStatePayload }
  | { type: 'terminal:sessions'; sessions: TerminalSessionInfo[]; activeSessionId: string | null }
  | { type: 'terminal:data'; id: string; data: string }
  | { type: 'terminal:scrollback'; id: string; data: string }
  | { type: 'ports:list'; ports: PortInfo[] }
  | { type: 'ports:inspectResult'; port: number; process: ProcessInfo | null }
  | { type: 'ports:error'; message: string }
  | { type: 'commands:list'; commands: SavedCommand[] }
  | { type: 'settings:updated'; settings: ExtensionSettings }
  | { type: 'workspace:updated'; folders: WorkspaceFolderInfo[]; currentWorkspace: string }
  | { type: 'notification'; level: 'info' | 'warning' | 'error'; message: string }
  | { type: 'switchTab'; tab: 'terminal' | 'ports' | 'commands' | 'settings' }
  | { type: 'terminal:clear' };
