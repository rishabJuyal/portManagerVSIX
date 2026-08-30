import * as assert from 'assert';
import { TerminalSessionManager } from '../../src/terminal/TerminalSessionManager';
import { WorkspaceService } from '../../src/workspace/WorkspaceService';
import { ShellDetector } from '../../src/terminal/ShellDetector';

class MockWorkspaceService extends WorkspaceService {
  constructor() {
    super({ subscriptions: [] } as any);
  }

  public override getDefaultWorkingDirectory(): string {
    return process.cwd();
  }

  public override getWorkspaceName(): string {
    return 'Test Workspace';
  }
}

describe('Terminal Subsystem Unit Tests', () => {
  let manager: TerminalSessionManager;
  let workspaceService: WorkspaceService;

  beforeEach(() => {
    workspaceService = new MockWorkspaceService();
    manager = new TerminalSessionManager(workspaceService);
  });

  afterEach(() => {
    manager.dispose();
  });

  it('detects available shells and identifies default shell', () => {
    const shells = ShellDetector.getAvailableShells();
    assert.ok(shells.length > 0);
    const defaultShell = ShellDetector.getDefaultShell();
    assert.ok(typeof defaultShell === 'string');
    assert.ok(defaultShell.length > 0);
  });

  it('creates terminal session, receives initial prompt, and sends input', done => {
    const session = manager.createSession({
      name: 'Test Term'
    });

    assert.strictEqual(session.name, 'Test Term');
    assert.strictEqual(session.isAlive, true);

    let receivedData = false;
    const disposable = manager.onDidReceiveData(evt => {
      if (evt.id === session.id) {
        receivedData = true;
      }
    });

    // Write a simple echo command
    manager.sendText(session.id, 'echo DCC_TEST_OK', true);

    setTimeout(() => {
      disposable.dispose();
      assert.strictEqual(receivedData, true);
      done();
    }, 1200);
  });

  it('renames a session', () => {
    const session = manager.createSession({ name: 'Old' });
    manager.renameSession(session.id, 'New Title');
    assert.strictEqual(session.name, 'New Title');
  });

  it('restarts a session', () => {
    const session = manager.createSession({ name: 'Restart Test' });
    assert.strictEqual(session.isAlive, true);
    manager.restartSession(session.id);
    assert.strictEqual(session.isAlive, true);
  });

  it('closes a session', () => {
    const session = manager.createSession({ name: 'Close Test' });
    const id = session.id;
    manager.closeSession(id);
    assert.strictEqual(manager.getSession(id), undefined);
  });
});
