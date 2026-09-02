import * as vscode from 'vscode';
import { DevControlCenterViewProvider } from '../webview/DevControlCenterViewProvider';
import { DevControlCenterPanel } from '../webview/DevControlCenterPanel';
import { PortService } from '../ports/PortService';
import { TerminalSessionManager } from '../terminal/TerminalSessionManager';
import { SavedCommandService } from '../savedCommands/SavedCommandService';
import { ConfigService } from '../services/ConfigService';
import { WorkspaceService } from '../workspace/WorkspaceService';
import { StatusBarService } from '../services/StatusBarService';

export function registerCommands(
  context: vscode.ExtensionContext,
  viewProvider: DevControlCenterViewProvider,
  portService: PortService,
  terminalManager: TerminalSessionManager,
  commandService: SavedCommandService,
  configService: ConfigService,
  workspaceService: WorkspaceService,
  statusBarService: StatusBarService
): void {
  // 1. Open / Focus Control Center
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.open', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devControlCenterContainer');
    })
  );

  // 2. Open in Editor Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.openInEditor', () => {
      DevControlCenterPanel.createOrShow(
        context.extensionUri,
        portService,
        terminalManager,
        commandService,
        configService,
        workspaceService,
        statusBarService
      );
    })
  );

  // 3. New Terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.newTerminal', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devControlCenterContainer');
      terminalManager.createSession();
      viewProvider.focusTab('terminal');
    })
  );

  // 4. Focus Terminal Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.focusTerminal', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devControlCenterContainer');
      viewProvider.focusTab('terminal');
    })
  );

  // 5. Show Ports Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.showPorts', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devControlCenterContainer');
      viewProvider.focusTab('ports');
    })
  );

  // 6. Refresh Ports
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.refreshPorts', async () => {
      viewProvider.refreshPorts();
      vscode.window.setStatusBarMessage('$(sync~spin) Scanning local ports...', 1500);
    })
  );

  // 7. Show Saved Commands Tab
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.showCommands', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devControlCenterContainer');
      viewProvider.focusTab('commands');
    })
  );

  // 8. Restart Terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.restartTerminal', async () => {
      const active = terminalManager.getActiveSession();
      if (active) {
        terminalManager.restartSession(active.id);
      }
    })
  );

  // 9. Clear Terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.clearTerminal', async () => {
      viewProvider.clearActiveTerminal();
    })
  );

  // 10. Open Settings
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.devControlCenterContainer');
      viewProvider.focusTab('settings');
    })
  );

  // 11. Kill Terminal
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.killTerminal', async () => {
      const active = terminalManager.getActiveSession();
      if (active) {
        terminalManager.killSession(active.id);
      }
    })
  );

  // 8. Save Command (Quick Input UI)
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.saveCommand', async () => {
      const name = await vscode.window.showInputBox({
        title: 'Save Command',
        prompt: 'Enter a human-readable name for this command',
        placeHolder: 'e.g. Start Backend Server'
      });
      if (!name) return;

      const command = await vscode.window.showInputBox({
        title: 'Save Command',
        prompt: 'Enter the shell command to execute',
        placeHolder: 'e.g. npm run dev'
      });
      if (!command) return;

      const scopeChoice = await vscode.window.showQuickPick(
        [
          { label: 'Workspace', description: 'Available only in this workspace' },
          { label: 'Global', description: 'Available across all VS Code workspaces' }
        ],
        { title: 'Command Scope' }
      );

      const scope = scopeChoice?.label === 'Global' ? 'global' : 'workspace';

      await commandService.addCommand({
        name,
        command,
        scope,
        workingDirectory: workspaceService.getDefaultWorkingDirectory()
      });

      vscode.window.showInformationMessage(`Saved command "${name}" to ${scope} library.`);
    })
  );

  // 9. Run Saved Command (Command Palette QuickPick)
  context.subscriptions.push(
    vscode.commands.registerCommand('devControlCenter.runSavedCommand', async () => {
      const commands = commandService.getAllCommands();
      if (commands.length === 0) {
        const create = await vscode.window.showInformationMessage(
          'No saved commands found. Create one now?',
          'Save Command'
        );
        if (create === 'Save Command') {
          vscode.commands.executeCommand('devControlCenter.saveCommand');
        }
        return;
      }

      const items = commands.map(c => ({
        label: `$(play) ${c.name}`,
        description: c.command,
        detail: `[${c.scope.toUpperCase()}] ${c.description || ''}`,
        commandObj: c
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a saved command to execute'
      });

      if (picked) {
        let session = terminalManager.getActiveSession();
        if (!session || !session.isAlive) {
          session = terminalManager.createSession({
            name: picked.commandObj.name,
            cwd: picked.commandObj.workingDirectory || workspaceService.getDefaultWorkingDirectory()
          });
        }
        await vscode.commands.executeCommand('workbench.view.extension.devControlCenterContainer');
        viewProvider.focusTab('terminal');
        terminalManager.sendText(session.id, picked.commandObj.command, true);
      }
    })
  );
}

export async function showRunInTerminalQuickPick(
  commandService: SavedCommandService,
  workspaceService: WorkspaceService
): Promise<vscode.QuickPick<any>> {
  const qp = vscode.window.createQuickPick<any>();
  qp.placeholder = 'Select a saved command to run in VS Code terminal';

  const commands = commandService.getAllCommands();
  qp.items = commands.map(c => ({
    label: `$(play) ${c.name}`,
    description: c.command,
    detail: `[${c.scope.toUpperCase()}] ${c.description || ''}`,
    commandObj: c
  }));

  qp.onDidAccept(() => {
    const selected = qp.selectedItems[0];
    if (selected && selected.commandObj) {
      let term = vscode.window.activeTerminal;
      if (!term) {
        term = vscode.window.createTerminal({
          name: selected.commandObj.name,
          cwd: selected.commandObj.workingDirectory || workspaceService.getDefaultWorkingDirectory()
        });
      }
      term.show();
      term.sendText(selected.commandObj.command);
    }
    qp.hide();
  });

  qp.show();
  return qp;
}

export async function showPortsQuickPick(
  portService: PortService,
  configService: ConfigService,
  statusBarService: StatusBarService
): Promise<vscode.QuickPick<any>> {
  const qp = vscode.window.createQuickPick<any>();
  qp.placeholder = 'Active Ports';
  qp.busy = true;
  qp.show();

  try {
    const ports = await portService.getListeningPorts();
    qp.items = ports.map(p => ({
      label: `$(plug) Port ${p.port}`,
      description: `${p.processName || 'Unknown'} (PID: ${p.pid})`,
      detail: `Protocol: ${p.protocol.toUpperCase()}`
    }));
  } finally {
    qp.busy = false;
  }

  return qp;
}

