import * as vscode from 'vscode';
import { ITerminalService, CreateTerminalOptions } from './ITerminalService';
import { TerminalSession } from './TerminalSession';
import { TerminalSessionInfo, AvailableShell } from '../types';
import { ShellDetector } from './ShellDetector';
import { OutputChannelService } from '../services/OutputChannelService';
import { WorkspaceService } from '../workspace/WorkspaceService';

export class TerminalSessionManager implements ITerminalService {
  private sessions = new Map<string, TerminalSession>();
  private activeSessionId: string | null = null;
  private counter = 1;
  private logger = OutputChannelService.getInstance();

  private _onDidChangeSessions = new vscode.EventEmitter<TerminalSessionInfo[]>();
  public readonly onDidChangeSessions = this._onDidChangeSessions.event;

  private _onDidReceiveData = new vscode.EventEmitter<{ id: string; data: string }>();
  public readonly onDidReceiveData = this._onDidReceiveData.event;

  constructor(private workspaceService: WorkspaceService) {}

  public createSession(options?: CreateTerminalOptions): TerminalSession {
    const id = `term-${Date.now()}-${this.counter}`;
    const name = options?.name || `Terminal ${this.counter++}`;
    const cwd = options?.cwd || this.workspaceService.getDefaultWorkingDirectory();
    const shell = options?.shell || ShellDetector.getDefaultShell();

    this.logger.info(`Creating terminal session "${name}" [${id}] with shell "${shell}" in "${cwd}"`);

    const session = new TerminalSession({
      id,
      name,
      cwd,
      shell,
      cols: options?.cols,
      rows: options?.rows
    });

    session.on('data', (data: string) => {
      this._onDidReceiveData.fire({ id, data });
    });

    session.on('exit', () => {
      this.fireSessionChange();
    });

    this.sessions.set(id, session);
    this.setActiveSession(id);

    return session;
  }

  public getSession(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  public getActiveSession(): TerminalSession | undefined {
    if (this.activeSessionId && this.sessions.has(this.activeSessionId)) {
      return this.sessions.get(this.activeSessionId);
    }
    const first = this.sessions.values().next().value;
    return first;
  }

  public getSessions(): TerminalSession[] {
    return Array.from(this.sessions.values());
  }

  public getSessionInfos(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values()).map(s => {
      const info = s.getInfo();
      info.isActive = s.id === this.activeSessionId;
      return info;
    });
  }

  public setActiveSession(id: string): void {
    if (this.sessions.has(id)) {
      this.activeSessionId = id;
      for (const [sId, s] of this.sessions.entries()) {
        s.isActive = sId === id;
      }
      this.fireSessionChange();
    }
  }

  public closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      this.logger.info(`Closing terminal session [${id}]`);
      session.dispose();
      this.sessions.delete(id);

      if (this.activeSessionId === id) {
        const remaining = Array.from(this.sessions.keys());
        this.activeSessionId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
      this.fireSessionChange();
    }
  }

  public renameSession(id: string, newName: string): void {
    const session = this.sessions.get(id);
    if (session && newName.trim()) {
      session.name = newName.trim();
      this.fireSessionChange();
    }
  }

  public restartSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      this.logger.info(`Restarting terminal session [${id}]`);
      session.restart();
      this.fireSessionChange();
    }
  }

  public killSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      this.logger.info(`Killing terminal session [${id}]`);
      session.kill();
      this.fireSessionChange();
    }
  }

  public sendInput(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.write(data);
    }
  }

  public sendText(id: string, text: string, addNewline = true): void {
    const session = this.sessions.get(id);
    if (session) {
      session.write(text + (addNewline ? '\r\n' : ''));
    }
  }

  public resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.resize(cols, rows);
    }
  }

  public getAvailableShells(): AvailableShell[] {
    return ShellDetector.getAvailableShells();
  }

  private fireSessionChange(): void {
    this._onDidChangeSessions.fire(this.getSessionInfos());
  }

  public dispose(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this._onDidChangeSessions.dispose();
    this._onDidReceiveData.dispose();
  }
}
