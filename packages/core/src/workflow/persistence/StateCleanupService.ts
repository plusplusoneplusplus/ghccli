/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { StatePersistence } from './StatePersistence.js';
import { CompactWorkflowState } from './WorkflowState.js';
import { WorkflowStatus } from '../WorkflowRunner.js';

export interface CleanupPolicy {
  maxAge?: number; // milliseconds
  maxStateCount?: number;
  retainCompletedStates?: boolean;
  retainFailedStates?: boolean;
  maxFailedAge?: number; // separate retention for failed states
  compressionThreshold?: number; // compress states older than this
}

export interface CleanupReport {
  totalStatesChecked: number;
  statesDeleted: number;
  statesCompressed: number;
  bytesFreed: number;
  errors: string[];
  cleanupDuration: number;
}

export class StateCleanupService {
  private isRunning = false;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private persistence: StatePersistence,
    private policy: CleanupPolicy = {}
  ) {
    // Set default policy values
    this.policy = {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      maxStateCount: 100,
      retainCompletedStates: true,
      retainFailedStates: true,
      maxFailedAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      compressionThreshold: 24 * 60 * 60 * 1000, // 1 day
      ...policy
    };
  }

  /**
   * Start automatic cleanup with specified interval
   */
  startAutomaticCleanup(intervalMs: number = 60 * 60 * 1000): void { // 1 hour default
    if (this.cleanupInterval) {
      this.stopAutomaticCleanup();
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.performCleanup();
      } catch (error) {
        console.error('Automatic state cleanup failed:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop automatic cleanup
   */
  stopAutomaticCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Perform state cleanup based on policy
   */
  async performCleanup(): Promise<CleanupReport> {
    if (this.isRunning) {
      throw new Error('Cleanup is already running');
    }

    this.isRunning = true;
    const startTime = Date.now();
    const report: CleanupReport = {
      totalStatesChecked: 0,
      statesDeleted: 0,
      statesCompressed: 0,
      bytesFreed: 0,
      errors: [],
      cleanupDuration: 0
    };

    try {
      const states = await this.persistence.listStates();
      report.totalStatesChecked = states.length;

      // Sort states by last update time
      const sortedStates = states.sort((a, b) => 
        b.lastUpdate.getTime() - a.lastUpdate.getTime()
      );

      // Apply cleanup policies
      const statesToDelete = this.identifyStatesToDelete(sortedStates);
      const statesToCompress = this.identifyStatesToCompress(sortedStates);

      // Delete old states
      for (const state of statesToDelete) {
        try {
          const metadata = await this.persistence.getStateMetadata(state.id);
          if (metadata) {
            report.bytesFreed += metadata.size;
          }
          
          await this.persistence.deleteState(state.id);
          report.statesDeleted++;
        } catch (error) {
          report.errors.push(`Failed to delete state ${state.id}: ${error}`);
        }
      }

      // Compress old states (if supported)
      for (const state of statesToCompress) {
        try {
          await this.compressState(state.id);
          report.statesCompressed++;
        } catch (error) {
          report.errors.push(`Failed to compress state ${state.id}: ${error}`);
        }
      }

      // Clean up orphaned files
      const orphanedBytes = await this.cleanupOrphanedFiles();
      report.bytesFreed += orphanedBytes;

    } catch (error) {
      report.errors.push(`Cleanup failed: ${error}`);
    } finally {
      this.isRunning = false;
      report.cleanupDuration = Date.now() - startTime;
    }

    return report;
  }

  /**
   * Identify states that should be deleted based on policy
   */
  private identifyStatesToDelete(states: CompactWorkflowState[]): CompactWorkflowState[] {
    const toDelete: CompactWorkflowState[] = [];
    const now = new Date();

    for (const state of states) {
      const age = now.getTime() - state.lastUpdate.getTime();
      let shouldDelete = false;

      // Check max age policy
      if (this.policy.maxAge && age > this.policy.maxAge) {
        shouldDelete = true;
      }

      // Check failed state retention policy
      if (state.status === WorkflowStatus.FAILED) {
        if (!this.policy.retainFailedStates) {
          shouldDelete = true;
        } else if (this.policy.maxFailedAge && age > this.policy.maxFailedAge) {
          shouldDelete = true;
        }
      }

      // Check completed state retention policy
      if (state.status === WorkflowStatus.COMPLETED && !this.policy.retainCompletedStates) {
        shouldDelete = true;
      }

      // Skip if state is still running
      if (state.status === WorkflowStatus.RUNNING || state.status === WorkflowStatus.PENDING) {
        shouldDelete = false;
      }

      if (shouldDelete) {
        toDelete.push(state);
      }
    }

    // Apply max count policy
    if (this.policy.maxStateCount && states.length > this.policy.maxStateCount) {
      const excess = states.length - this.policy.maxStateCount;
      const oldestStates = states
        .filter(s => !toDelete.includes(s))
        .slice(-excess);
      toDelete.push(...oldestStates);
    }

    return toDelete;
  }

  /**
   * Identify states that should be compressed
   */
  private identifyStatesToCompress(states: CompactWorkflowState[]): CompactWorkflowState[] {
    if (!this.policy.compressionThreshold) {
      return [];
    }

    const now = new Date();
    return states.filter(state => {
      const age = now.getTime() - state.lastUpdate.getTime();
      return age > this.policy.compressionThreshold! && 
             (state.status === WorkflowStatus.COMPLETED || state.status === WorkflowStatus.FAILED);
    });
  }

  /**
   * Compress a state (placeholder - would implement actual compression)
   */
  private async compressState(workflowId: string): Promise<void> {
    // This is a placeholder for compression logic
    // In a real implementation, this would:
    // 1. Load the state
    // 2. Compress it (remove detailed logs, compress output data, etc.)
    // 3. Save the compressed version
    // 4. Mark it as compressed in metadata
    
    console.log(`Compressing state for workflow ${workflowId}`);
  }

  /**
   * Clean up orphaned files in the state directory
   */
  private async cleanupOrphanedFiles(): Promise<number> {
    // This would identify and remove files that don't correspond to valid states
    // For now, delegate to the persistence layer's cleanup method
    const cleanedCount = await this.persistence.cleanup();
    return cleanedCount * 1024; // Estimate bytes freed
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStatistics(): Promise<CleanupStatistics> {
    const states = await this.persistence.listStates();
    const now = new Date();

    const stats: CleanupStatistics = {
      totalStates: states.length,
      statesByStatus: {},
      statesByAge: {
        last24Hours: 0,
        lastWeek: 0,
        lastMonth: 0,
        older: 0
      },
      estimatedStorageSize: 0,
      oldestState: null,
      newestState: null
    };

    let oldestDate = new Date();
    let newestDate = new Date(0);

    for (const state of states) {
      // Count by status
      stats.statesByStatus[state.status] = (stats.statesByStatus[state.status] || 0) + 1;

      // Count by age
      const age = now.getTime() - state.lastUpdate.getTime();
      if (age < 24 * 60 * 60 * 1000) {
        stats.statesByAge.last24Hours++;
      } else if (age < 7 * 24 * 60 * 60 * 1000) {
        stats.statesByAge.lastWeek++;
      } else if (age < 30 * 24 * 60 * 60 * 1000) {
        stats.statesByAge.lastMonth++;
      } else {
        stats.statesByAge.older++;
      }

      // Track oldest and newest
      if (state.lastUpdate < oldestDate) {
        oldestDate = state.lastUpdate;
        stats.oldestState = state;
      }
      if (state.lastUpdate > newestDate) {
        newestDate = state.lastUpdate;
        stats.newestState = state;
      }

      // Estimate storage size
      try {
        const metadata = await this.persistence.getStateMetadata(state.id);
        if (metadata) {
          stats.estimatedStorageSize += metadata.size;
        }
      } catch {
        // Ignore metadata errors
      }
    }

    return stats;
  }

  /**
   * Check if cleanup is currently running
   */
  isCleanupRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Update cleanup policy
   */
  updatePolicy(newPolicy: Partial<CleanupPolicy>): void {
    this.policy = { ...this.policy, ...newPolicy };
  }

  /**
   * Get current cleanup policy
   */
  getPolicy(): CleanupPolicy {
    return { ...this.policy };
  }
}

export interface CleanupStatistics {
  totalStates: number;
  statesByStatus: Record<string, number>;
  statesByAge: {
    last24Hours: number;
    lastWeek: number;
    lastMonth: number;
    older: number;
  };
  estimatedStorageSize: number;
  oldestState: CompactWorkflowState | null;
  newestState: CompactWorkflowState | null;
}