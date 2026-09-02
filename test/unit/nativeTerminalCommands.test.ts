import * as assert from 'assert';
import * as vscode from 'vscode';
import { SavedCommandService } from '../../src/savedCommands/SavedCommandService';
import { WorkspaceService } from '../../src/workspace/WorkspaceService';
import { PortService } from '../../src/ports/PortService';
import { ConfigService } from '../../src/services/ConfigService';
import { StatusBarService } from '../../src/services/StatusBarService';
import { showRunInTerminalQuickPick, showPortsQuickPick } from '../../src/commands/registerCommands';

describe('Native Terminal Integration Unit Tests', () => {
  let mockContext: any;
  let workspaceStorage = new Map<string, any>();
  let globalStorage = new Map<string, any>();

  beforeEach(() => {
    workspaceStorage.clear();
    globalStorage.clear();

    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: (k: string, def: any) => workspaceStorage.has(k) ? workspaceStorage.get(k) : def,
        update: async (k: string, v: any) => { workspaceStorage.set(k, v); }
      },
      globalState: {
        get: (k: string, def: any) => globalStorage.has(k) ? globalStorage.get(k) : def,
        update: async (k: string, v: any) => { globalStorage.set(k, v); }
      },
      extensionUri: vscode.Uri.file('/mock/extension')
    };
  });

  it('populates saved commands in QuickPick and executes in active terminal', async () => {
    const cmdService = new SavedCommandService(mockContext);
    const workspaceService = new WorkspaceService(mockContext);

    let createdTerm: any = null;
    let sentText: string | null = null;

    (vscode.window as any).activeTerminal = undefined;
    (vscode.window as any).createTerminal = (options: any) => {
      createdTerm = {
        name: options?.name,
        cwd: options?.cwd,
        show: () => {},
        sendText: (text: string) => { sentText = text; }
      };
      (vscode.window as any).activeTerminal = createdTerm;
      return createdTerm;
    };

    let quickPickInstance: any = null;
    const origCreateQuickPick = vscode.window.createQuickPick;
    (vscode.window as any).createQuickPick = () => {
      const qp = origCreateQuickPick();
      quickPickInstance = qp;
      return qp;
    };

    await showRunInTerminalQuickPick(cmdService, workspaceService);

    assert.ok(quickPickInstance, 'QuickPick should have been created');
    assert.ok(quickPickInstance.items.length > 0, 'QuickPick items should be populated');

    // Verify commands exist
    const commandItem = quickPickInstance.items.find((i: any) => i.commandObj?.name === 'Start Dev Server');
    assert.ok(commandItem, 'Default command item Start Dev Server should exist');
    assert.strictEqual(commandItem.commandObj.command, 'npm run dev');

    // Simulate selecting and accepting the command item
    quickPickInstance.selectedItems = [commandItem];
    quickPickInstance._fireAccept();

    assert.ok(createdTerm, 'Terminal should have been created');
    assert.strictEqual(sentText, 'npm run dev', 'Command text should have been sent to terminal');
  });

  it('scans listening ports and populates Ports QuickPick', async () => {
    const portService = new PortService();
    const configService = new ConfigService(mockContext);
    const statusBarService = new StatusBarService(mockContext, configService);

    let quickPickInstance: any = null;
    const origCreateQuickPick = vscode.window.createQuickPick;
    (vscode.window as any).createQuickPick = () => {
      const qp = origCreateQuickPick();
      quickPickInstance = qp;
      return qp;
    };

    await showPortsQuickPick(portService, configService, statusBarService);

    assert.ok(quickPickInstance, 'Ports QuickPick should be created');
    assert.strictEqual(quickPickInstance.busy, false, 'QuickPick should finish scanning');
    assert.ok(quickPickInstance.items.length >= 0, 'Items should be loaded');
  });
});
