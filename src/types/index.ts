export interface PortInfo {
  port: number;
  pid: number;
  processName: string;
  protocol: 'TCP' | 'UDP';
  address: string;
  runtime?: string;
  framework?: string;
  command?: string;
  cpu?: string;
  memory?: string;
  started?: string;
  status: 'listening' | 'established' | 'closed';
}

export interface ProcessInfo {
  pid: number;
  name: string;
  command?: string;
  cpu?: string;
  memory?: string;
  started?: string;
  port?: number;
}

export type CommandScope = 'workspace' | 'global';

export interface SavedCommand {
  id: string;
  name: string;
  command: string;
  description?: string;
  workingDirectory?: string;
  shell?: string;
  scope: CommandScope;
  createdAt: number;
  updatedAt: number;
}

export interface TerminalSessionInfo {
  id: string;
  name: string;
  cwd: string;
  shell: string;
  createdAt: number;
  isActive: boolean;
  isAlive: boolean;
}

export interface AvailableShell {
  name: string;
  path: string;
  isDefault: boolean;
}

export interface ExtensionSettings {
  confirmBeforeKill: boolean;
  autoRefreshPorts: boolean;
  portRefreshInterval: number;
  showStatusBarItem: boolean;
  terminalFontSize: number;
  terminalFontFamily: string;
  defaultShell: string;
  defaultRunLocation: 'activeTerminal' | 'newTerminal';
}

export interface WorkspaceFolderInfo {
  name: string;
  path: string;
}
