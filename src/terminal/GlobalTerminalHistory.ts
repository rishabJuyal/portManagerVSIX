import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isWindows, isMacOS } from '../utils/platform';
import { OutputChannelService } from '../services/OutputChannelService';

export class GlobalTerminalHistory {
  private static instance: GlobalTerminalHistory | null = null;
  private history: string[] = [];
  private historyFilePath: string | null = null;
  private logger = OutputChannelService.getInstance();
  private readonly maxHistoryLength = 1000;

  private constructor() {
    this.historyFilePath = this.detectHistoryFilePath();
    this.loadHistoryFromFile();
  }

  public static getInstance(): GlobalTerminalHistory {
    if (!GlobalTerminalHistory.instance) {
      GlobalTerminalHistory.instance = new GlobalTerminalHistory();
    }
    return GlobalTerminalHistory.instance;
  }

  private detectHistoryFilePath(): string | null {
    try {
      const home = os.homedir();

      if (isWindows()) {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        
        // 1. Windows PowerShell 5.1 history
        const winPsHistory = path.join(appData, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt');
        if (fs.existsSync(winPsHistory)) {
          return winPsHistory;
        }

        // 2. PowerShell Core 7+ history
        const pwshHistory = path.join(appData, 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt');
        if (fs.existsSync(pwshHistory)) {
          return pwshHistory;
        }

        // Default to creating/using Windows PowerShell history path
        const defaultDir = path.join(appData, 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine');
        return path.join(defaultDir, 'ConsoleHost_history.txt');
      } else {
        // macOS / Linux
        const zshHistory = path.join(home, '.zsh_history');
        if (fs.existsSync(zshHistory)) {
          return zshHistory;
        }

        const bashHistory = path.join(home, '.bash_history');
        if (fs.existsSync(bashHistory)) {
          return bashHistory;
        }

        return isMacOS() ? zshHistory : bashHistory;
      }
    } catch (err) {
      this.logger.warn(`Could not determine shell history file path: ${err}`);
      return null;
    }
  }

  private loadHistoryFromFile(): void {
    if (!this.historyFilePath) return;

    try {
      if (fs.existsSync(this.historyFilePath)) {
        const content = fs.readFileSync(this.historyFilePath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const parsed: string[] = [];

        for (const rawLine of lines) {
          let line = rawLine.trim();
          if (!line) continue;

          // Parse zsh extended history format ": 1234567890:0;command"
          if (line.startsWith(':') && line.includes(';')) {
            const semiIndex = line.indexOf(';');
            line = line.slice(semiIndex + 1).trim();
          }

          if (line) {
            parsed.push(line);
          }
        }

        // Keep most recent commands at index 0 (reversed for Up-Arrow navigation)
        const recent = parsed.slice(-this.maxHistoryLength).reverse();
        this.history = recent;
        this.logger.info(`Loaded ${this.history.length} commands from system shell history (${this.historyFilePath})`);
      }
    } catch (err) {
      this.logger.warn(`Failed to read system shell history file: ${err}`);
    }
  }

  public getHistory(): string[] {
    return [...this.history];
  }

  public append(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;

    // Avoid consecutive duplicates
    if (this.history.length === 0 || this.history[0] !== trimmed) {
      this.history.unshift(trimmed);
      if (this.history.length > this.maxHistoryLength) {
        this.history.pop();
      }

      // Persist to system history file so other terminal sessions and system shells also see it
      this.persistCommandToFile(trimmed);
    }
  }

  private persistCommandToFile(command: string): void {
    if (!this.historyFilePath) return;

    try {
      const dir = path.dirname(this.historyFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.historyFilePath, command + '\n', 'utf-8');
    } catch (err) {
      // Non-blocking file append error
      this.logger.warn(`Could not append command to shell history file: ${err}`);
    }
  }
}
