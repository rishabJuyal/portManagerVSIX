import * as vscode from 'vscode';
import { SavedCommand } from '../types';
import { CreateCommandDto, UpdateCommandDto } from './types';
import { OutputChannelService } from '../services/OutputChannelService';

export class SavedCommandService {
  private static readonly GLOBAL_STORAGE_KEY = 'devControlCenter.savedCommands.global';
  private static readonly WORKSPACE_STORAGE_KEY = 'devControlCenter.savedCommands.workspace';

  private _onDidChangeCommands = new vscode.EventEmitter<SavedCommand[]>();
  public readonly onDidChangeCommands = this._onDidChangeCommands.event;

  private logger = OutputChannelService.getInstance();

  constructor(private context: vscode.ExtensionContext) {
    this.ensureDefaultCommands();
  }

  private ensureDefaultCommands(): void {
    const globalCmds = this.getGlobalCommands();
    const workspaceCmds = this.getWorkspaceCommands();

    if (globalCmds.length === 0 && workspaceCmds.length === 0) {
      const defaults: SavedCommand[] = [
        {
          id: 'cmd-default-1',
          name: 'Start Dev Server',
          command: 'npm run dev',
          description: 'Runs npm run dev in current workspace',
          scope: 'workspace',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'cmd-default-2',
          name: 'Git Status',
          command: 'git status',
          description: 'Check git repository status',
          scope: 'global',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'cmd-default-3',
          name: 'Git Pull & Rebase',
          command: 'git pull --rebase',
          description: 'Fetch and rebase remote branch',
          scope: 'global',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];

      this.context.workspaceState.update(SavedCommandService.WORKSPACE_STORAGE_KEY, [defaults[0]]);
      this.context.globalState.update(SavedCommandService.GLOBAL_STORAGE_KEY, [defaults[1], defaults[2]]);
    }
  }

  public getGlobalCommands(): SavedCommand[] {
    return this.context.globalState.get<SavedCommand[]>(SavedCommandService.GLOBAL_STORAGE_KEY, []);
  }

  public getWorkspaceCommands(): SavedCommand[] {
    return this.context.workspaceState.get<SavedCommand[]>(SavedCommandService.WORKSPACE_STORAGE_KEY, []);
  }

  public getAllCommands(): SavedCommand[] {
    const globalCmds = this.getGlobalCommands();
    const workspaceCmds = this.getWorkspaceCommands();
    return [...workspaceCmds, ...globalCmds].sort((a, b) => b.createdAt - a.createdAt);
  }

  public async addCommand(dto: CreateCommandDto): Promise<SavedCommand> {
    if (!dto.name || !dto.name.trim()) {
      throw new Error('Command name cannot be empty');
    }
    if (!dto.command || !dto.command.trim()) {
      throw new Error('Command string cannot be empty');
    }

    const scope = dto.scope || 'workspace';
    const newCommand: SavedCommand = {
      id: `cmd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: dto.name.trim(),
      command: dto.command.trim(),
      description: dto.description?.trim(),
      workingDirectory: dto.workingDirectory?.trim(),
      shell: dto.shell?.trim(),
      scope,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    if (scope === 'global') {
      const list = this.getGlobalCommands();
      list.push(newCommand);
      await this.context.globalState.update(SavedCommandService.GLOBAL_STORAGE_KEY, list);
    } else {
      const list = this.getWorkspaceCommands();
      list.push(newCommand);
      await this.context.workspaceState.update(SavedCommandService.WORKSPACE_STORAGE_KEY, list);
    }

    this.logger.info(`Saved command added: "${newCommand.name}" [scope: ${scope}]`);
    this.fireChange();
    return newCommand;
  }

  public async updateCommand(id: string, dto: UpdateCommandDto): Promise<SavedCommand | null> {
    let globalList = this.getGlobalCommands();
    let workspaceList = this.getWorkspaceCommands();

    const gIndex = globalList.findIndex(c => c.id === id);
    const wIndex = workspaceList.findIndex(c => c.id === id);

    if (gIndex === -1 && wIndex === -1) {
      throw new Error(`Command with id ${id} not found`);
    }

    let existing = gIndex !== -1 ? globalList[gIndex] : workspaceList[wIndex];
    const targetScope = dto.scope || existing.scope;

    const updated: SavedCommand = {
      ...existing,
      name: dto.name !== undefined ? dto.name.trim() : existing.name,
      command: dto.command !== undefined ? dto.command.trim() : existing.command,
      description: dto.description !== undefined ? dto.description.trim() : existing.description,
      workingDirectory: dto.workingDirectory !== undefined ? dto.workingDirectory.trim() : existing.workingDirectory,
      shell: dto.shell !== undefined ? dto.shell.trim() : existing.shell,
      scope: targetScope,
      updatedAt: Date.now()
    };

    if (targetScope === existing.scope) {
      if (targetScope === 'global') {
        globalList[gIndex] = updated;
        await this.context.globalState.update(SavedCommandService.GLOBAL_STORAGE_KEY, globalList);
      } else {
        workspaceList[wIndex] = updated;
        await this.context.workspaceState.update(SavedCommandService.WORKSPACE_STORAGE_KEY, workspaceList);
      }
    } else {
      // Scope changed: remove from old list and add to new list
      if (existing.scope === 'global') {
        globalList = globalList.filter(c => c.id !== id);
        workspaceList.push(updated);
      } else {
        workspaceList = workspaceList.filter(c => c.id !== id);
        globalList.push(updated);
      }
      await this.context.globalState.update(SavedCommandService.GLOBAL_STORAGE_KEY, globalList);
      await this.context.workspaceState.update(SavedCommandService.WORKSPACE_STORAGE_KEY, workspaceList);
    }

    this.logger.info(`Saved command updated: "${updated.name}"`);
    this.fireChange();
    return updated;
  }

  public async deleteCommand(id: string): Promise<boolean> {
    const globalList = this.getGlobalCommands();
    const workspaceList = this.getWorkspaceCommands();

    const newGlobal = globalList.filter(c => c.id !== id);
    const newWorkspace = workspaceList.filter(c => c.id !== id);

    if (newGlobal.length !== globalList.length) {
      await this.context.globalState.update(SavedCommandService.GLOBAL_STORAGE_KEY, newGlobal);
      this.fireChange();
      return true;
    }

    if (newWorkspace.length !== workspaceList.length) {
      await this.context.workspaceState.update(SavedCommandService.WORKSPACE_STORAGE_KEY, newWorkspace);
      this.fireChange();
      return true;
    }

    return false;
  }

  public async duplicateCommand(id: string): Promise<SavedCommand | null> {
    const all = this.getAllCommands();
    const target = all.find(c => c.id === id);
    if (!target) return null;

    return await this.addCommand({
      name: `${target.name} (Copy)`,
      command: target.command,
      description: target.description,
      workingDirectory: target.workingDirectory,
      shell: target.shell,
      scope: target.scope
    });
  }

  private fireChange(): void {
    this._onDidChangeCommands.fire(this.getAllCommands());
  }

  public dispose(): void {
    this._onDidChangeCommands.dispose();
  }
}
