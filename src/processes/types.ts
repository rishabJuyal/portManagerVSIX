export interface DetailedProcessInfo {
  pid: number;
  name: string;
  commandLine?: string;
  cpuPercent?: string;
  memoryWorkingSet?: string;
  startTime?: string;
  status?: string;
}
