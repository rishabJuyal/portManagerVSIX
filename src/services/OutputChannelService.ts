import * as vscode from 'vscode';

export class OutputChannelService {
  private static instance: OutputChannelService;
  private channel: vscode.OutputChannel;

  private constructor() {
    this.channel = vscode.window.createOutputChannel('Dev Control Center');
  }

  public static getInstance(): OutputChannelService {
    if (!OutputChannelService.instance) {
      OutputChannelService.instance = new OutputChannelService();
    }
    return OutputChannelService.instance;
  }

  public info(message: string): void {
    const timestamp = new Date().toISOString();
    this.channel.appendLine(`[${timestamp}] [INFO] ${message}`);
  }

  public warn(message: string): void {
    const timestamp = new Date().toISOString();
    this.channel.appendLine(`[${timestamp}] [WARN] ${message}`);
  }

  public error(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    let errDetail = '';
    if (error instanceof Error) {
      errDetail = `\n${error.stack || error.message}`;
    } else if (error) {
      errDetail = `\n${JSON.stringify(error)}`;
    }
    this.channel.appendLine(`[${timestamp}] [ERROR] ${message}${errDetail}`);
  }

  public show(): void {
    this.channel.show(true);
  }

  public dispose(): void {
    this.channel.dispose();
  }
}
