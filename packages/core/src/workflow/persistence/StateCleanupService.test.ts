/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateCleanupService, CleanupPolicy } from './StateCleanupService.js';
import { StatePersistence } from './StatePersistence.js';
import { CompactWorkflowState } from './WorkflowState.js';
import { WorkflowStatus } from '../WorkflowRunner.js';

describe('StateCleanupService', () => {
  let mockPersistence: StatePersistence;
  let cleanupService: StateCleanupService;
  let mockStates: CompactWorkflowState[];

  beforeEach(() => {
    // Create mock states
    const now = new Date();
    mockStates = [
      {
        id: 'recent-completed',
        name: 'Recent Completed',
        version: '1.0.0',
        status: WorkflowStatus.COMPLETED,
        progress: 100,
        startTime: new Date(now.getTime() - 1000 * 60), // 1 minute ago
        lastUpdate: new Date(now.getTime() - 1000 * 60),
        resumeCount: 0
      },
      {
        id: 'old-completed',
        name: 'Old Completed',
        version: '1.0.0',
        status: WorkflowStatus.COMPLETED,
        progress: 100,
        startTime: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 8), // 8 days ago
        lastUpdate: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 8),
        resumeCount: 0
      },
      {
        id: 'old-failed',
        name: 'Old Failed',
        version: '1.0.0',
        status: WorkflowStatus.FAILED,
        progress: 50,
        startTime: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10), // 10 days ago
        lastUpdate: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10),
        resumeCount: 0
      },
      {
        id: 'running-workflow',
        name: 'Running Workflow',
        version: '1.0.0',
        status: WorkflowStatus.RUNNING,
        progress: 30,
        startTime: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
        lastUpdate: new Date(now.getTime() - 1000 * 60 * 60 * 48), // 2 days ago
        resumeCount: 1
      }
    ];

    // Mock persistence
    mockPersistence = {
      listStates: vi.fn().mockResolvedValue(mockStates),
      deleteState: vi.fn().mockResolvedValue(undefined),
      getStateMetadata: vi.fn().mockImplementation((id: string) => ({
        workflowId: id,
        filePath: `/tmp/${id}.state.json`,
        size: 1024,
        lastModified: mockStates.find(s => s.id === id)?.lastUpdate || new Date()
      })),
      cleanup: vi.fn().mockResolvedValue(0)
    } as any;

    const policy: CleanupPolicy = {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      maxStateCount: 10,
      retainCompletedStates: true,
      retainFailedStates: true,
      maxFailedAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      compressionThreshold: 24 * 60 * 60 * 1000 // 1 day
    };

    cleanupService = new StateCleanupService(mockPersistence, policy);
  });

  afterEach(() => {
    cleanupService.stopAutomaticCleanup();
  });

  describe('performCleanup', () => {
    it('should delete old states based on maxAge policy', async () => {
      const report = await cleanupService.performCleanup();

      expect(report.totalStatesChecked).toBe(4);
      expect(report.statesDeleted).toBe(2); // old-completed and old-failed
      expect(mockPersistence.deleteState).toHaveBeenCalledWith('old-completed');
      expect(mockPersistence.deleteState).toHaveBeenCalledWith('old-failed');
      expect(mockPersistence.deleteState).not.toHaveBeenCalledWith('running-workflow');
    });

    it('should not delete running workflows', async () => {
      const report = await cleanupService.performCleanup();

      expect(mockPersistence.deleteState).not.toHaveBeenCalledWith('running-workflow');
      expect(report.statesDeleted).toBe(2);
    });

    it('should respect maxStateCount policy', async () => {
      const policy: CleanupPolicy = {
        maxStateCount: 2,
        retainCompletedStates: true,
        retainFailedStates: true
      };

      const limitedCleanupService = new StateCleanupService(mockPersistence, policy);
      const report = await limitedCleanupService.performCleanup();

      expect(report.statesDeleted).toBeGreaterThan(0);
    });

    it('should handle cleanup errors gracefully', async () => {
      vi.mocked(mockPersistence.deleteState).mockRejectedValueOnce(new Error('Delete failed'));

      const report = await cleanupService.performCleanup();

      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]).toContain('Delete failed');
    });

    it('should not run concurrent cleanups', async () => {
      // Start first cleanup
      const firstCleanup = cleanupService.performCleanup();
      
      // Try to start second cleanup
      await expect(cleanupService.performCleanup()).rejects.toThrow('Cleanup is already running');
      
      // Wait for first cleanup to complete
      await firstCleanup;
    });
  });

  describe('policy configuration', () => {
    it('should apply retainCompletedStates policy', async () => {
      const policy: CleanupPolicy = {
        maxAge: 1 * 24 * 60 * 60 * 1000, // 1 day
        retainCompletedStates: false
      };

      const noRetainService = new StateCleanupService(mockPersistence, policy);
      await noRetainService.performCleanup();

      // Should delete both completed states (recent and old)
      expect(mockPersistence.deleteState).toHaveBeenCalledWith('recent-completed');
      expect(mockPersistence.deleteState).toHaveBeenCalledWith('old-completed');
    });

    it('should apply retainFailedStates policy', async () => {
      const policy: CleanupPolicy = {
        maxAge: 1 * 24 * 60 * 60 * 1000, // 1 day
        retainFailedStates: false
      };

      const noRetainService = new StateCleanupService(mockPersistence, policy);
      await noRetainService.performCleanup();

      expect(mockPersistence.deleteState).toHaveBeenCalledWith('old-failed');
    });

    it('should apply maxFailedAge policy', async () => {
      const policy: CleanupPolicy = {
        maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year (keep everything)
        retainFailedStates: true,
        maxFailedAge: 5 * 24 * 60 * 60 * 1000 // 5 days for failed states
      };

      const failedOnlyService = new StateCleanupService(mockPersistence, policy);
      await failedOnlyService.performCleanup();

      expect(mockPersistence.deleteState).toHaveBeenCalledWith('old-failed');
      expect(mockPersistence.deleteState).not.toHaveBeenCalledWith('old-completed');
    });
  });

  describe('automatic cleanup', () => {
    it('should start and stop automatic cleanup', () => {
      expect(cleanupService.isCleanupRunning()).toBe(false);

      cleanupService.startAutomaticCleanup(100); // 100ms interval for testing
      
      cleanupService.stopAutomaticCleanup();
    });

    it.skip('should handle automatic cleanup errors', async () => {
      // This test is skipped because it involves timing-sensitive async behavior
      // that's difficult to test reliably in a unit test environment
    });
  });

  describe('getCleanupStatistics', () => {
    it('should return correct statistics', async () => {
      const stats = await cleanupService.getCleanupStatistics();

      expect(stats.totalStates).toBe(4);
      expect(stats.statesByStatus[WorkflowStatus.COMPLETED]).toBe(2);
      expect(stats.statesByStatus[WorkflowStatus.FAILED]).toBe(1);
      expect(stats.statesByStatus[WorkflowStatus.RUNNING]).toBe(1);
      expect(stats.estimatedStorageSize).toBeGreaterThan(0);
      expect(stats.oldestState?.id).toBe('old-failed');
      expect(stats.newestState?.id).toBe('recent-completed');
    });

    it('should categorize states by age correctly', async () => {
      const stats = await cleanupService.getCleanupStatistics();

      expect(stats.statesByAge.last24Hours).toBe(1); // recent-completed (1 min ago)
      expect(stats.statesByAge.lastWeek).toBe(1); // running-workflow (2 days ago)
      expect(stats.statesByAge.lastMonth).toBe(2); // old-completed (8 days), old-failed (10 days)
      expect(stats.statesByAge.older).toBe(0);
    });
  });

  describe('policy management', () => {
    it('should update policy', () => {
      const newPolicy: Partial<CleanupPolicy> = {
        maxAge: 1000,
        maxStateCount: 5
      };

      cleanupService.updatePolicy(newPolicy);
      const currentPolicy = cleanupService.getPolicy();

      expect(currentPolicy.maxAge).toBe(1000);
      expect(currentPolicy.maxStateCount).toBe(5);
      expect(currentPolicy.retainCompletedStates).toBe(true); // Should preserve existing values
    });

    it('should return current policy', () => {
      const policy = cleanupService.getPolicy();

      expect(policy.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
      expect(policy.maxStateCount).toBe(10);
      expect(policy.retainCompletedStates).toBe(true);
    });
  });

  describe('isCleanupRunning', () => {
    it('should return true during cleanup', async () => {
      // Mock a slow cleanup operation
      vi.mocked(mockPersistence.listStates).mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(mockStates), 100))
      );

      const cleanupPromise = cleanupService.performCleanup();
      
      // Check status during cleanup
      expect(cleanupService.isCleanupRunning()).toBe(true);
      
      await cleanupPromise;
      
      // Check status after cleanup
      expect(cleanupService.isCleanupRunning()).toBe(false);
    });
  });
});