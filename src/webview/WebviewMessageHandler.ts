import * as vscode from 'vscode';
import {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  InitialStatePayload
} from './messages';
import { PortService } from '../ports/PortService';
import { TerminalSessionManager } from '../terminal/TerminalSessionManager';
import { SavedCommandService } from '../savedCommands/SavedCommandService';
import { ConfigService } from '../services/ConfigService';
import { WorkspaceService } from '../workspace/WorkspaceService';
import { StatusBarService } from '../services/StatusBarService';
import { OutputChannelService } from '../services/OutputChannelService';

export class WebviewMessageHandler {
  private logger = OutputChannelService.getInstance();
  private autoRefreshTimer: NodeJS.Timeout | null = null;
  private isAutoRefreshActive = false;
  private currentTab: 'terminal' | 'ports' | 'commands' | 'settings' = 'terminal';
  private disposables: vscode.Disposable[] = [];

  constructor(
    private portService: PortService,
    private terminalManager: TerminalSessionManager,
    private commandService: SavedCommandService,
    private configService: ConfigService,
    private workspaceService: WorkspaceService,
    private statusBarService: StatusBarService,
    private postMessage: (msg: ExtensionToWebviewMessage) => Thenable<boolean>
  ) {
    this.setupListeners();
    this.initAutoRefresh();
  }

  private setupListeners(): void {
    // Forward terminal data to webview
    this.disposables.push(
      this.terminalManager.onDidReceiveData(event => {
        this.postMessage({
          type: 'terminal:data',
          id: event.id,
          data: event.data
        });
      })
    );

    // Forward terminal session changes
    this.disposables.push(
      this.terminalManager.onDidChangeSessions(sessions => {
        const active = this.terminalManager.getActiveSession();
        this.postMessage({
          type: 'terminal:sessions',
          sessions,
          activeSessionId: active ? active.id : null
        });
      })
    );

    // Forward saved command changes
    this.disposables.push(
      this.commandService.onDidChangeCommands(commands => {
        this.postMessage({
          type: 'commands:list',
          commands
        });
      })
    );

    // Forward config changes
    this.disposables.push(
      this.configService.onDidChangeConfig(settings => {
        this.postMessage({
          type: 'settings:updated',
          settings
        });
        this.initAutoRefresh();
      })
    );

    // Forward workspace changes
    this.disposables.push(
      this.workspaceService.onDidChangeWorkspace(folders => {
        this.postMessage({
          type: 'workspace:updated',
          folders,
          currentWorkspace: this.workspaceService.getWorkspaceName()
        });
      })
    );
  }

