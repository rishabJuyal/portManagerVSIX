import { exec } from 'child_process';
import { promisify } from 'util';
import { IPortService } from './IPortService';
import { PortInfo, ProcessInfo } from '../types';
import { ProcessService } from '../processes/ProcessService';
import { FrameworkDetector } from './FrameworkDetector';
import { OutputChannelService } from '../services/OutputChannelService';

const execAsync = promisify(exec);

export class MacPortService implements IPortService {
  private processService = new ProcessService();
  private logger = OutputChannelService.getInstance();

  public async getListeningPorts(): Promise<PortInfo[]> {
    try {
      // lsof -iTCP -sTCP:LISTEN -n -P
      const { stdout } = await execAsync('lsof -iTCP -sTCP:LISTEN -n -P', { maxBuffer: 10 * 1024 * 1024 });
      const lines = stdout.split('\n');
      const portMap = new Map<number, PortInfo>();

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        // e.g.: node 1234 user 23u IPv6 0x123 0t0 TCP *:3000 (LISTEN)
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;

        const processName = parts[0];
        const pid = parseInt(parts[1], 10);
        const nameField = parts[8];

        if (isNaN(pid) || !nameField) continue;

        const lastColon = nameField.lastIndexOf(':');
        if (lastColon === -1) continue;

        const portStr = nameField.substring(lastColon + 1);
        const port = parseInt(portStr, 10);
        const address = nameField.substring(0, lastColon);

        if (!isNaN(port) && port > 0) {
          if (!portMap.has(port)) {
            const detected = FrameworkDetector.detect(processName, undefined, port);
            portMap.set(port, {
              port,
              pid,
              processName,
              protocol: 'TCP',
              address: address === '*' ? '0.0.0.0' : address,
              runtime: detected.runtime,
              framework: detected.framework,
              status: 'listening'
            });
          }
        }
      }

      return Array.from(portMap.values()).sort((a, b) => a.port - b.port);
    } catch (err) {
      this.logger.warn(`lsof failed or returned no ports on macOS: ${err}`);
      return [];
    }
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
