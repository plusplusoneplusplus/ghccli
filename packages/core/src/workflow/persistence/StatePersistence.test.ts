/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { StatePersistence } from './StatePersistence.js';
import { WorkflowState } from './WorkflowState.js';
import { WorkflowDefinition } from '../types.js';
import { WorkflowContextSnapshot } from '../WorkflowContext.js';

describe('StatePersistence', () => {
  let tempDir: string;
  let persistence: StatePersistence;
  let testWorkflowState: WorkflowState;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = path.join(process.cwd(), 'test-state-' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });

    persistence = new StatePersistence({
      storageType: 'filesystem',
      baseDir: tempDir,
      maxStateAge: 1000 * 60 * 60, // 1 hour for testing
      backupEnabled: true,
      maxBackups: 3
    });

    await persistence.initialize();

    // Create test workflow state
    const workflowDefinition: WorkflowDefinition = {
      name: 'test-workflow',
      version: '1.0.0',
      steps: [
        {
          id: 'step1',
          name: 'Test Step',
          type: 'script',
          config: { command: 'echo "test"' }
        }
      ]
    };

    const contextSnapshot: WorkflowContextSnapshot = {
      workflowId: 'test-123',
      currentStepId: null,
      variables: {},
      stepOutputs: {},
      environmentVariables: {},
      logs: [],
      startTime: new Date(),
      snapshotTime: new Date()
    };

    testWorkflowState = new WorkflowState(
      'test-123',
      workflowDefinition,
      contextSnapshot,
      ['step1']
    );
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rmdir(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('filesystem storage', () => {
    it('should save and load workflow state', async () => {
      await persistence.saveState(testWorkflowState);
      
      const loaded = await persistence.loadState('test-123');
      expect(loaded).toBeTruthy();
      expect(loaded!.getSnapshot().workflowId).toBe('test-123');
    });

    it('should return null for non-existent state', async () => {
      const loaded = await persistence.loadState('non-existent');
      expect(loaded).toBeNull();
    });

    it('should check if state exists', async () => {
      expect(await persistence.hasState('test-123')).toBe(false);
      
      await persistence.saveState(testWorkflowState);
      expect(await persistence.hasState('test-123')).toBe(true);
    });

    it('should delete workflow state', async () => {
      await persistence.saveState(testWorkflowState);
      expect(await persistence.hasState('test-123')).toBe(true);
      
      await persistence.deleteState('test-123');
      expect(await persistence.hasState('test-123')).toBe(false);
    });

    it('should list workflow states', async () => {
      const states = await persistence.listStates();
      expect(states).toHaveLength(0);
      
      await persistence.saveState(testWorkflowState);
      
      const statesAfter = await persistence.listStates();
      expect(statesAfter).toHaveLength(1);
      expect(statesAfter[0].id).toBe('test-123');
    });

    it('should get state metadata', async () => {
      await persistence.saveState(testWorkflowState);
      
      const metadata = await persistence.getStateMetadata('test-123');
      expect(metadata).toBeTruthy();
      expect(metadata!.workflowId).toBe('test-123');
      expect(metadata!.size).toBeGreaterThan(0);
    });

    it('should handle backups', async () => {
      await persistence.saveState(testWorkflowState);
      
      // Modify state and save again to trigger backup
      testWorkflowState.updateWorkflowStatus('running' as any);
      await persistence.saveState(testWorkflowState);
      
      // Check that backup files exist
      const files = await fs.readdir(tempDir);
      const backupFiles = files.filter(f => f.includes('.backup.'));
      expect(backupFiles.length).toBeGreaterThan(0);
    });
  });

  describe('memory storage', () => {
    beforeEach(() => {
      persistence = new StatePersistence({
        storageType: 'memory'
      });
    });

    it('should save and load workflow state in memory', async () => {
      await persistence.saveState(testWorkflowState);
      
      const loaded = await persistence.loadState('test-123');
      expect(loaded).toBeTruthy();
      expect(loaded!.getSnapshot().workflowId).toBe('test-123');
    });

    it('should delete workflow state from memory', async () => {
      await persistence.saveState(testWorkflowState);
      expect(await persistence.hasState('test-123')).toBe(true);
      
      await persistence.deleteState('test-123');
      expect(await persistence.hasState('test-123')).toBe(false);
    });

    it('should list workflow states from memory', async () => {
      await persistence.saveState(testWorkflowState);
      
      const states = await persistence.listStates();
      expect(states).toHaveLength(1);
      expect(states[0].id).toBe('test-123');
    });
  });

  describe('cleanup', () => {
    it('should clean up old states', async () => {
      // Create an old state by manipulating the file timestamp
      await persistence.saveState(testWorkflowState);
      
      const filePath = path.join(tempDir, 'test-123.state.json');
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      await fs.utimes(filePath, oldTime, oldTime);
      
      const cleanedCount = await persistence.cleanup();
      expect(cleanedCount).toBe(1);
      
      expect(await persistence.hasState('test-123')).toBe(false);
    });

    it('should not clean up recent states', async () => {
      await persistence.saveState(testWorkflowState);
      
      const cleanedCount = await persistence.cleanup();
      expect(cleanedCount).toBe(0);
      
      expect(await persistence.hasState('test-123')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle corrupted state files gracefully', async () => {
      // Create a corrupted state file
      const filePath = path.join(tempDir, 'corrupted.state.json');
      await fs.writeFile(filePath, 'invalid json content');
      
      const loaded = await persistence.loadState('corrupted');
      expect(loaded).toBeNull();
    });

    it('should handle missing directories gracefully', async () => {
      const nonExistentPersistence = new StatePersistence({
        storageType: 'filesystem',
        baseDir: path.join(tempDir, 'non-existent')
      });
      
      await expect(nonExistentPersistence.initialize()).resolves.not.toThrow();
    });
  });

  describe('configuration', () => {
    it('should respect maxStateAge configuration', async () => {
      const shortLivedPersistence = new StatePersistence({
        storageType: 'memory',
        maxStateAge: 100 // 100ms
      });
      
      await shortLivedPersistence.saveState(testWorkflowState);
      
      // Wait for state to become old
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const cleanedCount = await shortLivedPersistence.cleanup();
      expect(cleanedCount).toBe(1);
    });

    it('should handle backup configuration correctly', async () => {
      const noBackupPersistence = new StatePersistence({
        storageType: 'filesystem',
        baseDir: tempDir,
        backupEnabled: false
      });
      
      await noBackupPersistence.initialize();
      await noBackupPersistence.saveState(testWorkflowState);
      
      const files = await fs.readdir(tempDir);
      const backupFiles = files.filter(f => f.includes('.backup.'));
      expect(backupFiles).toHaveLength(0);
    });
  });
});