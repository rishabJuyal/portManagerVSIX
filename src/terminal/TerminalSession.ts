import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { TerminalSessionInfo } from '../types';
import { isWindows } from '../utils/platform';
import { OutputChannelService } from '../services/OutputChannelService';
import { GlobalTerminalHistory } from './GlobalTerminalHistory';

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

  // Shared Global Shell History Engine
  private historyManager = GlobalTerminalHistory.getInstance();
  private historyIndex = -1;
  private currentLine = '';
  private cursorPos = 0;
  private savedCurrentLine = '';
  private lastPrompt = '';
  private isAtPrompt = false;
  private cols = 80;
  private rows = 24;

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
      this.currentLine = '';
      this.cursorPos = 0;
      this.historyIndex = -1;

      this.process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        this.handleStdout(text);
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        this.handleStdout(text);
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

  private handleStdout(text: string): void {
    // Suppress Win32 console window title pipe error from PowerShell
    if (
      text.includes('SetConsoleWindowTitle') ||
      text.includes('setting the console window title') ||
      (text.includes('0xE9') && text.includes('No process is on the other end of the pipe'))
    ) {
      return;
    }

    // Normalize any bare \n (not preceded by \r) to \r\n to prevent diagonal staircase drift
    const normalized = text.replace(/(?<!\r)\n/g, '\r\n');

    // Detect shell prompt at the end of output stream
    const promptRegex = /(?:^|\r?\n)(PS\s+[^\r\n>]+>\s*|[A-Za-z]:\\[^\r\n>]*>\s*|[\w\-~./@\s:]+[$#>%\\]\s*)$/;
    const match = normalized.match(promptRegex);
    if (match) {
      this.isAtPrompt = true;
      this.lastPrompt = match[1] || match[0];
      this.currentLine = '';
      this.cursorPos = 0;
      this.historyIndex = -1;
    }

    this.pushData(normalized);
  }

  private pushData(data: string): void {
    this.scrollbackBuffer.push(data);
    if (this.scrollbackBuffer.length > this.maxScrollbackLines) {
      this.scrollbackBuffer.splice(0, this.scrollbackBuffer.length - this.maxScrollbackLines);
    }
    this.emit('data', data);
  }

  public getScrollback(): string {
    return this.scrollbackBuffer.join('');
  }

  public clearScrollback(): void {
    this.scrollbackBuffer = [];
    if (this.lastPrompt) {
      this.scrollbackBuffer.push(this.lastPrompt + this.currentLine);
    }
  }

  public getHistory(): string[] {
    return this.historyManager.getHistory();
  }

  public getCurrentLine(): string {
    return this.currentLine;
  }

  /**
   * Replaces the current command line on the prompt without re-printing the prompt or creating new lines.
   * Stays strictly after the prompt so it never jumps rows or overwrites previous output history.
   */
  private replaceCurrentLine(newCmd: string): void {
    let clearSeq = '';
    if (this.cursorPos > 0) {
      // Move backward by the characters typed after the prompt, and clear to end of line
      clearSeq = `\x1b[${this.cursorPos}D\x1b[K`;
    } else {
      clearSeq = '\x1b[K';
    }

    this.currentLine = newCmd;
    this.cursorPos = newCmd.length;
    this.pushData(clearSeq + newCmd);
  }

  /**
   * Main input receiver from xterm / webview
   */
  public write(data: string): void {
    if (!this.process || !this.isAlive) {
      return;
    }

    // 1. Handle Ctrl+C (\x03)
    if (data === '\x03') {
      if (this.isAtPrompt && this.currentLine.length > 0) {
        this.pushData('^C\r\n' + (this.lastPrompt || ''));
        this.currentLine = '';
        this.cursorPos = 0;
        this.historyIndex = -1;
        this.savedCurrentLine = '';
      } else {
        this.pushData('^C\r\n');
        this.currentLine = '';
        this.cursorPos = 0;
        this.historyIndex = -1;
        this.savedCurrentLine = '';
        this.isAtPrompt = false;
        try {
          if (this.process.stdin) {
            this.process.stdin.write('\x03');
          }
          this.killChildProcesses();
        } catch {
          // ignore
        }
      }
      return;
    }

    // 2. Handle Up Arrow (\x1b[A or \x1bOA) - Command History (Backwards)
    if (data === '\x1b[A' || data === '\x1bOA') {
      const history = this.historyManager.getHistory();
      if (history.length === 0) {
        return;
      }
      if (this.historyIndex === -1) {
        this.savedCurrentLine = this.currentLine;
      }
      if (this.historyIndex < history.length - 1) {
        this.historyIndex++;
        const targetCmd = history[this.historyIndex];
        this.replaceCurrentLine(targetCmd);
      }
      return;
    }

    // 3. Handle Down Arrow (\x1b[B or \x1bOB) - Command History (Forwards)
    if (data === '\x1b[B' || data === '\x1bOB') {
      const history = this.historyManager.getHistory();
      if (this.historyIndex > 0) {
        this.historyIndex--;
        const targetCmd = history[this.historyIndex];
        this.replaceCurrentLine(targetCmd);
      } else if (this.historyIndex === 0) {
        this.historyIndex = -1;
        const targetCmd = this.savedCurrentLine;
        this.replaceCurrentLine(targetCmd);
      }
      return;
    }

    // 4. Handle Left Arrow (\x1b[D or \x1bOD)
    if (data === '\x1b[D' || data === '\x1bOD') {
      if (this.cursorPos > 0) {
        this.cursorPos--;
        this.pushData('\x1b[D');
      }
      return;
    }

    // 5. Handle Right Arrow (\x1b[C or \x1bOC)
    if (data === '\x1b[C' || data === '\x1bOC') {
      if (this.cursorPos < this.currentLine.length) {
        this.cursorPos++;
        this.pushData('\x1b[C');
      }
      return;
    }

    // 6. Handle Home key (\x1b[H, \x1b[1~, \x1b[7~, \x01)
    if (data === '\x1b[H' || data === '\x1b[1~' || data === '\x1b[7~' || data === '\x01') {
      if (this.cursorPos > 0) {
        this.pushData(`\x1b[${this.cursorPos}D`);
        this.cursorPos = 0;
      }
      return;
    }

    // 7. Handle End key (\x1b[F, \x1b[4~, \x1b[8~, \x05)
    if (data === '\x1b[F' || data === '\x1b[4~' || data === '\x1b[8~' || data === '\x05') {
      if (this.cursorPos < this.currentLine.length) {
        const diff = this.currentLine.length - this.cursorPos;
        this.pushData(`\x1b[${diff}C`);
        this.cursorPos = this.currentLine.length;
      }
      return;
    }

    // 8. Handle Backspace (\x7f or \x08 or \b)
    if (data === '\x7f' || data === '\x08' || data === '\b') {
      if (this.cursorPos > 0) {
        if (this.cursorPos === this.currentLine.length) {
          this.currentLine = this.currentLine.slice(0, -1);
          this.cursorPos--;
          this.pushData('\b \b');
        } else {
          this.currentLine = this.currentLine.slice(0, this.cursorPos - 1) + this.currentLine.slice(this.cursorPos);
          this.cursorPos--;
          const tail = this.currentLine.slice(this.cursorPos);
          this.pushData('\b' + tail + ' \x1b[' + (tail.length + 1) + 'D');
        }
      }
      return;
    }

    // 9. Handle Delete key (\x1b[3~)
    if (data === '\x1b[3~') {
      if (this.cursorPos < this.currentLine.length) {
        this.currentLine = this.currentLine.slice(0, this.cursorPos) + this.currentLine.slice(this.cursorPos + 1);
        const tail = this.currentLine.slice(this.cursorPos);
        this.pushData(tail + ' \x1b[' + (tail.length + 1) + 'D');
      }
      return;
    }

    // 10. Handle Ctrl+L (\x0c) - Clear Screen
    if (data === '\x0c') {
      this.pushData('\x1b[2J\x1b[H' + (this.lastPrompt || '') + this.currentLine);
      if (this.cursorPos < this.currentLine.length) {
        this.pushData(`\x1b[${this.currentLine.length - this.cursorPos}D`);
      }
      return;
    }

    // 11. Handle Ctrl+U (\x15) - Clear line
    if (data === '\x15') {
      this.replaceCurrentLine('');
      return;
    }

    // 12. Handle Ctrl+W (\x17) - Delete word before cursor
    if (data === '\x17') {
      if (this.cursorPos > 0) {
        const before = this.currentLine.slice(0, this.cursorPos);
        const after = this.currentLine.slice(this.cursorPos);
        const trimmed = before.replace(/\s*\S*$/, '');
        this.replaceCurrentLine(trimmed + after);
        this.cursorPos = trimmed.length;
        if (this.cursorPos < this.currentLine.length) {
          this.pushData(`\x1b[${this.currentLine.length - this.cursorPos}D`);
        }
      }
      return;
    }

    // 13. Handle Tab (\t) - Path / Directory autocompletion
    if (data === '\t') {
      this.handleTabCompletion();
      return;
    }

    // 14. Handle Enter (\r or \n or \r\n)
    if (data === '\r' || data === '\n' || data === '\r\n') {
      const cmdToExecute = this.currentLine;
      this.pushData('\r\n');

      if (cmdToExecute.trim().length > 0) {
        // Record in shared global history & persist to shell history file
        this.historyManager.append(cmdToExecute.trim());
      }

      // If user typed cls or clear, clear the scrollback buffer as well
      const trimmedLower = cmdToExecute.trim().toLowerCase();
      if (trimmedLower === 'cls' || trimmedLower === 'clear') {
        this.clearScrollback();
      }

      this.currentLine = '';
      this.cursorPos = 0;
      this.historyIndex = -1;
      this.savedCurrentLine = '';
      this.isAtPrompt = false;

      try {
        if (this.process.stdin) {
          this.process.stdin.write(cmdToExecute + '\r\n');
        }
      } catch (err) {
        this.logger.error(`Failed to write to terminal stdin: ${err}`);
      }
      return;
    }

    // 15. Handle standard character typing & pasting
    if (this.isAtPrompt || this.process) {
      if (data === '\x16') {
        // Raw Ctrl+V character (SYN) - ignore to avoid prompt corruption
        return;
      }

      // Check if data is a single command/string (e.g. pasted command with optional trailing newline)
      const cleanData = data.replace(/[\r\n]+$/, '');
      if (!cleanData.includes('\n') && !cleanData.includes('\r')) {
        // Single command / string input: place on currentLine without auto-running
        if (cleanData.length > 0) {
          if (this.cursorPos === this.currentLine.length) {
            this.currentLine += cleanData;
            this.cursorPos += cleanData.length;
            this.pushData(cleanData);
          } else {
            const tail = this.currentLine.slice(this.cursorPos);
            this.currentLine = this.currentLine.slice(0, this.cursorPos) + cleanData + tail;
            this.cursorPos += cleanData.length;
            this.pushData(cleanData + tail + (tail.length > 0 ? `\x1b[${tail.length}D` : ''));
          }
        }
        return;
      }

      // If data has internal newlines (multiline paste):
      const lines = cleanData.split(/\r\n|\r|\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (i < lines.length - 1) {
          // Preceding lines in a multiline block are executed
          this.currentLine += line;
          this.pushData(line + '\r\n');
          if (this.currentLine.trim().length > 0) {
            this.historyManager.append(this.currentLine.trim());
          }
          const trimmedLower = this.currentLine.trim().toLowerCase();
          if (trimmedLower === 'cls' || trimmedLower === 'clear') {
            this.clearScrollback();
          }
          if (this.process.stdin) {
            this.process.stdin.write(this.currentLine + '\r\n');
          }
          this.currentLine = '';
          this.cursorPos = 0;
        } else if (line.length > 0) {
          // Final line is placed on prompt WITHOUT executing
          this.currentLine += line;
          this.cursorPos += line.length;
          this.pushData(line);
        }
      }
      return;
    }
  }

  private handleTabCompletion(): void {
    if (!this.isAtPrompt) return;

    try {
      const match = this.currentLine.slice(0, this.cursorPos).match(/([^\s"']+)$/);
      if (!match) return;

      const prefix = match[1];
      let searchDir = this.cwd;
      let filePrefix = prefix;

      if (prefix.includes('/') || prefix.includes('\\')) {
        const lastSlash = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'));
        const dirPart = prefix.slice(0, lastSlash + 1);
        filePrefix = prefix.slice(lastSlash + 1);
        searchDir = path.isAbsolute(dirPart) ? dirPart : path.resolve(this.cwd, dirPart);
      }

      if (!fs.existsSync(searchDir)) return;

      const entries = fs.readdirSync(searchDir);
      const matches = entries.filter(e => e.toLowerCase().startsWith(filePrefix.toLowerCase()));

      if (matches.length === 1) {
        const completion = matches[0].slice(filePrefix.length);
        const stat = fs.statSync(path.join(searchDir, matches[0]));
        const suffix = stat.isDirectory() ? (isWindows() ? '\\' : '/') : ' ';
        const insert = completion + suffix;

        this.currentLine = this.currentLine.slice(0, this.cursorPos) + insert + this.currentLine.slice(this.cursorPos);
        this.cursorPos += insert.length;
        this.pushData(insert);
      } else if (matches.length > 1) {
        let common = matches[0];
        for (let i = 1; i < matches.length; i++) {
          while (!matches[i].toLowerCase().startsWith(common.toLowerCase())) {
            common = common.slice(0, -1);
          }
        }
        if (common.length > filePrefix.length) {
          const insert = common.slice(filePrefix.length);
          this.currentLine = this.currentLine.slice(0, this.cursorPos) + insert + this.currentLine.slice(this.cursorPos);
          this.cursorPos += insert.length;
          this.pushData(insert);
        }
      }
    } catch {
      // Ignore filesystem access errors during completion
    }
  }

  public sendText(text: string, addNewline = true, bannerTitle?: string): void {
    if (addNewline) {
      if (bannerTitle) {
        const titlePart = `\x1b[1;38;2;120;220;255m⚡ ${bannerTitle}\x1b[0m`;
        const cmdPart = `\x1b[38;2;120;220;140m$ ${text}\x1b[0m`;
        const banner = `\r\n\x1b[38;2;0;122;204m╭─\x1b[0m ${titlePart} \x1b[38;2;70;80;90m────────────────────────────\x1b[0m\r\n\x1b[38;2;0;122;204m│\x1b[0m ${cmdPart}\r\n\x1b[38;2;0;122;204m╰──────────────────────────────────────────────────\x1b[0m\r\n`;
        this.pushData(banner);
      } else {
        this.pushData(text + '\r\n');
      }
      if (text.trim().length > 0) {
        this.historyManager.append(text.trim());
      }
      this.currentLine = '';
      this.cursorPos = 0;
      this.historyIndex = -1;
      this.savedCurrentLine = '';
      this.isAtPrompt = false;

      if (this.process && this.process.stdin && this.isAlive) {
        try {
          this.process.stdin.write(text + '\r\n');
        } catch (err) {
          this.logger.error(`Failed to write text to terminal ${this.id}`, err);
        }
      }
    } else {
      this.write(text);
    }
  }

  public resize(cols: number, rows: number): void {
    if (cols > 0) this.cols = cols;
    if (rows > 0) this.rows = rows;

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

  private killChildProcesses(): void {
    if (!this.process || !this.process.pid) return;

    try {
      if (isWindows()) {
        const parentPid = this.process.pid;
        setTimeout(() => {
          if (this.isAlive && this.process && this.process.pid === parentPid) {
            const killCmd = `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${parentPid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`;
            spawn(killCmd, { shell: true, windowsHide: true });
          }
        }, 400);
      }
    } catch {
      // ignore
    }
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

      try {
        this.process.stdin?.destroy();
        this.process.stdout?.destroy();
        this.process.stderr?.destroy();
        this.process.kill();
      } catch {
        // ignore
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
    this.process = null;
    this.removeAllListeners();
  }
}
