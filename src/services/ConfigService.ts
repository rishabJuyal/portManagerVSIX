import * as vscode from 'vscode';
import { ExtensionSettings } from '../types';

export class ConfigService {
  private static readonly SECTION = 'devControlCenter';
  private _onDidChangeConfig = new vscode.EventEmitter<ExtensionSettings>();
  public readonly onDidChangeConfig = this._onDidChangeConfig.event;

  constructor(private context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(ConfigService.SECTION)) {
          this._onDidChangeConfig.fire(this.getSettings());
        }
      })
    );
  }

  public getSettings(): ExtensionSettings {
    const config = vscode.workspace.getConfiguration(ConfigService.SECTION);
    return {
      confirmBeforeKill: config.get<boolean>('confirmBeforeKill', true),
      autoRefreshPorts: config.get<boolean>('autoRefreshPorts', true),
      portRefreshInterval: config.get<number>('portRefreshInterval', 3000),
      showStatusBarItem: config.get<boolean>('showStatusBarItem', true),
      terminalFontSize: config.get<number>('terminalFontSize', 13),
      terminalFontFamily: config.get<string>(
        'terminalFontFamily',
        "Consolas, 'Courier New', monospace, Menlo, 'DejaVu Sans Mono'"
      ),
      defaultShell: config.get<string>('defaultShell', ''),
      defaultRunLocation: config.get<'activeTerminal' | 'newTerminal'>('defaultRunLocation', 'activeTerminal')
    };
  }

  public async updateSetting<T>(key: string, value: T, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global): Promise<void> {
    const config = vscode.workspace.getConfiguration(ConfigService.SECTION);
    await config.update(key, value, target);
  }

  public dispose(): void {
    this._onDidChangeConfig.dispose();
  }
}
