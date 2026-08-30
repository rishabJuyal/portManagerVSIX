import { exec } from 'child_process';
import { promisify } from 'util';
import { IPortService } from './IPortService';
import { PortInfo, ProcessInfo } from '../types';
import { ProcessService } from '../processes/ProcessService';
import { FrameworkDetector } from './FrameworkDetector';
import { OutputChannelService } from '../services/OutputChannelService';

const execAsync = promisify(exec);

export class LinuxPortService implements IPortService {
  private processService = new ProcessService();
  private logger = OutputChannelService.getInstance();

  public async getListeningPorts(): Promise<PortInfo[]> {
    try {
      // First try ss -tulpn
      const ports = await this.getBySs();
      if (ports.length > 0) {
        return ports;
      }
    } catch {
      // Fallback
    }

    try {
      // Fallback to lsof
      const ports = await this.getByLsof();
      if (ports.length > 0) {
        return ports;
      }
    } catch {
      // Fallback
    }

    try {
      // Fallback to netstat
      return await this.getByNetstat();
    } catch (err) {
      this.logger.error('Failed to get listening ports on Linux', err);
      return [];
    }
  }

  private async getBySs(): Promise<PortInfo[]> {
    const { stdout } = await execAsync('ss -tulpn -H', { maxBuffer: 5 * 1024 * 1024 });
    const lines = stdout.split('\n');
    const portMap = new Map<number, PortInfo>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('tcp') && !trimmed.startsWith('LISTEN')) continue;

      const parts = trimmed.split(/\s+/);
      // Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
      const localAddr = parts[3] || parts[4];
      const procInfo = parts[parts.length - 1];

      if (!localAddr) continue;

      const lastColon = localAddr.lastIndexOf(':');
      if (lastColon === -1) continue;

      const port = parseInt(localAddr.substring(lastColon + 1), 10);
      const address = localAddr.substring(0, lastColon);

      let pid = 0;
      let procName = 'Unknown';

      // procInfo format: users:(("node",pid=1234,fd=23))
      const pidMatch = /pid=(\d+)/.exec(procInfo);
      if (pidMatch) {
        pid = parseInt(pidMatch[1], 10);
      }
      const nameMatch = /"([^"]+)"/.exec(procInfo);
      if (nameMatch) {
        procName = nameMatch[1];
      }

      if (!isNaN(port) && port > 0) {
        if (!portMap.has(port)) {
          const detected = FrameworkDetector.detect(procName, undefined, port);
          portMap.set(port, {
            port,
            pid,
            processName: procName,
            protocol: 'TCP',
            address: address || '0.0.0.0',
            runtime: detected.runtime,
            framework: detected.framework,
            status: 'listening'
          });
        }
      }
    }

    return Array.from(portMap.values()).sort((a, b) => a.port - b.port);
  }

  private async getByLsof(): Promise<PortInfo[]> {
    const { stdout } = await execAsync('lsof -iTCP -sTCP:LISTEN -n -P', { maxBuffer: 5 * 1024 * 1024 });
    const lines = stdout.split('\n');
    const portMap = new Map<number, PortInfo>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const processName = parts[0];
      const pid = parseInt(parts[1], 10);
      const nameField = parts[8];

      const lastColon = nameField.lastIndexOf(':');
      if (lastColon === -1) continue;

      const port = parseInt(nameField.substring(lastColon + 1), 10);
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
  }

  private async getByNetstat(): Promise<PortInfo[]> {
    const { stdout } = await execAsync('netstat -tulpn', { maxBuffer: 5 * 1024 * 1024 });
    const lines = stdout.split('\n');
    const portMap = new Map<number, PortInfo>();

    for (const line of lines) {
      if (!line.includes('LISTEN')) continue;

      const parts = line.trim().split(/\s+/);
      const localAddr = parts[3];
      const pidProg = parts[6];

      if (!localAddr) continue;

      const lastColon = localAddr.lastIndexOf(':');
      if (lastColon === -1) continue;

      const port = parseInt(localAddr.substring(lastColon + 1), 10);
      const address = localAddr.substring(0, lastColon);

      let pid = 0;
      let procName = 'Unknown';

      if (pidProg && pidProg.includes('/')) {
        const [p, n] = pidProg.split('/');
        pid = parseInt(p, 10) || 0;
        procName = n || 'Unknown';
      }

      if (!isNaN(port) && port > 0) {
        if (!portMap.has(port)) {
          const detected = FrameworkDetector.detect(procName, undefined, port);
          portMap.set(port, {
            port,
            pid,
            processName: procName,
            protocol: 'TCP',
            address: address || '0.0.0.0',
            runtime: detected.runtime,
            framework: detected.framework,
            status: 'listening'
          });
        }
      }
    }

    return Array.from(portMap.values()).sort((a, b) => a.port - b.port);
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