  public initAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }

    const settings = this.configService.getSettings();
    if (settings.autoRefreshPorts) {
      this.isAutoRefreshActive = true;
      const interval = Math.max(1000, settings.portRefreshInterval || 3000);
      this.autoRefreshTimer = setInterval(async () => {
        await this.refreshPorts(false);
      }, interval);
    } else {
      this.isAutoRefreshActive = false;
    }
  }

  public async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'init': {
          await this.handleInit();
          break;
        }

        case 'switchTab': {
          this.currentTab = message.tab;
          if (message.tab === 'ports') {
            await this.refreshPorts(true);
          }
          break;
        }

        case 'terminal:create': {
          const session = this.terminalManager.createSession(message.options);
          break;
        }

        case 'terminal:select': {
          this.terminalManager.setActiveSession(message.id);
          const session = this.terminalManager.getSession(message.id);
          if (session) {
            this.postMessage({
              type: 'terminal:scrollback',
              id: session.id,
              data: session.getScrollback()
            });
          }
          break;
        }

        case 'terminal:close': {
          this.terminalManager.closeSession(message.id);
          break;
        }

        case 'terminal:rename': {
          this.terminalManager.renameSession(message.id, message.name);
          break;
        }

        case 'terminal:restart': {
          this.terminalManager.restartSession(message.id);
          break;
        }

        case 'terminal:kill': {
          this.terminalManager.killSession(message.id);
          break;
        }

        case 'terminal:input': {
          this.terminalManager.sendInput(message.id, message.data);
          break;
        }

        case 'terminal:resize': {
          this.terminalManager.resize(message.id, message.cols, message.rows);
          break;
        }

        case 'terminal:requestScrollback': {
          const session = this.terminalManager.getSession(message.id);
          if (session) {
            this.postMessage({
              type: 'terminal:scrollback',
              id: session.id,
              data: session.getScrollback()
            });
          }
          break;
        }

        case 'ports:refresh': {
          await this.refreshPorts(true);
          break;
        }

        case 'ports:toggleAutoRefresh': {
          await this.configService.updateSetting('autoRefreshPorts', message.enabled);
          this.initAutoRefresh();
          break;
        }

        case 'ports:openBrowser': {
          const uri = vscode.Uri.parse(`http://localhost:${message.port}`);
          await vscode.env.openExternal(uri);
          break;
        }

        case 'ports:copyUrl': {
          const url = `http://localhost:${message.port}`;
          await vscode.env.clipboard.writeText(url);
          this.postMessage({
            type: 'notification',
            level: 'info',
            message: `Copied ${url} to clipboard`
          });
          break;
        }

        case 'ports:killProcess': {
          await this.handleKillProcess(message.pid, message.port, message.processName);
          break;
        }

        case 'ports:inspectProcess': {
          const processInfo = await this.portService.getProcessForPort(message.port);
          this.postMessage({
            type: 'ports:inspectResult',
            port: message.port,
            process: processInfo
          });
          break;
        }

        case 'commands:add': {
          await this.commandService.addCommand(message.dto);
          this.postMessage({
            type: 'notification',
            level: 'info',
            message: `Saved command "${message.dto.name}"`
          });
          break;
        }

        case 'commands:update': {
          await this.commandService.updateCommand(message.id, message.dto);
          this.postMessage({
            type: 'notification',
            level: 'info',
            message: `Updated command`
          });
          break;
        }

        case 'commands:delete': {
          await this.commandService.deleteCommand(message.id);
          this.postMessage({
            type: 'notification',
            level: 'info',
            message: `Command removed`
          });
          break;
        }

        case 'commands:duplicate': {
          await this.commandService.duplicateCommand(message.id);
          break;
        }

        case 'commands:run': {
          await this.handleRunCommand(message.id, message.inNewTerminal);
          break;
        }

        case 'settings:update': {
          await this.configService.updateSetting(message.key, message.value);
          break;
        }

        case 'workspace:pickFolder': {
          const picked = await this.workspaceService.pickWorkspaceFolder();
          if (picked) {
            this.terminalManager.createSession({
              name: `Terminal (${this.workspaceService.getWorkspaceName()})`,
              cwd: picked
            });
          }
          break;
        }
      }
    } catch (err: any) {
      this.logger.error(`Error handling message ${message.type}`, err);
      this.postMessage({
        type: 'notification',
        level: 'error',
        message: err?.message || 'Operation failed'
      });
    }
  }

  private async handleInit(): Promise<void> {
    // Ensure at least one terminal session exists on start
    let sessions = this.terminalManager.getSessionInfos();
    if (sessions.length === 0) {
      this.terminalManager.createSession();
      sessions = this.terminalManager.getSessionInfos();
    }

    const activeSession = this.terminalManager.getActiveSession();
    const ports = await this.portService.getListeningPorts(false);
    this.statusBarService.updatePortCount(ports.length);

    const payload: InitialStatePayload = {
      activeTab: this.currentTab,
      sessions,
      activeSessionId: activeSession ? activeSession.id : null,
      ports,
      commands: this.commandService.getAllCommands(),
      settings: this.configService.getSettings(),
      workspaceFolders: this.workspaceService.getWorkspaceFolders(),
      currentWorkspace: this.workspaceService.getWorkspaceName(),
      availableShells: this.terminalManager.getAvailableShells()
    };

    await this.postMessage({
      type: 'state:init',
      payload
    });

    if (activeSession) {
      await this.postMessage({
        type: 'terminal:scrollback',
        id: activeSession.id,
        data: activeSession.getScrollback()
      });
    }
  }

  public async refreshPorts(force = false): Promise<void> {
    try {
      const ports = await this.portService.getListeningPorts(force);
      this.statusBarService.updatePortCount(ports.length);
      await this.postMessage({
        type: 'ports:list',
        ports
      });
    } catch (err: any) {
      this.logger.error('Error in refreshPorts', err);
      await this.postMessage({
        type: 'ports:error',
        message: err?.message || 'Failed to detect ports'
      });
    }
  }

  private async handleKillProcess(pid: number, port: number, processName: string): Promise<void> {
    const settings = this.configService.getSettings();

    if (settings.confirmBeforeKill) {
      const answer = await vscode.window.showWarningMessage(
        `Kill process "${processName}" (PID: ${pid}) using port ${port}?`,
        { modal: true },
        'Kill Process'
      );

      if (answer !== 'Kill Process') {
        return;
      }
    }

    try {
      await this.portService.killProcess(pid);
      vscode.window.showInformationMessage(`Terminated process ${processName} (PID ${pid})`);
      await this.refreshPorts(true);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to kill process: ${err?.message || 'Access Denied'}`);
    }
  }

  private async handleRunCommand(id: string, inNewTerminal?: boolean): Promise<void> {
    const all = this.commandService.getAllCommands();
    const cmd = all.find(c => c.id === id);
    if (!cmd) {
      throw new Error(`Command ${id} not found`);
    }

    const settings = this.configService.getSettings();
    const shouldRunInNew = inNewTerminal !== undefined
      ? inNewTerminal
      : settings.defaultRunLocation === 'newTerminal';

    let targetSession = this.terminalManager.getActiveSession();

    if (shouldRunInNew || !targetSession || !targetSession.isAlive) {
      targetSession = this.terminalManager.createSession({
        name: cmd.name,
        cwd: cmd.workingDirectory || this.workspaceService.getDefaultWorkingDirectory(),
        shell: cmd.shell
      });
    }

    this.terminalManager.setActiveSession(targetSession.id);
    this.postMessage({
      type: 'switchTab',
      tab: 'terminal'
    });

    // Send command text + Enter
    setTimeout(() => {
      if (targetSession) {
        this.terminalManager.sendText(targetSession.id, cmd.command, true);
      }
    }, 150);
  }

  public dispose(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
