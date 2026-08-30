import { exec } from 'child_process';
import { promisify } from 'util';
import { IPortService } from './IPortService';
import { PortInfo, ProcessInfo } from '../types';
import { ProcessService } from '../processes/ProcessService';
import { FrameworkDetector } from './FrameworkDetector';
import { OutputChannelService } from '../services/OutputChannelService';

const execAsync = promisify(exec);

export class WindowsPortService implements IPortService {
  private processService = new ProcessService();
  private logger = OutputChannelService.getInstance();

  public async getListeningPorts(): Promise<PortInfo[]> {
    try {
      const { stdout: netstatOut } = await execAsync('netstat -ano -p tcp', { maxBuffer: 10 * 1024 * 1024 });
      const lines = netstatOut.split('\n');
      
      const rawEntries: { port: number; address: string; pid: number }[] = [];
      const pidSet = new Set<number>();

      // Netstat line format:
      // TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       23264
      // TCP    [::]:3000              [::]:0                 LISTENING       23264
      for (const line of lines) {
        if (!line.toUpperCase().includes('LISTENING')) continue;

        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[0].toUpperCase() === 'TCP') {
          const localAddr = parts[1];
          const pidStr = parts[4];
          const pid = parseInt(pidStr, 10);
          
          if (isNaN(pid)) continue;

          // Extract port from localAddr (supports 127.0.0.1:3000, 0.0.0.0:3000, [::]:3000, :::3000)
          const lastColon = localAddr.lastIndexOf(':');
          if (lastColon !== -1) {
            const portStr = localAddr.substring(lastColon + 1);
            const port = parseInt(portStr, 10);
            const address = localAddr.substring(0, lastColon);
            
            if (!isNaN(port) && port > 0) {
              rawEntries.push({ port, address, pid });
              pidSet.add(pid);
            }
          }
        }
      }

      // Batch resolve PID to Process Name using tasklist
      const pidToName = await this.batchGetProcessNames(Array.from(pidSet));

      // Build initial list
      const portMap = new Map<number, PortInfo>();

      for (const entry of rawEntries) {
        // If we already have this port, prefer 127.0.0.1 or 0.0.0.0 over IPv6 or duplicates
        const existing = portMap.get(entry.port);
        if (existing) {
          if (existing.address.includes('::') && !entry.address.includes('::')) {
            existing.address = entry.address;
            existing.pid = entry.pid;
          }
          continue;
        }

        const procName = pidToName.get(entry.pid) || (entry.pid === 4 ? 'System' : entry.pid === 0 ? 'System Idle' : 'Unknown');
        const detected = FrameworkDetector.detect(procName, undefined, entry.port);

        portMap.set(entry.port, {
          port: entry.port,
          pid: entry.pid,
          processName: procName,
          protocol: 'TCP',
          address: entry.address || '0.0.0.0',
          runtime: detected.runtime,
          framework: detected.framework,
          status: 'listening'
        });
      }

      const results = Array.from(portMap.values()).sort((a, b) => a.port - b.port);
      return results;
    } catch (err) {
      this.logger.error('Failed to get listening ports on Windows', err);
      return [];
    }
  }

  private async batchGetProcessNames(pids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (pids.length === 0) return map;

    try {
      const { stdout } = await execAsync('tasklist /FO CSV /NH', { maxBuffer: 5 * 1024 * 1024 });
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('","').map(p => p.replace(/"/g, ''));
        if (parts.length >= 2) {
          const name = parts[0];
          const pid = parseInt(parts[1], 10);
          if (!isNaN(pid)) {
            map.set(pid, name);
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to batch resolve process names with tasklist: ${err}`);
    }

    return map;
  }

  public async getProcessForPort(port: number): Promise<ProcessInfo | null> {
    const ports = await this.getListeningPorts();
    const match = ports.find(p => p.port === port);
    if (!match) return null;

    const details = await this.processService.getProcessDetails(match.pid);
    return {
      pid: match.pid,
      name: details?.name || match.processName,
      command: details?.commandLine,
      cpu: details?.cpuPercent,
      memory: details?.memoryWorkingSet,
      started: details?.startTime,
      port: match.port
    };
  }

  public async killProcess(pid: number): Promise<void> {
    await this.processService.killProcess(pid);
  }

  public dispose(): void {
    // No-op
  }
}
