import * as os from 'os';

export function isWindows(): boolean {
  return os.platform() === 'win32';
}

export function isMacOS(): boolean {
  return os.platform() === 'darwin';
}

export function isLinux(): boolean {
  return os.platform() === 'linux';
}

export function getPlatform(): 'windows' | 'macos' | 'linux' {
  if (isWindows()) return 'windows';
  if (isMacOS()) return 'macos';
  return 'linux';
}
