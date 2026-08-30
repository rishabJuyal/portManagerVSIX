import * as vscode from 'vscode';
import { ConfigService } from './ConfigService';

export class StatusBarService {
  private statusBarItem: vscode.StatusBarItem;
  private currentCount = 0;

  constructor(
    private context: vscode.ExtensionContext,
    private configService: ConfigService
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'devControlCenter.showPorts';
    this.statusBarItem.name = 'Dev Control Center Ports';

    this.updateVisibility();

    context.subscriptions.push(
      this.statusBarItem,
      this.configService.onDidChangeConfig(() => {
        this.updateVisibility();
      })
    );
  }

  public updatePortCount(count: number): void {
    this.currentCount = count;
    this.render();
  }

  private render(): void {
    const plural = this.currentCount === 1 ? 'Port' : 'Ports';
    this.statusBarItem.text = `$(plug) ${this.currentCount} ${plural}`;
    this.statusBarItem.tooltip = `Dev Control Center: ${this.currentCount} active listening ${plural.toLowerCase()}. Click to inspect.`;
  }

  private updateVisibility(): void {
    const settings = this.configService.getSettings();
    if (settings.showStatusBarItem) {
      this.render();
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
