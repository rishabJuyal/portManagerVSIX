import { PortInfo, ProcessInfo } from '../types';

export interface IPortService {
  getListeningPorts(): Promise<PortInfo[]>;
  getProcessForPort(port: number): Promise<ProcessInfo | null>;
  killProcess(pid: number): Promise<void>;
  dispose(): void;
}
