import * as vscode from 'vscode';
import { getWebviewContent } from './htmlHelper';
import { WebviewMessageHandler } from './WebviewMessageHandler';
import { PortService } from '../ports/PortService';
import { TerminalSessionManager } from '../terminal/TerminalSessionManager';
import { SavedCommandService } from '../savedCommands/SavedCommandService';
import { ConfigService } from '../services/ConfigService';
import { WorkspaceService } from '../workspace/WorkspaceService';
import { StatusBarService } from '../services/StatusBarService';

export class DevControlCenterViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'devControlCenter.sidebarView';

  private view?: vscode.WebviewView;
  private messageHandler?: WebviewMessageHandler;

  constructor(
    private extensionUri: vscode.Uri,
    private portService: PortService,
    private terminalManager: TerminalSessionManager,
    private commandService: SavedCommandService,
    private configService: ConfigService,
    private workspaceService: WorkspaceService,
    private statusBarService: StatusBarService
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = getWebviewContent(
      webviewView.webview,
      this.extensionUri
    );

    this.messageHandler = new WebviewMessageHandler(
      this.portService,
      this.terminalManager,
      this.commandService,
      this.configService,
      this.workspaceService,
      this.statusBarService,
      msg => webviewView.webview.postMessage(msg)
    );

    webviewView.webview.onDidReceiveMessage(async message => {
      await this.messageHandler?.handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.messageHandler?.dispose();
      this.view = undefined;
    });
  }

  public focusTab(tab: 'terminal' | 'ports' | 'commands' | 'settings'): void {
    if (this.view) {
      this.view.show(true);
      this.view.webview.postMessage({
        type: 'switchTab',
        tab
      });
    }
  }

  public refreshPorts(): void {
    this.messageHandler?.refreshPorts(true);
  }
}
