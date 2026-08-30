import { SavedCommand } from '../types';

export interface CreateCommandDto {
  name: string;
  command: string;
  description?: string;
  workingDirectory?: string;
  shell?: string;
  scope?: 'workspace' | 'global';
}

export interface UpdateCommandDto {
  name?: string;
  command?: string;
  description?: string;
  workingDirectory?: string;
  shell?: string;
  scope?: 'workspace' | 'global';
}
