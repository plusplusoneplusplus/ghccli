/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkflowState, WorkflowStateSnapshot, CompactWorkflowState } from './WorkflowState.js';

export interface PersistenceConfig {
  storageType?: 'filesystem' | 'memory';
  baseDir?: string;
  maxStateAge?: number; // in milliseconds
  compressionEnabled?: boolean;
  backupEnabled?: boolean;
  maxBackups?: number;
}

export interface StateMetadata {
  workflowId: string;
  filePath: string;
  size: number;
  lastModified: Date;
  checksum?: string;
}

export class StatePersistence {
  private config: Required<PersistenceConfig>;
  private memoryStore: Map<string, WorkflowStateSnapshot> = new Map();

  constructor(config: PersistenceConfig = {}) {
    this.config = {
      storageType: config.storageType || 'filesystem',
      baseDir: config.baseDir || path.join(process.cwd(), '.workflow-state'),
      maxStateAge: config.maxStateAge || 7 * 24 * 60 * 60 * 1000, // 7 days
      compressionEnabled: config.compressionEnabled ?? false,
      backupEnabled: config.backupEnabled ?? true,
      maxBackups: config.maxBackups || 5
    };
  }

  /**
   * Initialize the persistence layer
   */
  async initialize(): Promise<void> {
    if (this.config.storageType === 'filesystem') {
      await this.ensureStateDirectory();
    }
  }

  /**
   * Save workflow state
   */
  async saveState(workflowState: WorkflowState): Promise<void> {
    const snapshot = workflowState.getSnapshot();
    
    if (this.config.storageType === 'filesystem') {
      await this.saveToFilesystem(snapshot);
    } else {
      this.memoryStore.set(snapshot.workflowId, snapshot);
    }
  }

  /**
   * Load workflow state by ID
   */
  async loadState(workflowId: string): Promise<WorkflowState | null> {
    let snapshot: WorkflowStateSnapshot | null = null;

    if (this.config.storageType === 'filesystem') {
      snapshot = await this.loadFromFilesystem(workflowId);
    } else {
      snapshot = this.memoryStore.get(workflowId) || null;
    }

    return snapshot ? WorkflowState.fromSnapshot(snapshot) : null;
  }

  /**
   * Check if state exists for workflow ID
   */
  async hasState(workflowId: string): Promise<boolean> {
    if (this.config.storageType === 'filesystem') {
      const filePath = this.getStateFilePath(workflowId);
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    } else {
      return this.memoryStore.has(workflowId);
    }
  }

  /**
   * Delete workflow state
   */
  async deleteState(workflowId: string): Promise<void> {
    if (this.config.storageType === 'filesystem') {
      const filePath = this.getStateFilePath(workflowId);
      try {
        await fs.unlink(filePath);
        
        // Also delete backup files if they exist
        if (this.config.backupEnabled) {
          await this.deleteBackups(workflowId);
        }
      } catch (error) {
        // Ignore file not found errors
        if ((error as any).code !== 'ENOENT') {
          throw error;
        }
      }
    } else {
      this.memoryStore.delete(workflowId);
    }
  }

  /**
   * List all workflow states
   */
  async listStates(): Promise<CompactWorkflowState[]> {
    if (this.config.storageType === 'filesystem') {
      return this.listFilesystemStates();
    } else {
      return Array.from(this.memoryStore.values()).map(snapshot => 
        WorkflowState.fromSnapshot(snapshot).getCompactSnapshot()
      );
    }
  }

  /**
   * Get state metadata
   */
  async getStateMetadata(workflowId: string): Promise<StateMetadata | null> {
    if (this.config.storageType === 'filesystem') {
      const filePath = this.getStateFilePath(workflowId);
      try {
        const stats = await fs.stat(filePath);
        return {
          workflowId,
          filePath,
          size: stats.size,
          lastModified: stats.mtime
        };
      } catch {
        return null;
      }
    } else {
      const snapshot = this.memoryStore.get(workflowId);
      if (!snapshot) return null;

      const serialized = JSON.stringify(snapshot);
      return {
        workflowId,
        filePath: '<memory>',
        size: Buffer.byteLength(serialized, 'utf8'),
        lastModified: snapshot.lastUpdateTime
      };
    }
  }

  /**
   * Clean up old states based on maxStateAge
   */
  async cleanup(): Promise<number> {
    const cutoffTime = new Date(Date.now() - this.config.maxStateAge);
    let cleanedCount = 0;

    if (this.config.storageType === 'filesystem') {
      try {
        const files = await fs.readdir(this.config.baseDir);
        const stateFiles = files.filter(file => file.endsWith('.state.json'));

        for (const file of stateFiles) {
          const filePath = path.join(this.config.baseDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime < cutoffTime) {
            await fs.unlink(filePath);
            
            // Also clean up associated backups
            const workflowId = file.replace('.state.json', '');
            await this.deleteBackups(workflowId);
            
            cleanedCount++;
          }
        }
      } catch (error) {
        // Directory might not exist yet
      }
    } else {
      for (const [workflowId, snapshot] of this.memoryStore.entries()) {
        if (snapshot.lastUpdateTime < cutoffTime) {
          this.memoryStore.delete(workflowId);
          cleanedCount++;
        }
      }
    }

    return cleanedCount;
  }

