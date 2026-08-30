import { exec } from 'child_process';
import { promisify } from 'util';
import { isWindows, isMacOS, isLinux } from '../utils/platform';
import { DetailedProcessInfo } from './types';
import { OutputChannelService } from '../services/OutputChannelService';
import { formatBytes } from '../utils/formatters';

const execAsync = promisify(exec);

export class ProcessService {
  private logger = OutputChannelService.getInstance();

  /**
   * Retrieves detailed process information for a given PID.
   * Handles permissions and missing processes gracefully.
   */
  public async getProcessDetails(pid: number): Promise<DetailedProcessInfo | null> {
    if (!pid || pid <= 0) {
      return null;
    }

    try {
      if (isWindows()) {
        return await this.getWindowsProcessDetails(pid);
      } else if (isMacOS()) {
        return await this.getMacProcessDetails(pid);
      } else {
        return await this.getLinuxProcessDetails(pid);
      }
    } catch (err) {
      this.logger.warn(`Could not inspect process with PID ${pid}: ${err instanceof Error ? err.message : String(err)}`);
      return {
        pid,
        name: 'Unknown',
        commandLine: 'Command unavailable (Permission or Process Exited)'
      };
    }
  }

  private async getWindowsProcessDetails(pid: number): Promise<DetailedProcessInfo> {
    try {
      // Use PowerShell Get-CimInstance for process details
      const cmd = `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ProcessId, Name, CommandLine, WorkingSetSize, CreationDate | ConvertTo-Json"`;
      const { stdout } = await execAsync(cmd, { timeout: 3000 });
      
      if (!stdout || !stdout.trim()) {
        return {
          pid,
          name: 'Unknown',
          commandLine: 'Command unavailable'
        };
      }

      const parsed = JSON.parse(stdout.trim());
      const workingSetBytes = parsed.WorkingSetSize ? Number(parsed.WorkingSetSize) : undefined;
      let startTimeFormatted: string | undefined;
      
      if (parsed.CreationDate) {
        // Formatted WMI date like /Date(1234567890)/ or ISO
        const match = /\/Date\((\d+)\)\//.exec(parsed.CreationDate);
        if (match) {
          startTimeFormatted = new Date(Number(match[1])).toLocaleTimeString();
        } else {
          try {
            startTimeFormatted = new Date(parsed.CreationDate).toLocaleTimeString();
          } catch {
            startTimeFormatted = parsed.CreationDate;
          }
        }
      }

      return {
        pid: parsed.ProcessId || pid,
        name: parsed.Name || 'Unknown',
        commandLine: parsed.CommandLine || 'Command unavailable',
        memoryWorkingSet: workingSetBytes ? formatBytes(workingSetBytes) : undefined,
        startTime: startTimeFormatted
      };
    } catch (psErr) {
      // Fallback to tasklist
      try {
        const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { timeout: 2000 });
        const line = stdout.trim().split('\n')[0];
        if (line) {
          const parts = line.split('","').map(p => p.replace(/"/g, ''));
          if (parts.length >= 5) {
            return {
              pid,
              name: parts[0],
              memoryWorkingSet: parts[4],
              commandLine: 'Command unavailable'
            };
          }
        }
      } catch {
        // ignore
      }

      return {
        pid,
        name: 'Process ' + pid,
        commandLine: 'Command unavailable'
      };
    }
  }

  private async getMacProcessDetails(pid: number): Promise<DetailedProcessInfo> {
    try {
      const { stdout } = await execAsync(`ps -p ${pid} -o pid=,comm=,args=,%cpu=,%mem=,lstart=`, { timeout: 2000 });
      const trimmed = stdout.trim();
      if (!trimmed) {
        return { pid, name: 'Unknown', commandLine: 'Command unavailable' };
      }

      const match = trimmed.match(/^\s*(\d+)\s+([^\s]+)\s+(.+?)\s+([\d\.]+)\s+([\d\.]+)\s+(.+)$/);
      if (match) {
        return {
          pid: Number(match[1]),
          name: match[2],
          commandLine: match[3],
          cpuPercent: `${match[4]}%`,
          memoryWorkingSet: `${match[5]}%`,
          startTime: match[6]
        };
      }

      return { pid, name: 'Unknown', commandLine: trimmed };
    } catch {
      return { pid, name: 'Unknown', commandLine: 'Command unavailable' };
    }
  }

  private async getLinuxProcessDetails(pid: number): Promise<DetailedProcessInfo> {
    try {
      const { stdout } = await execAsync(`ps -p ${pid} -o pid=,comm=,args=,%cpu=,%mem=,lstart=`, { timeout: 2000 });
      const trimmed = stdout.trim();
      if (!trimmed) {
        return { pid, name: 'Unknown', commandLine: 'Command unavailable' };
      }

      const match = trimmed.match(/^\s*(\d+)\s+([^\s]+)\s+(.+?)\s+([\d\.]+)\s+([\d\.]+)\s+(.+)$/);
      if (match) {
        return {
          pid: Number(match[1]),
          name: match[2],
          commandLine: match[3],
          cpuPercent: `${match[4]}%`,
          memoryWorkingSet: `${match[5]}%`,
          startTime: match[6]
        };
      }

      return { pid, name: 'Unknown', commandLine: trimmed };
    } catch {
      return { pid, name: 'Unknown', commandLine: 'Command unavailable' };
    }
  }

  /**
   * Kills a process by PID across Windows, macOS, or Linux.
   */
  public async killProcess(pid: number): Promise<void> {
    if (!pid || pid <= 0) {
      throw new Error(`Invalid PID: ${pid}`);
    }

    if (isWindows()) {
      try {
        await execAsync(`taskkill /F /T /PID ${pid}`);
      } catch (err: any) {
        // Fallback to powershell Stop-Process
        try {
          await execAsync(`powershell -NoProfile -NonInteractive -Command "Stop-Process -Id ${pid} -Force"`);
        } catch {
          throw new Error(`Failed to terminate process ${pid}: ${err?.message || 'Access Denied'}`);
        }
      }
    } else {
      try {
        await execAsync(`kill -9 ${pid}`);
      } catch (err: any) {
        throw new Error(`Failed to terminate process ${pid}: ${err?.message || 'Permission denied'}`);
      }
    }
  }
}
