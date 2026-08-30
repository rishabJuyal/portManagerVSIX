import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';
import { TerminalSessionInfo } from '../types';
import { isWindows } from '../utils/platform';
import { OutputChannelService } from '../services/OutputChannelService';

export interface TerminalSessionOptions {
  id: string;
  name: string;
  cwd: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

export class TerminalSession extends EventEmitter {
  public readonly id: string;
  public name: string;
  public cwd: string;
  public shell: string;
  public readonly createdAt: number;
  public isActive = false;
  public isAlive = false;

  private process: ChildProcess | null = null;
  private logger = OutputChannelService.getInstance();
  private scrollbackBuffer: string[] = [];
  private readonly maxScrollbackLines = 1000;

  constructor(options: TerminalSessionOptions) {
    super();
    this.id = options.id;
    this.name = options.name;
    this.cwd = options.cwd || os.homedir();
    this.shell = options.shell || (isWindows() ? 'powershell.exe' : '/bin/bash');
    this.createdAt = Date.now();

    this.startProcess(options.cols || 80, options.rows || 24);
  }

  private startProcess(cols: number, rows: number): void {
    try {
      const shellLower = this.shell.toLowerCase();
      let shellArgs: string[] = [];

      if (shellLower.includes('powershell') || shellLower.includes('pwsh')) {
        shellArgs = ['-NoLogo', '-NoExit'];
      } else if (shellLower.includes('cmd.exe')) {
        shellArgs = ['/K'];
      } else if (shellLower.includes('bash') || shellLower.includes('zsh')) {
        shellArgs = ['-i'];
      }

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
        COLUMNS: String(cols),
        LINES: String(rows)
      };

      this.process = spawn(this.shell, shellArgs, {
        cwd: this.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      });

      this.isAlive = true;

      // Welcome banner
      const welcomeMsg = `\r\n\x1b[1;36m Dev Control Center Terminal [${this.name}]\x1b[0m\r\n\x1b[90m Shell: ${this.shell} | CWD: ${this.cwd}\x1b[0m\r\n\r\n`;
      this.pushData(welcomeMsg);

      this.process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        this.pushData(text);
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        this.pushData(text);
      });

      this.process.on('error', (err) => {
        this.logger.error(`Terminal session ${this.id} error`, err);
        const errMsg = `\r\n\x1b[31m[Process Error: ${err.message}]\x1b[0m\r\n`;
        this.pushData(errMsg);
        this.isAlive = false;
        this.emit('exit', -1);
      });

      this.process.on('close', (code) => {
        this.logger.info(`Terminal session ${this.id} exited with code ${code}`);
        const exitMsg = `\r\n\x1b[90m[Process exited with code ${code ?? 0}]\x1b[0m\r\n`;
        this.pushData(exitMsg);
        this.isAlive = false;
        this.emit('exit', code);
      });
    } catch (err) {
      this.logger.error(`Failed to launch shell "${this.shell}"`, err);
      const errMsg = `\r\n\x1b[31mFailed to launch shell ${this.shell}: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`;
      this.pushData(errMsg);
      this.isAlive = false;
    }
  }

  private pushData(data: string): void {
    // Maintain scrollback
    this.scrollbackBuffer.push(data);
    if (this.scrollbackBuffer.length > this.maxScrollbackLines) {
      this.scrollbackBuffer.splice(0, this.scrollbackBuffer.length - this.maxScrollbackLines);
    }
    this.emit('data', data);
  }

  public getScrollback(): string {
    return this.scrollbackBuffer.join('');
  }

  public write(data: string): void {
    if (this.process && this.process.stdin && this.isAlive) {
      try {
        this.process.stdin.write(data);
      } catch (err) {
        this.logger.error(`Failed to write to terminal ${this.id}`, err);
      }
    }
  }

  public resize(cols: number, rows: number): void {
    // For standard pipes, resize signal can be simulated or sent via process signals where supported
    if (this.process && !isWindows() && this.process.pid) {
      try {
        process.kill(this.process.pid, 'SIGWINCH');
      } catch {
        // ignore
      }
    }
  }

  public restart(): void {
    this.kill();
    this.scrollbackBuffer = [];
    this.startProcess(80, 24);
  }

  public kill(): void {
    if (this.process && this.isAlive) {
      try {
        if (isWindows() && this.process.pid) {
          spawn('taskkill', ['/F', '/T', '/PID', String(this.process.pid)], { windowsHide: true });
        } else if (this.process.pid) {
          this.process.kill('SIGKILL');
        }
      } catch (err) {
        this.logger.warn(`Error killing terminal process: ${err}`);
      }
      this.isAlive = false;
    }
  }

  public getInfo(): TerminalSessionInfo {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      shell: this.shell,
      createdAt: this.createdAt,
      isActive: this.isActive,
      isAlive: this.isAlive
    };
  }

  public dispose(): void {
    this.kill();
    this.removeAllListeners();
  }
}
