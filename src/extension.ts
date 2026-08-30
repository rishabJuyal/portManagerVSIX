import * as vscode from 'vscode';
import { OutputChannelService } from './services/OutputChannelService';
import { ConfigService } from './services/ConfigService';
import { WorkspaceService } from './workspace/WorkspaceService';
import { StatusBarService } from './services/StatusBarService';
import { PortService } from './ports/PortService';
import { TerminalSessionManager } from './terminal/TerminalSessionManager';
import { SavedCommandService } from './savedCommands/SavedCommandService';
import { DevControlCenterViewProvider } from './webview/DevControlCenterViewProvider';
import { registerCommands } from './commands/registerCommands';

let portService: PortService | undefined;
let terminalManager: TerminalSessionManager | undefined;
let viewProvider: DevControlCenterViewProvider | undefined;
let outputChannel: OutputChannelService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = OutputChannelService.getInstance();
  outputChannel.info('Activating Dev Control Center extension...');

  try {
    const configService = new ConfigService(context);
    const workspaceService = new WorkspaceService(context);
    const statusBarService = new StatusBarService(context, configService);
    
    portService = new PortService();
    terminalManager = new TerminalSessionManager(workspaceService);
    const commandService = new SavedCommandService(context);

    viewProvider = new DevControlCenterViewProvider(
      context.extensionUri,
      portService,
      terminalManager,
      commandService,
      configService,
      workspaceService,
      statusBarService
    );

    // Register Webview View Provider
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        DevControlCenterViewProvider.viewType,
        viewProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true
          }
        }
      )
    );

    // Register all Extension Commands & Keyboard Shortcuts
    registerCommands(
      context,
      viewProvider,
      portService,
      terminalManager,
      commandService,
      configService,
      workspaceService,
      statusBarService
    );

    context.subscriptions.push({
      dispose: () => {
        portService?.dispose();
        terminalManager?.dispose();
        commandService.dispose();
        configService.dispose();
        workspaceService.dispose();
        statusBarService.dispose();
        outputChannel?.dispose();
      }
    });

    outputChannel.info('Dev Control Center extension activated successfully.');
  } catch (err) {
    outputChannel.error('Failed to activate Dev Control Center', err);
    vscode.window.showErrorMessage('Dev Control Center failed to activate. See Output Channel for details.');
  }
}

export function deactivate(): void {
  outputChannel?.info('Deactivating Dev Control Center...');
  portService?.dispose();
  terminalManager?.dispose();
}
