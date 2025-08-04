/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookSystem, WorkflowEvent, type EventData } from './HookSystem.js';

describe('HookSystem', () => {
  let hookSystem: HookSystem;
  let mockEventData: EventData;

  beforeEach(() => {
    hookSystem = new HookSystem();
    mockEventData = {
      workflowId: 'test-workflow-1',
      workflow: {
        name: 'test-workflow',
        version: '1.0.0',
        steps: []
      },
      context: {} as any,
      timestamp: Date.now()
    } as any;
  });

  describe('Hook Registration', () => {
    it('should register a sync hook successfully', () => {
      const handler = vi.fn();
      
      hookSystem.registerHook('test-hook', WorkflowEvent.WORKFLOW_START, handler);
      
      const hooks = hookSystem.getHooksForEvent(WorkflowEvent.WORKFLOW_START);
      expect(hooks).toHaveLength(1);
      expect(hooks[0].id).toBe('test-hook');
      expect(hooks[0].handler).toBe(handler);
      expect(hooks[0].async).toBe(false);
    });

    it('should register an async hook successfully', () => {
      const handler = vi.fn();
      
      hookSystem.registerHook('test-hook', WorkflowEvent.WORKFLOW_START, handler, { async: true });
      
      const hooks = hookSystem.getHooksForEvent(WorkflowEvent.WORKFLOW_START);
      expect(hooks[0].async).toBe(true);
    });

    it('should sort hooks by priority (higher first)', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      hookSystem.registerHook('low-priority', WorkflowEvent.WORKFLOW_START, handler1, { priority: 10 });
      hookSystem.registerHook('high-priority', WorkflowEvent.WORKFLOW_START, handler2, { priority: 90 });
      hookSystem.registerHook('medium-priority', WorkflowEvent.WORKFLOW_START, handler3, { priority: 50 });

      const hooks = hookSystem.getHooksForEvent(WorkflowEvent.WORKFLOW_START);
      expect(hooks[0].id).toBe('high-priority');
      expect(hooks[1].id).toBe('medium-priority');
      expect(hooks[2].id).toBe('low-priority');
    });

    it('should throw error when registering duplicate hook IDs', () => {
      const handler = vi.fn();
      
      hookSystem.registerHook('duplicate-id', WorkflowEvent.WORKFLOW_START, handler);
      
      expect(() => {
        hookSystem.registerHook('duplicate-id', WorkflowEvent.WORKFLOW_COMPLETE, handler);
      }).toThrow("Hook with ID 'duplicate-id' already exists");
    });

    it('should throw error when exceeding maximum hooks limit', () => {
      const smallHookSystem = new HookSystem({ maxHooks: 2 });
      const handler = vi.fn();

      smallHookSystem.registerHook('hook1', WorkflowEvent.WORKFLOW_START, handler);
      smallHookSystem.registerHook('hook2', WorkflowEvent.WORKFLOW_START, handler);

      expect(() => {
        smallHookSystem.registerHook('hook3', WorkflowEvent.WORKFLOW_START, handler);
      }).toThrow('Maximum number of hooks (2) exceeded');
    });
  });

  describe('Hook Unregistration', () => {
    it('should unregister a hook successfully', () => {
      const handler = vi.fn();
      hookSystem.registerHook('test-hook', WorkflowEvent.WORKFLOW_START, handler);
      
      const unregistered = hookSystem.unregisterHook('test-hook');
      
      expect(unregistered).toBe(true);
      expect(hookSystem.getHooksForEvent(WorkflowEvent.WORKFLOW_START)).toHaveLength(0);
    });

    it('should return false when unregistering non-existent hook', () => {
      const unregistered = hookSystem.unregisterHook('non-existent');
      expect(unregistered).toBe(false);
    });
  });

  describe('Hook Enable/Disable', () => {
    it('should enable/disable hooks', () => {
      const handler = vi.fn();
      hookSystem.registerHook('test-hook', WorkflowEvent.WORKFLOW_START, handler);
      
      // Initially enabled
      expect(hookSystem.getHooksForEvent(WorkflowEvent.WORKFLOW_START)).toHaveLength(1);
      
      // Disable
      hookSystem.setHookEnabled('test-hook', false);
      expect(hookSystem.getHooksForEvent(WorkflowEvent.WORKFLOW_START)).toHaveLength(0);
      
      // Re-enable
      hookSystem.setHookEnabled('test-hook', true);
      expect(hookSystem.getHooksForEvent(WorkflowEvent.WORKFLOW_START)).toHaveLength(1);
    });

    it('should return false when enabling/disabling non-existent hook', () => {
      const result = hookSystem.setHookEnabled('non-existent', false);
      expect(result).toBe(false);
    });
  });

  describe('Hook Execution', () => {
    it('should execute sync hooks in priority order', async () => {
      const executionOrder: string[] = [];
      
      const handler1 = vi.fn(() => { executionOrder.push('low'); });
      const handler2 = vi.fn(() => { executionOrder.push('high'); });
      const handler3 = vi.fn(() => { executionOrder.push('medium'); });

      hookSystem.registerHook('low', WorkflowEvent.WORKFLOW_START, handler1, { priority: 10 });
      hookSystem.registerHook('high', WorkflowEvent.WORKFLOW_START, handler2, { priority: 90 });
      hookSystem.registerHook('medium', WorkflowEvent.WORKFLOW_START, handler3, { priority: 50 });

      await hookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData);

      expect(executionOrder).toEqual(['high', 'medium', 'low']);
      expect(handler1).toHaveBeenCalledWith(mockEventData);
      expect(handler2).toHaveBeenCalledWith(mockEventData);
      expect(handler3).toHaveBeenCalledWith(mockEventData);
    });

    it('should execute async hooks in parallel after sync hooks', async () => {
      const executionOrder: string[] = [];
      let resolve1: () => void;
      let resolve2: () => void;

      const syncHandler = vi.fn(() => { executionOrder.push('sync'); });
      const asyncHandler1 = vi.fn(() => {
        executionOrder.push('async1-start');
        return new Promise<void>((resolve) => { resolve1 = resolve; });
      });
      const asyncHandler2 = vi.fn(() => {
        executionOrder.push('async2-start');
        return new Promise<void>((resolve) => { resolve2 = resolve; });
      });

      hookSystem.registerHook('sync', WorkflowEvent.WORKFLOW_START, syncHandler, { priority: 100 });
      hookSystem.registerHook('async1', WorkflowEvent.WORKFLOW_START, asyncHandler1, { priority: 90, async: true });
      hookSystem.registerHook('async2', WorkflowEvent.WORKFLOW_START, asyncHandler2, { priority: 80, async: true });

      const executePromise = hookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData);

      // Wait a bit to ensure sync hook has executed
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(executionOrder).toEqual(['sync', 'async1-start', 'async2-start']);

      // Resolve async hooks
      resolve1!();
      resolve2!();
      
      await executePromise;
    });

    it('should handle hook execution errors with error handling enabled', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const workingHandler = vi.fn();
      const errorHandler = vi.fn(() => {
        throw new Error('Hook error');
      });

      hookSystem.registerHook('working', WorkflowEvent.WORKFLOW_START, workingHandler);
      hookSystem.registerHook('error', WorkflowEvent.WORKFLOW_START, errorHandler);

      await hookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData);

      expect(workingHandler).toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith("Hook 'error' failed:", expect.any(Error));
      
      consoleWarnSpy.mockRestore();
    });

    it('should throw error when error handling is disabled', async () => {
      const errorHookSystem = new HookSystem({ enableErrorHandling: false });
      const errorHandler = vi.fn(() => {
        throw new Error('Hook error');
      });

      errorHookSystem.registerHook('error', WorkflowEvent.WORKFLOW_START, errorHandler);

      await expect(errorHookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData))
        .rejects.toThrow('Hook error');
    });

    it('should handle hook timeout', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const timeoutHookSystem = new HookSystem({ maxExecutionTime: 100 });
      
      const slowHandler = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      });

      timeoutHookSystem.registerHook('slow', WorkflowEvent.WORKFLOW_START, slowHandler, { async: true });

      await timeoutHookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData);

      expect(consoleWarnSpy).toHaveBeenCalledWith("Hook 'slow' failed:", expect.any(Error));
      
      consoleWarnSpy.mockRestore();
    });

    it('should not execute hooks when no hooks are registered', async () => {
      // Should not throw and complete quickly
      await hookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData);
      expect(true).toBe(true); // Test passes if no error thrown
    });
  });

  describe('Hook Statistics', () => {
    it('should track hook execution statistics', async () => {
      const handler = vi.fn(() => {
        // Add small delay to ensure measurable execution time
        const start = Date.now();
        while (Date.now() - start < 1) {
          // Small busy wait
        }
      });
      hookSystem.registerHook('test-hook', WorkflowEvent.WORKFLOW_START, handler);

      await hookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData);
      await hookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData);

      const stats = hookSystem.getHookStats('test-hook');
      expect(stats).toBeDefined();
      expect(stats!.totalCalls).toBe(2);
      expect(stats!.errors).toBe(0);
      expect(stats!.totalTime).toBeGreaterThanOrEqual(0);
      expect(stats!.avgTime).toBeGreaterThanOrEqual(0);
    });

    it('should track hook errors in statistics', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorHandler = vi.fn(() => {
        throw new Error('Test error');
      });

      hookSystem.registerHook('error-hook', WorkflowEvent.WORKFLOW_START, errorHandler);

      await hookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData);

      const stats = hookSystem.getHookStats('error-hook');
      expect(stats!.errors).toBe(1);
      
      consoleWarnSpy.mockRestore();
    });

    it('should return undefined for non-existent hook stats', () => {
      const stats = hookSystem.getHookStats('non-existent');
      expect(stats).toBeUndefined();
    });

    it('should return all hook statistics', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      hookSystem.registerHook('hook1', WorkflowEvent.WORKFLOW_START, handler1);
      hookSystem.registerHook('hook2', WorkflowEvent.WORKFLOW_COMPLETE, handler2);

      await hookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, mockEventData);

      const allStats = hookSystem.getAllStats();
      expect(Object.keys(allStats)).toHaveLength(2);
      expect(allStats['hook1'].totalCalls).toBe(1);
      expect(allStats['hook2'].totalCalls).toBe(0);
    });
  });

  describe('Utility Methods', () => {
    it('should return correct hook count', () => {
      expect(hookSystem.getHookCount()).toBe(0);

      hookSystem.registerHook('hook1', WorkflowEvent.WORKFLOW_START, vi.fn());
      hookSystem.registerHook('hook2', WorkflowEvent.WORKFLOW_COMPLETE, vi.fn());

      expect(hookSystem.getHookCount()).toBe(2);
    });

    it('should clear all hooks', () => {
      hookSystem.registerHook('hook1', WorkflowEvent.WORKFLOW_START, vi.fn());
      hookSystem.registerHook('hook2', WorkflowEvent.WORKFLOW_COMPLETE, vi.fn());

      expect(hookSystem.getHookCount()).toBe(2);

      hookSystem.clear();

      expect(hookSystem.getHookCount()).toBe(0);
      expect(hookSystem.getAllStats()).toEqual({});
    });

    it('should return all hooks', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      hookSystem.registerHook('hook1', WorkflowEvent.WORKFLOW_START, handler1);
      hookSystem.registerHook('hook2', WorkflowEvent.WORKFLOW_COMPLETE, handler2);

      const allHooks = hookSystem.getAllHooks();
      expect(allHooks).toHaveLength(2);
      expect(allHooks.map(h => h.id)).toContain('hook1');
      expect(allHooks.map(h => h.id)).toContain('hook2');
    });
  });
});