import { TerminalSession } from './TerminalSession';
import { TerminalSessionInfo, AvailableShell } from '../types';

export interface CreateTerminalOptions {
  name?: string;
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

export interface ITerminalService {
  createSession(options?: CreateTerminalOptions): TerminalSession;
  getSession(id: string): TerminalSession | undefined;
  getActiveSession(): TerminalSession | undefined;
  getSessions(): TerminalSession[];
  setActiveSession(id: string): void;
  closeSession(id: string): void;
  renameSession(id: string, newName: string): void;
  restartSession(id: string): void;
  killSession(id: string): void;
  sendInput(id: string, data: string): void;
  sendText(id: string, text: string, addNewline?: boolean): void;
  resize(id: string, cols: number, rows: number): void;
  getAvailableShells(): AvailableShell[];
  dispose(): void;
}