  /**
   * Create backup of current state
   */
  async createBackup(workflowId: string): Promise<void> {
    if (!this.config.backupEnabled || this.config.storageType !== 'filesystem') {
      return;
    }

    const filePath = this.getStateFilePath(workflowId);
    try {
      const backupPath = this.getBackupFilePath(workflowId, new Date());
      await fs.copyFile(filePath, backupPath);
      
      // Clean up old backups
      await this.cleanupOldBackups(workflowId);
    } catch {
      // Ignore backup errors - they shouldn't fail the main operation
    }
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(workflowId: string, backupDate?: Date): Promise<boolean> {
    if (!this.config.backupEnabled || this.config.storageType !== 'filesystem') {
      return false;
    }

    try {
      const backupPath = backupDate ? 
        this.getBackupFilePath(workflowId, backupDate) :
        await this.getLatestBackupPath(workflowId);

      if (!backupPath) return false;

      const filePath = this.getStateFilePath(workflowId);
      await fs.copyFile(backupPath, filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Private methods
   */

  private async ensureStateDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.baseDir, { recursive: true });
    } catch (error) {
      if ((error as any).code !== 'EEXIST') {
        throw new Error(`Failed to create state directory: ${error}`);
      }
    }
  }

  private getStateFilePath(workflowId: string): string {
    return path.join(this.config.baseDir, `${workflowId}.state.json`);
  }

  private getBackupFilePath(workflowId: string, date: Date): string {
    const timestamp = date.toISOString().replace(/[:.]/g, '-');
    return path.join(this.config.baseDir, `${workflowId}.backup.${timestamp}.json`);
  }

  private async saveToFilesystem(snapshot: WorkflowStateSnapshot): Promise<void> {
    const filePath = this.getStateFilePath(snapshot.workflowId);
    
    // Create backup before overwriting
    if (this.config.backupEnabled) {
      await this.createBackup(snapshot.workflowId);
    }

    const serialized = JSON.stringify(snapshot, (key, value) => {
      if (value instanceof Date) {
        return { __type: 'Date', value: value.toISOString() };
      }
      return value;
    }, 2);

    await fs.writeFile(filePath, serialized, 'utf8');
  }

  private async loadFromFilesystem(workflowId: string): Promise<WorkflowStateSnapshot | null> {
    const filePath = this.getStateFilePath(workflowId);
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content, (key, value) => {
        if (value && typeof value === 'object' && value.__type === 'Date') {
          return new Date(value.value);
        }
        return value;
      });

      return parsed;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      // For corrupted files, return null instead of throwing
      if (error instanceof SyntaxError) {
        return null;
      }
      throw new Error(`Failed to load workflow state: ${error}`);
    }
  }

  private async listFilesystemStates(): Promise<CompactWorkflowState[]> {
    try {
      const files = await fs.readdir(this.config.baseDir);
      const stateFiles = files.filter(file => file.endsWith('.state.json'));
      
      const states: CompactWorkflowState[] = [];
      
      for (const file of stateFiles) {
        try {
          const workflowId = file.replace('.state.json', '');
          const snapshot = await this.loadFromFilesystem(workflowId);
          if (snapshot) {
            states.push(WorkflowState.fromSnapshot(snapshot).getCompactSnapshot());
          }
        } catch {
          // Skip corrupted files
          continue;
        }
      }
      
      return states.sort((a, b) => b.lastUpdate.getTime() - a.lastUpdate.getTime());
    } catch {
      return [];
    }
  }

  private async deleteBackups(workflowId: string): Promise<void> {
    try {
      const files = await fs.readdir(this.config.baseDir);
      const backupFiles = files.filter(file => 
        file.startsWith(`${workflowId}.backup.`) && file.endsWith('.json')
      );

      for (const file of backupFiles) {
        try {
          await fs.unlink(path.join(this.config.baseDir, file));
        } catch {
          // Ignore individual file deletion errors
        }
      }
    } catch {
      // Ignore if directory doesn't exist
    }
  }

  private async cleanupOldBackups(workflowId: string): Promise<void> {
    try {
      const files = await fs.readdir(this.config.baseDir);
      const backupFiles = files
        .filter(file => file.startsWith(`${workflowId}.backup.`) && file.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first

      if (backupFiles.length > this.config.maxBackups) {
        const filesToDelete = backupFiles.slice(this.config.maxBackups);
        for (const file of filesToDelete) {
          try {
            await fs.unlink(path.join(this.config.baseDir, file));
          } catch {
            // Ignore individual file deletion errors
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private async getLatestBackupPath(workflowId: string): Promise<string | null> {
    try {
      const files = await fs.readdir(this.config.baseDir);
      const backupFiles = files
        .filter(file => file.startsWith(`${workflowId}.backup.`) && file.endsWith('.json'))
        .sort()
        .reverse();

      if (backupFiles.length === 0) return null;

      return path.join(this.config.baseDir, backupFiles[0]);
    } catch {
      return null;
    }
  }
}