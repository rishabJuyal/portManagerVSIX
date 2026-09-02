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
      assert.ok(session.getHistory().includes('echo DCC_TEST_OK'));
      done();
    }, 1200);
  });

  it('records command history and navigates with Up/Down arrows', () => {
    const session = manager.createSession({ name: 'History Term' });

    // Simulate typing and executing commands
    session.write('git status\r');
    session.write('npm test\r');

    const history = session.getHistory();
    assert.strictEqual(history[0], 'npm test');
    assert.strictEqual(history[1], 'git status');

    let output = '';
    session.on('data', d => {
      output += d;
    });

    // Press Up Arrow (\x1b[A)
    session.write('\x1b[A');
    assert.ok(output.includes('npm test'));

    // Press Up Arrow again
    session.write('\x1b[A');
    assert.ok(output.includes('git status'));

    // Press Down Arrow (\x1b[B)
    session.write('\x1b[B');
    assert.ok(output.includes('npm test'));
  });

  it('handles line editing with Backspace, Ctrl+U, and Ctrl+C', () => {
    const session = manager.createSession({ name: 'Line Editing Term' });

    let output = '';
    session.on('data', d => {
      output += d;
    });

    // Type "ab", backspace, type "c"
    session.write('a');
    session.write('b');
    session.write('\x7f'); // Backspace
    session.write('c');

    assert.ok(output.includes('\b \b'));

    // Clear line with Ctrl+U (\x15)
    session.write('\x15');
    assert.ok(output.includes('\x1b[K'));

    // Cancel line with Ctrl+C (\x03)
    session.write('\x03');
    assert.ok(output.includes('^C'));
  });

  it('shares command history across newly created terminal sessions', () => {
    const term1 = manager.createSession({ name: 'Term 1' });
    term1.write('docker ps\r');

    const term2 = manager.createSession({ name: 'Term 2' });
    const term2History = term2.getHistory();
    assert.ok(term2History.includes('docker ps'), 'Term 2 should receive shared global command history');
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

  it('kills a session and removes it from manager', () => {
    const session = manager.createSession({ name: 'Kill Test' });
    const id = session.id;
    manager.killSession(id);
    assert.strictEqual(manager.getSession(id), undefined);
  });
});
