import { IPortService } from './IPortService';
import { WindowsPortService } from './WindowsPortService';
import { MacPortService } from './MacPortService';
import { LinuxPortService } from './LinuxPortService';
import { PortInfo, ProcessInfo } from '../types';
import { isWindows, isMacOS } from '../utils/platform';
import { OutputChannelService } from '../services/OutputChannelService';

export class PortService implements IPortService {
  private delegate: IPortService;
  private logger = OutputChannelService.getInstance();
  private lastFetchTime = 0;
  private cachedPorts: PortInfo[] = [];
  private cacheTtlMs = 800; // 800ms debounce/cache

  constructor() {
    if (isWindows()) {
      this.delegate = new WindowsPortService();
    } else if (isMacOS()) {
      this.delegate = new MacPortService();
    } else {
      this.delegate = new LinuxPortService();
    }
  }

  public async getListeningPorts(forceRefresh = false): Promise<PortInfo[]> {
    const now = Date.now();
    if (!forceRefresh && now - this.lastFetchTime < this.cacheTtlMs && this.cachedPorts.length > 0) {
      return this.cachedPorts;
    }

    try {
      const ports = await this.delegate.getListeningPorts();
      this.cachedPorts = ports;
      this.lastFetchTime = Date.now();
      return ports;
    } catch (err) {
      this.logger.error('Error fetching listening ports', err);
      return this.cachedPorts;
    }
  }

  public async getProcessForPort(port: number): Promise<ProcessInfo | null> {
    try {
      return await this.delegate.getProcessForPort(port);
    } catch (err) {
      this.logger.error(`Error getting process for port ${port}`, err);
      return null;
    }
  }

  public async killProcess(pid: number): Promise<void> {
    try {
      await this.delegate.killProcess(pid);
      // Invalidate cache immediately so UI reflects termination
      this.lastFetchTime = 0;
      this.cachedPorts = this.cachedPorts.filter(p => p.pid !== pid);
    } catch (err) {
      this.logger.error(`Error killing process PID ${pid}`, err);
      throw err;
    }
  }

  public dispose(): void {
    this.delegate.dispose();
  }
}
