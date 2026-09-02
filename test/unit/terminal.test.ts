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

    // Simulate typing and executing commands (typing characters followed by Enter)
    session.write('git status');
    session.write('\r');
    session.write('npm test');
    session.write('\r');

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
    term1.write('docker ps');
    term1.write('\r');

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

  it('refreshes terminal count and renumbers default terminals on deletion', () => {
    const term1 = manager.createSession(); // Terminal 1
    const term2 = manager.createSession(); // Terminal 2
    const term3 = manager.createSession(); // Terminal 3

    assert.strictEqual(term1.name, 'Terminal 1');
    assert.strictEqual(term2.name, 'Terminal 2');
    assert.strictEqual(term3.name, 'Terminal 3');
    assert.strictEqual(manager.getSessions().length, 3);

    // Delete Terminal 2
    manager.closeSession(term2.id);

    // Remaining sessions should be renumbered sequentially and total count is 2
    const remaining = manager.getSessions();
    assert.strictEqual(remaining.length, 2);
    assert.strictEqual(remaining[0].name, 'Terminal 1');
    assert.strictEqual(remaining[1].name, 'Terminal 2');

    // Creating a new terminal gets the next sequential number (Terminal 3)
    const termNew = manager.createSession();
    assert.strictEqual(termNew.name, 'Terminal 3');
    assert.strictEqual(manager.getSessions().length, 3);
  });

  it('preserves custom renamed terminals while renumbering default terminals', () => {
    const term1 = manager.createSession(); // Terminal 1
    const term2 = manager.createSession({ name: 'backend-server' }); // Custom name
    const term3 = manager.createSession(); // Terminal 2 (next available default)

    assert.strictEqual(term1.name, 'Terminal 1');
    assert.strictEqual(term2.name, 'backend-server');
    assert.strictEqual(term3.name, 'Terminal 2');

    // Delete Terminal 1
    manager.closeSession(term1.id);

    const remaining = manager.getSessions();
    assert.strictEqual(remaining.length, 2);
    assert.strictEqual(remaining[0].name, 'backend-server');
    assert.strictEqual(remaining[1].name, 'Terminal 1');
  });

  it('clears session scrollback and preserves clear state', () => {
    const term = manager.createSession({ name: 'clear-test' });
    term.write('echo hello');
    term.write('\r');
    manager.clearSession(term.id);
    const scrollback = term.getScrollback();
    // After clear, scrollback should not contain previous output
    assert.ok(!scrollback.includes('echo hello'));
  });

  it('does not auto-execute command on paste even with trailing newline', () => {
    const term = manager.createSession({ name: 'paste-test' });
    // Paste with trailing newline
    term.write('npm run dev\r\n');
    // Command remains on the prompt waiting for Enter, not executed
    assert.strictEqual(term.getCurrentLine(), 'npm run dev');
  });
});
