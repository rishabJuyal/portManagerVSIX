import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { WorkspaceFolderInfo } from '../types';

export class WorkspaceService {
  private _onDidChangeWorkspace = new vscode.EventEmitter<WorkspaceFolderInfo[]>();
  public readonly onDidChangeWorkspace = this._onDidChangeWorkspace.event;

  constructor(private context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this._onDidChangeWorkspace.fire(this.getWorkspaceFolders());
      })
    );
  }

  public getWorkspaceFolders(): WorkspaceFolderInfo[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return [];
    }
    return folders.map(f => ({
      name: f.name,
      path: f.uri.fsPath
    }));
  }

  public getDefaultWorkingDirectory(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return os.homedir();
  }

  public getWorkspaceName(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].name;
    }
    return 'No Workspace';
  }

  public async pickWorkspaceFolder(): Promise<string | undefined> {
    const folders = this.getWorkspaceFolders();
    if (folders.length === 0) {
      return this.getDefaultWorkingDirectory();
    }
    if (folders.length === 1) {
      return folders[0].path;
    }

    const items: vscode.QuickPickItem[] = folders.map(f => ({
      label: f.name,
      description: f.path
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select workspace folder'
    });

    return selected?.description;
  }

  public dispose(): void {
    this._onDidChangeWorkspace.dispose();
  }
}
