import * as assert from 'assert';
import { SavedCommandService } from '../../src/savedCommands/SavedCommandService';
import * as vscode from 'vscode';

class MockMemento implements vscode.Memento {
  private storage = new Map<string, any>();

  public get<T>(key: string): T | undefined;
  public get<T>(key: string, defaultValue: T): T;
  public get(key: string, defaultValue?: any): any {
    return this.storage.has(key) ? this.storage.get(key) : defaultValue;
  }

  public async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.storage.delete(key);
    } else {
      this.storage.set(key, value);
    }
  }

  public keys(): readonly string[] {
    return Array.from(this.storage.keys());
  }
}

describe('SavedCommandService Unit Tests', () => {
  let mockContext: any;
  let service: SavedCommandService;

  beforeEach(() => {
    mockContext = {
      globalState: new MockMemento(),
      workspaceState: new MockMemento()
    };
    service = new SavedCommandService(mockContext);
  });

  afterEach(() => {
    service.dispose();
  });

  it('initializes with default template commands', () => {
    const all = service.getAllCommands();
    assert.strictEqual(all.length >= 3, true);
  });

  it('adds a workspace-specific command', async () => {
    const cmd = await service.addCommand({
      name: 'Build Project',
      command: 'npm run build',
      description: 'Compiles project',
      scope: 'workspace'
    });

    assert.strictEqual(cmd.name, 'Build Project');
    assert.strictEqual(cmd.command, 'npm run build');
    assert.strictEqual(cmd.scope, 'workspace');

    const workspaceCmds = service.getWorkspaceCommands();
    assert.strictEqual(workspaceCmds.some(c => c.id === cmd.id), true);
  });

  it('adds a global command', async () => {
    const cmd = await service.addCommand({
      name: 'Docker PS',
      command: 'docker ps',
      scope: 'global'
    });

    assert.strictEqual(cmd.scope, 'global');
    const globalCmds = service.getGlobalCommands();
    assert.strictEqual(globalCmds.some(c => c.id === cmd.id), true);
  });

  it('rejects commands with empty name or empty command string', async () => {
    await assert.rejects(async () => {
      await service.addCommand({ name: '', command: 'echo 1' });
    }, /Command name cannot be empty/);

    await assert.rejects(async () => {
      await service.addCommand({ name: 'Test', command: '' });
    }, /Command string cannot be empty/);
  });

  it('updates an existing command', async () => {
    const cmd = await service.addCommand({
      name: 'Old Name',
      command: 'npm start',
      scope: 'workspace'
    });

    const updated = await service.updateCommand(cmd.id, {
      name: 'New Name',
      command: 'npm run dev'
    });

    assert.strictEqual(updated?.name, 'New Name');
    assert.strictEqual(updated?.command, 'npm run dev');
  });

  it('deletes a command', async () => {
    const cmd = await service.addCommand({
      name: 'To Delete',
      command: 'rm -rf tmp',
      scope: 'global'
    });

    const deleted = await service.deleteCommand(cmd.id);
    assert.strictEqual(deleted, true);

    const all = service.getAllCommands();
    assert.strictEqual(all.some(c => c.id === cmd.id), false);
  });

  it('duplicates an existing command', async () => {
    const cmd = await service.addCommand({
      name: 'Original',
      command: 'git status',
      scope: 'workspace'
    });

    const dup = await service.duplicateCommand(cmd.id);
    assert.ok(dup);
    assert.strictEqual(dup.name, 'Original (Copy)');
    assert.strictEqual(dup.command, 'git status');
    assert.notStrictEqual(dup.id, cmd.id);
  });
});
