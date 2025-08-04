/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowState, StepStatus } from './WorkflowState.js';
import { WorkflowDefinition, StepResult } from '../types.js';
import { WorkflowContextSnapshot } from '../WorkflowContext.js';
import { WorkflowStatus } from '../WorkflowRunner.js';

describe('WorkflowState', () => {
  let workflowDefinition: WorkflowDefinition;
  let contextSnapshot: WorkflowContextSnapshot;
  let executionOrder: string[];

  beforeEach(() => {
    workflowDefinition = {
      name: 'test-workflow',
      version: '1.0.0',
      steps: [
        {
          id: 'step1',
          name: 'First Step',
          type: 'script',
          config: { command: 'echo "hello"' }
        },
        {
          id: 'step2',
          name: 'Second Step',
          type: 'script',
          config: { command: 'echo "world"' }
        }
      ]
    };

    contextSnapshot = {
      workflowId: 'test-workflow-123',
      currentStepId: null,
      variables: { testVar: 'testValue' },
      stepOutputs: {},
      environmentVariables: { NODE_ENV: 'test' },
      logs: [],
      startTime: new Date(),
      snapshotTime: new Date()
    };

    executionOrder = ['step1', 'step2'];
  });

  describe('constructor', () => {
    it('should create a new workflow state', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      const snapshot = state.getSnapshot();
      expect(snapshot.workflowId).toBe('test-workflow-123');
      expect(snapshot.workflowName).toBe('test-workflow');
      expect(snapshot.status).toBe(WorkflowStatus.PENDING);
      expect(snapshot.executionOrder).toEqual(['step1', 'step2']);
      expect(snapshot.stepStates).toHaveProperty('step1');
      expect(snapshot.stepStates).toHaveProperty('step2');
      expect(snapshot.stepStates.step1.status).toBe(StepStatus.PENDING);
    });
  });

  describe('fromSnapshot', () => {
    it('should create workflow state from snapshot', () => {
      const originalState = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );
      
      const snapshot = originalState.getSnapshot();
      const restoredState = WorkflowState.fromSnapshot(snapshot);
      
      expect(restoredState.getSnapshot().workflowId).toBe(snapshot.workflowId);
      expect(restoredState.getSnapshot().status).toBe(snapshot.status);
    });
  });

  describe('updateWorkflowStatus', () => {
    it('should update workflow status', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      state.updateWorkflowStatus(WorkflowStatus.RUNNING);
      expect(state.getSnapshot().status).toBe(WorkflowStatus.RUNNING);
    });
  });

  describe('updateStepState', () => {
    it('should update step state', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      const result: StepResult = {
        success: true,
        output: 'hello',
        executionTime: 100
      };

      state.updateStepState('step1', StepStatus.COMPLETED, result);
      
      const stepState = state.getStepState('step1');
      expect(stepState?.status).toBe(StepStatus.COMPLETED);
      expect(stepState?.result).toEqual(result);
    });

    it('should throw error for non-existent step', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      expect(() => {
        state.updateStepState('non-existent', StepStatus.COMPLETED);
      }).toThrow('Step non-existent not found in workflow state');
    });
  });

  describe('getCurrentStepId', () => {
    it('should return current step ID', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      expect(state.getCurrentStepId()).toBe('step1');
    });

    it('should return null when all steps are completed', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      state.advanceToNextStep();
      state.advanceToNextStep();
      state.advanceToNextStep(); // Need one more advance to go past the last step
      
      expect(state.getCurrentStepId()).toBeNull();
    });
  });

  describe('canResume', () => {
    it('should return true for incomplete workflows', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      expect(state.canResume()).toBe(true);
    });

    it('should return false for completed workflows', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      state.updateWorkflowStatus(WorkflowStatus.COMPLETED);
      expect(state.canResume()).toBe(false);
    });

    it('should return false for cancelled workflows', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      state.updateWorkflowStatus(WorkflowStatus.CANCELLED);
      expect(state.canResume()).toBe(false);
    });
  });

  describe('getProgress', () => {
    it('should calculate progress correctly', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      expect(state.getProgress()).toBe(0);

      state.updateStepState('step1', StepStatus.COMPLETED);
      expect(state.getProgress()).toBe(50);

      state.updateStepState('step2', StepStatus.COMPLETED);
      expect(state.getProgress()).toBe(100);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      state.updateStepState('step1', StepStatus.COMPLETED, {
        success: true,
        output: 'test output'
      });

      const serialized = state.serialize();
      const deserialized = WorkflowState.deserialize(serialized);

      expect(deserialized.getSnapshot().workflowId).toBe(state.getSnapshot().workflowId);
      expect(deserialized.getStepState('step1')?.status).toBe(StepStatus.COMPLETED);
    });

    it('should handle dates correctly in serialization', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      const originalDate = state.getSnapshot().startTime;
      const serialized = state.serialize();
      const deserialized = WorkflowState.deserialize(serialized);

      expect(deserialized.getSnapshot().startTime).toEqual(originalDate);
      expect(deserialized.getSnapshot().startTime).toBeInstanceOf(Date);
    });
  });

  describe('getExecutionSummary', () => {
    it('should provide correct execution summary', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      state.updateStepState('step1', StepStatus.COMPLETED);
      state.updateStepState('step2', StepStatus.FAILED);
      // Keep status as non-completed to allow resume
      state.updateWorkflowStatus(WorkflowStatus.FAILED);

      const summary = state.getExecutionSummary();
      
      expect(summary.workflowId).toBe('test-workflow-123');
      expect(summary.progress).toBe(50);
      expect(summary.stepCounts[StepStatus.COMPLETED]).toBe(1);
      expect(summary.stepCounts[StepStatus.FAILED]).toBe(1);
      expect(summary.canResume).toBe(false); // Can't resume failed workflows
    });
  });

  describe('markResumed', () => {
    it('should track resume information', () => {
      const state = new WorkflowState(
        'test-workflow-123',
        workflowDefinition,
        contextSnapshot,
        executionOrder
      );

      state.markResumed('System restart');
      const snapshot = state.getSnapshot();

      expect(snapshot.resumeCount).toBe(1);
      expect(snapshot.executionMetadata.resumeReasons).toContain('System restart');
      expect(snapshot.executionMetadata.lastResumeTime).toBeInstanceOf(Date);
    });
  });
});