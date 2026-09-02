import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AvailableShell } from '../types';
import { isWindows, isMacOS } from '../utils/platform';

export class ShellDetector {
  /**
   * Detects all available shells on the host machine.
   */
  public static getAvailableShells(): AvailableShell[] {
    if (isWindows()) {
      return this.getWindowsShells();
    } else if (isMacOS()) {
      return this.getMacShells();
    } else {
      return this.getLinuxShells();
    }
  }

  /**
   * Detects the default shell for the current environment.
   */
  public static getDefaultShell(): string {
    const shells = this.getAvailableShells();
    const defaultShell = shells.find(s => s.isDefault);
    if (defaultShell) {
      return defaultShell.path;
    }
    return isWindows() ? 'powershell.exe' : '/bin/bash';
  }

  private static getWindowsShells(): AvailableShell[] {
    const shells: AvailableShell[] = [];
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';

    // 1. Windows PowerShell (Default)
    const winPsPath = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(winPsPath)) {
      shells.push({
        name: 'Windows PowerShell',
        path: winPsPath,
        isDefault: true
      });
    }

    // 2. PowerShell Core (pwsh.exe)
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pwshPath = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
    if (fs.existsSync(pwshPath)) {
      shells.push({
        name: 'PowerShell 7 (pwsh)',
        path: pwshPath,
        isDefault: shells.length === 0
      });
    }

    // 3. Command Prompt
    const cmdPath = path.join(sysRoot, 'System32', 'cmd.exe');
    if (fs.existsSync(cmdPath)) {
      shells.push({
        name: 'Command Prompt',
        path: cmdPath,
        isDefault: shells.length === 0
      });
    }

    // 4. Git Bash
    const gitBashPaths = [
      path.join(programFiles, 'Git', 'bin', 'bash.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'Git', 'bin', 'bash.exe')
    ];
    for (const p of gitBashPaths) {
      if (fs.existsSync(p)) {
        shells.push({ name: 'Git Bash', path: p, isDefault: false });
        break;
      }
    }

    // 5. WSL (Windows Subsystem for Linux)
    const wslPath = path.join(sysRoot, 'System32', 'wsl.exe');
    if (fs.existsSync(wslPath)) {
      shells.push({ name: 'WSL', path: wslPath, isDefault: false });
    }

    if (shells.length === 0) {
      shells.push({ name: 'Windows PowerShell', path: 'powershell.exe', isDefault: true });
    }

    return shells;
  }

  private static getMacShells(): AvailableShell[] {
    const shells: AvailableShell[] = [];
    const envShell = process.env.SHELL;

    const candidates = [
      { name: 'zsh', path: '/bin/zsh' },
      { name: 'bash', path: '/bin/bash' },
      { name: 'fish', path: '/opt/homebrew/bin/fish' },
      { name: 'fish (usr)', path: '/usr/local/bin/fish' }
    ];

    for (const c of candidates) {
      if (fs.existsSync(c.path)) {
        shells.push({
          name: c.name,
          path: c.path,
          isDefault: envShell ? envShell === c.path : c.path === '/bin/zsh'
        });
      }
    }

    if (shells.length === 0) {
      shells.push({ name: 'zsh', path: envShell || '/bin/zsh', isDefault: true });
    }

    return shells;
  }

  private static getLinuxShells(): AvailableShell[] {
    const shells: AvailableShell[] = [];
    const envShell = process.env.SHELL;

    const candidates = [
      { name: 'bash', path: '/bin/bash' },
      { name: 'zsh', path: '/usr/bin/zsh' },
      { name: 'fish', path: '/usr/bin/fish' },
      { name: 'sh', path: '/bin/sh' }
    ];

    for (const c of candidates) {
      if (fs.existsSync(c.path)) {
        shells.push({
          name: c.name,
          path: c.path,
          isDefault: envShell ? envShell === c.path : c.path === '/bin/bash'
        });
      }
    }

    if (shells.length === 0) {
      shells.push({ name: 'bash', path: envShell || '/bin/bash', isDefault: true });
    }

    return shells;
  }
}
