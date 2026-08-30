import * as vscode from 'vscode';
import { getWebviewContent } from './htmlHelper';
import { WebviewMessageHandler } from './WebviewMessageHandler';
import { PortService } from '../ports/PortService';
import { TerminalSessionManager } from '../terminal/TerminalSessionManager';
import { SavedCommandService } from '../savedCommands/SavedCommandService';
import { ConfigService } from '../services/ConfigService';
import { WorkspaceService } from '../workspace/WorkspaceService';
import { StatusBarService } from '../services/StatusBarService';

export class DevControlCenterPanel {
  public static currentPanel: DevControlCenterPanel | undefined;
  public static readonly viewType = 'devControlCenter.panel';

  private readonly panel: vscode.WebviewPanel;
  private messageHandler: WebviewMessageHandler;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    portService: PortService,
    terminalManager: TerminalSessionManager,
    commandService: SavedCommandService,
    configService: ConfigService,
    workspaceService: WorkspaceService,
    statusBarService: StatusBarService,
    initialTab?: 'terminal' | 'ports' | 'commands' | 'settings'
  ): DevControlCenterPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DevControlCenterPanel.currentPanel) {
      DevControlCenterPanel.currentPanel.panel.reveal(column);
      if (initialTab) {
        DevControlCenterPanel.currentPanel.focusTab(initialTab);
      }
      return DevControlCenterPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      DevControlCenterPanel.viewType,
      'Dev Control Center',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icons', 'control-center.svg');

    DevControlCenterPanel.currentPanel = new DevControlCenterPanel(
      panel,
      extensionUri,
      portService,
      terminalManager,
      commandService,
      configService,
      workspaceService,
      statusBarService
    );

    if (initialTab) {
      DevControlCenterPanel.currentPanel.focusTab(initialTab);
    }

    return DevControlCenterPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private extensionUri: vscode.Uri,
    portService: PortService,
    terminalManager: TerminalSessionManager,
    commandService: SavedCommandService,
    configService: ConfigService,
    workspaceService: WorkspaceService,
    statusBarService: StatusBarService
  ) {
    this.panel = panel;
    this.panel.webview.html = getWebviewContent(this.panel.webview, this.extensionUri);

    this.messageHandler = new WebviewMessageHandler(
      portService,
      terminalManager,
      commandService,
      configService,
      workspaceService,
      statusBarService,
      msg => this.panel.webview.postMessage(msg)
    );

    this.panel.webview.onDidReceiveMessage(
      async message => {
        await this.messageHandler.handleMessage(message);
      },
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public focusTab(tab: 'terminal' | 'ports' | 'commands' | 'settings'): void {
    this.panel.webview.postMessage({
      type: 'switchTab',
      tab
    });
  }

  public dispose(): void {
    DevControlCenterPanel.currentPanel = undefined;
    this.messageHandler.dispose();
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}
