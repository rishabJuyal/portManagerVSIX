import * as assert from 'assert';
import { WebviewMessageHandler } from '../../src/webview/WebviewMessageHandler';
import { PortService } from '../../src/ports/PortService';
import { TerminalSessionManager } from '../../src/terminal/TerminalSessionManager';
import { SavedCommandService } from '../../src/savedCommands/SavedCommandService';
import { ConfigService } from '../../src/services/ConfigService';
import { WorkspaceService } from '../../src/workspace/WorkspaceService';
import { StatusBarService } from '../../src/services/StatusBarService';
import { ExtensionToWebviewMessage } from '../../src/webview/messages';

class MockMemento {
  private storage = new Map<string, any>();
  public get(key: string, def?: any) { return this.storage.has(key) ? this.storage.get(key) : def; }
  public async update(key: string, val: any) { if (val === undefined) this.storage.delete(key); else this.storage.set(key, val); }
  public keys() { return Array.from(this.storage.keys()); }
}

describe('WebviewMessageHandler Unit Tests', () => {
  let handler: WebviewMessageHandler;
  let postedMessages: ExtensionToWebviewMessage[] = [];
  let portService: PortService;
  let terminalManager: TerminalSessionManager;
  let commandService: SavedCommandService;
  let configService: ConfigService;
  let workspaceService: WorkspaceService;
  let statusBarService: StatusBarService;

  beforeEach(() => {
    postedMessages = [];
    const mockContext: any = {
      subscriptions: [],
      globalState: new MockMemento(),
      workspaceState: new MockMemento()
    };

    portService = new PortService();
    workspaceService = new WorkspaceService(mockContext);
    terminalManager = new TerminalSessionManager(workspaceService);
    commandService = new SavedCommandService(mockContext);
    configService = new ConfigService(mockContext);
    statusBarService = new StatusBarService(mockContext, configService);

    handler = new WebviewMessageHandler(
      portService,
      terminalManager,
      commandService,
      configService,
      workspaceService,
      statusBarService,
      async msg => {
        postedMessages.push(msg);
        return true;
      }
    );
  });

  afterEach(() => {
    handler.dispose();
    portService.dispose();
    terminalManager.dispose();
    commandService.dispose();
    configService.dispose();
    workspaceService.dispose();
    statusBarService.dispose();
  });

  it('handles "init" message and replies with full state:init payload', async () => {
    await handler.handleMessage({ type: 'init' });

    const initMsg = postedMessages.find(m => m.type === 'state:init') as any;
    assert.ok(initMsg);
    assert.ok(initMsg.payload);
    assert.ok(Array.isArray(initMsg.payload.sessions));
    assert.ok(Array.isArray(initMsg.payload.commands));
    assert.ok(Array.isArray(initMsg.payload.ports));
    assert.ok(initMsg.payload.settings);
  });

  it('handles "commands:add" and posts notification and list update', async () => {
    await handler.handleMessage({
      type: 'commands:add',
      dto: {
        name: 'Run Tests',
        command: 'npm test',
        scope: 'workspace'
      }
    });

    const notif = postedMessages.find(m => m.type === 'notification') as any;
    assert.ok(notif);
    assert.strictEqual(notif.level, 'info');

    const cmds = commandService.getAllCommands();
    assert.strictEqual(cmds.some(c => c.name === 'Run Tests'), true);
  });

  it('handles "switchTab" to ports and triggers port list broadcast', async () => {
    await handler.handleMessage({
      type: 'switchTab',
      tab: 'ports'
    });

    const portsMsg = postedMessages.find(m => m.type === 'ports:list');
    assert.ok(portsMsg);
  });
});
