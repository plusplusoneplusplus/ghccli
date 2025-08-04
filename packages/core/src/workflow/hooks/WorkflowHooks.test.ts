/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowHooks } from './WorkflowHooks.js';
import { WorkflowEvent } from './HookSystem.js';
import { WorkflowContext } from '../WorkflowContext.js';

describe('WorkflowHooks', () => {
  let workflowHooks: WorkflowHooks;
  let mockWorkflow: any;
  let mockContext: WorkflowContext;
  let mockStep: any;

  beforeEach(() => {
    workflowHooks = new WorkflowHooks();
    mockWorkflow = {
      name: 'test-workflow',
      version: '1.0.0',
      steps: []
    };
    mockContext = new WorkflowContext('test-workflow', {}, {});
    mockStep = {
      id: 'test-step',
      name: 'Test Step',
      type: 'script',
      config: { command: 'echo "test"' }
    };
  });

  describe('Hook Registration', () => {
    it('should register workflow start hook', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onWorkflowStart(handler);

      expect(hookId).toBeDefined();
      expect(workflowHooks.getHookCount()).toBe(1);
    });

    it('should register workflow complete hook', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onWorkflowComplete(handler);

      expect(hookId).toBeDefined();
      expect(workflowHooks.getHookCount()).toBe(1);
    });

    it('should register workflow error hook', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onWorkflowError(handler);

      expect(hookId).toBeDefined();
      expect(workflowHooks.getHookCount()).toBe(1);
    });

    it('should register workflow cancelled hook', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onWorkflowCancelled(handler);

      expect(hookId).toBeDefined();
      expect(workflowHooks.getHookCount()).toBe(1);
    });

    it('should register step start hook', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onStepStart(handler);

      expect(hookId).toBeDefined();
      expect(workflowHooks.getHookCount()).toBe(1);
    });

    it('should register step complete hook', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onStepComplete(handler);

      expect(hookId).toBeDefined();
      expect(workflowHooks.getHookCount()).toBe(1);
    });

    it('should register step error hook', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onStepError(handler);

      expect(hookId).toBeDefined();
      expect(workflowHooks.getHookCount()).toBe(1);
    });

    it('should register step skip hook', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onStepSkip(handler);

      expect(hookId).toBeDefined();
      expect(workflowHooks.getHookCount()).toBe(1);
    });

    it('should register step retry hook', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onStepRetry(handler);

      expect(hookId).toBeDefined();
      expect(workflowHooks.getHookCount()).toBe(1);
    });

    it('should register hook with custom options', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onWorkflowStart(handler, {
        priority: 90,
        async: true,
        id: 'custom-hook-id'
      });

      expect(hookId).toBe('custom-hook-id');
    });
  });

  describe('Event Emission', () => {
    it('should emit workflow start event', async () => {
      const handler = vi.fn();
      workflowHooks.onWorkflowStart(handler);

      await workflowHooks.emitWorkflowStart(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        { enableMetrics: true }
      );

      expect(handler).toHaveBeenCalledWith({
        workflowId: 'test-workflow-id',
        workflow: mockWorkflow,
        context: mockContext,
        options: { enableMetrics: true },
        timestamp: expect.any(Number)
      });
    });

    it('should emit workflow complete event', async () => {
      const handler = vi.fn();
      workflowHooks.onWorkflowComplete(handler);

      const result = {
        success: true,
        stepResults: {},
        executionTime: 1000
      };

      await workflowHooks.emitWorkflowComplete(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        result
      );

      expect(handler).toHaveBeenCalledWith({
        workflowId: 'test-workflow-id',
        workflow: mockWorkflow,
        context: mockContext,
        result,
        timestamp: expect.any(Number)
      });
    });

    it('should emit workflow error event', async () => {
      const handler = vi.fn();
      workflowHooks.onWorkflowError(handler);

      const error = new Error('Test error');

      await workflowHooks.emitWorkflowError(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        error
      );

      expect(handler).toHaveBeenCalledWith({
        workflowId: 'test-workflow-id',
        workflow: mockWorkflow,
        context: mockContext,
        error,
        timestamp: expect.any(Number)
      });
    });

    it('should emit workflow cancelled event', async () => {
      const handler = vi.fn();
      workflowHooks.onWorkflowCancelled(handler);

      await workflowHooks.emitWorkflowCancelled(
        'test-workflow-id',
        mockWorkflow,
        mockContext
      );

      expect(handler).toHaveBeenCalledWith({
        workflowId: 'test-workflow-id',
        workflow: mockWorkflow,
        context: mockContext,
        timestamp: expect.any(Number)
      });
    });

    it('should emit step start event', async () => {
      const handler = vi.fn();
      workflowHooks.onStepStart(handler);

      await workflowHooks.emitStepStart(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep
      );

      expect(handler).toHaveBeenCalledWith({
        workflowId: 'test-workflow-id',
        workflow: mockWorkflow,
        context: mockContext,
        step: mockStep,
        timestamp: expect.any(Number)
      });
    });

    it('should emit step complete event', async () => {
      const handler = vi.fn();
      workflowHooks.onStepComplete(handler);

      const result = {
        success: true,
        output: 'test output',
        executionTime: 500
      };

      await workflowHooks.emitStepComplete(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep,
        result
      );

      expect(handler).toHaveBeenCalledWith({
        workflowId: 'test-workflow-id',
        workflow: mockWorkflow,
        context: mockContext,
        step: mockStep,
        result,
        timestamp: expect.any(Number)
      });
    });

    it('should emit step error event', async () => {
      const handler = vi.fn();
      workflowHooks.onStepError(handler);

      const error = new Error('Step error');

      await workflowHooks.emitStepError(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep,
        error,
        2
      );

      expect(handler).toHaveBeenCalledWith({
        workflowId: 'test-workflow-id',
        workflow: mockWorkflow,
        context: mockContext,
        step: mockStep,
        error,
        retryCount: 2,
        timestamp: expect.any(Number)
      });
    });

    it('should emit step skip event', async () => {
      const handler = vi.fn();
      workflowHooks.onStepSkip(handler);

      await workflowHooks.emitStepSkip(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep,
        'Dependencies failed'
      );

      expect(handler).toHaveBeenCalledWith({
        workflowId: 'test-workflow-id',
        workflow: mockWorkflow,
        context: mockContext,
        step: mockStep,
        reason: 'Dependencies failed',
        timestamp: expect.any(Number)
      });
    });

    it('should emit step retry event', async () => {
      const handler = vi.fn();
      workflowHooks.onStepRetry(handler);

      const error = new Error('Retry error');

      await workflowHooks.emitStepRetry(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep,
        error,
        2,
        3
      );

      expect(handler).toHaveBeenCalledWith({
        workflowId: 'test-workflow-id',
        workflow: mockWorkflow,
        context: mockContext,
        step: mockStep,
        error,
        retryCount: 2,
        maxRetries: 3,
        timestamp: expect.any(Number)
      });
    });
  });

  describe('Hook Management', () => {
    it('should remove hook by ID', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onWorkflowStart(handler);

      expect(workflowHooks.getHookCount()).toBe(1);

      const removed = workflowHooks.removeHook(hookId);
      expect(removed).toBe(true);
      expect(workflowHooks.getHookCount()).toBe(0);
    });

    it('should return false when removing non-existent hook', () => {
      const removed = workflowHooks.removeHook('non-existent');
      expect(removed).toBe(false);
    });

    it('should enable/disable hooks', () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onWorkflowStart(handler);

      const disabled = workflowHooks.setHookEnabled(hookId, false);
      expect(disabled).toBe(true);

      const enabled = workflowHooks.setHookEnabled(hookId, true);
      expect(enabled).toBe(true);
    });

    it('should clear all hooks', () => {
      workflowHooks.onWorkflowStart(vi.fn());
      workflowHooks.onStepComplete(vi.fn());

      expect(workflowHooks.getHookCount()).toBe(2);

      workflowHooks.clearHooks();

      expect(workflowHooks.getHookCount()).toBe(0);
    });
  });

  describe('Statistics', () => {
    it('should get hook statistics', async () => {
      const handler = vi.fn();
      const hookId = workflowHooks.onWorkflowStart(handler);

      await workflowHooks.emitWorkflowStart(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        {}
      );

      const stats = workflowHooks.getHookStats(hookId);
      expect(stats).toBeDefined();
      expect(stats!.totalCalls).toBe(1);
    });

    it('should get all hook statistics', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      workflowHooks.onWorkflowStart(handler1);
      workflowHooks.onStepComplete(handler2);

      await workflowHooks.emitWorkflowStart(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        {}
      );

      const allStats = workflowHooks.getAllHookStats();
      expect(Object.keys(allStats)).toHaveLength(2);
    });
  });

  describe('Hook System Access', () => {
    it('should provide access to underlying hook system', () => {
      const hookSystem = workflowHooks.getHookSystem();
      expect(hookSystem).toBeDefined();
      expect(typeof hookSystem.registerHook).toBe('function');
    });
  });
});