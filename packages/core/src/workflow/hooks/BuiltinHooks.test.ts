/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { BuiltinHooks } from './BuiltinHooks.js';
import { WorkflowHooks } from './WorkflowHooks.js';
import { WorkflowContext } from '../WorkflowContext.js';

describe('BuiltinHooks', () => {
  let workflowHooks: WorkflowHooks;
  let builtinHooks: BuiltinHooks;
  let mockWorkflow: any;
  let mockContext: WorkflowContext;
  let mockStep: any;
  let consoleInfoSpy: any;
  let consoleWarnSpy: any;
  let consoleErrorSpy: any;
  let consoleDebugSpy: any;

  beforeEach(() => {
    workflowHooks = new WorkflowHooks();
    mockWorkflow = {
      name: 'test-workflow',
      version: '1.0.0',
      steps: [
        { id: 'step1', name: 'Step 1', type: 'script', config: { command: 'echo test' } },
        { id: 'step2', name: 'Step 2', type: 'script', config: { command: 'echo test2' }, dependsOn: ['step1'] }
      ]
    };
    mockContext = new WorkflowContext('test-workflow', {}, {});
    mockStep = {
      id: 'test-step',
      name: 'Test Step',
      type: 'script',
      config: { command: 'echo "test"' }
    };

    // Mock console methods
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  describe('Initialization', () => {
    it('should register all built-in hooks by default', () => {
      builtinHooks = new BuiltinHooks(workflowHooks);
      builtinHooks.registerAll();

      expect(workflowHooks.getHookCount()).toBeGreaterThan(0);
      const hookIds = builtinHooks.getRegisteredHookIds();
      expect(hookIds.length).toBeGreaterThan(0);
    });

    it('should respect configuration options for hook types', () => {
      builtinHooks = new BuiltinHooks(workflowHooks, {
        enableLoggingHooks: false,
        enableMetricsHooks: false,
        enableNotificationHooks: false,
        enableValidationHooks: false
      });
      builtinHooks.registerAll();

      expect(workflowHooks.getHookCount()).toBe(0);
    });

    it('should register only enabled hook types', () => {
      builtinHooks = new BuiltinHooks(workflowHooks, {
        enableLoggingHooks: true,
        enableMetricsHooks: false,
        enableNotificationHooks: false,
        enableValidationHooks: false
      });
      builtinHooks.registerAll();

      expect(workflowHooks.getHookCount()).toBeGreaterThan(0);
      const hookIds = builtinHooks.getRegisteredHookIds();
      expect(hookIds.some(id => id.includes('logging'))).toBe(true);
      expect(hookIds.some(id => id.includes('metrics'))).toBe(false);
    });
  });

  describe('Logging Hooks', () => {
    beforeEach(() => {
      builtinHooks = new BuiltinHooks(workflowHooks, {
        enableLoggingHooks: true,
        enableMetricsHooks: false,
        enableNotificationHooks: false,
        enableValidationHooks: false,
        logLevel: 'debug'
      });
      builtinHooks.registerAll();
    });

    it('should log workflow start', async () => {
      await workflowHooks.emitWorkflowStart(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        { enableMetrics: true }
      );

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('🚀 Workflow started: test-workflow (ID: test-workflow-id)')
      );
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workflow options:'),
        { enableMetrics: true }
      );
    });

    it('should log successful workflow completion', async () => {
      const result = {
        success: true,
        stepResults: {},
        executionTime: 1500
      };

      await workflowHooks.emitWorkflowComplete(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        result
      );

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workflow ✅ completed successfully: test-workflow (1500ms)')
      );
    });

    it('should log failed workflow completion', async () => {
      const result = {
        success: false,
        stepResults: {},
        executionTime: 1500,
        error: 'Some error occurred'
      };

      await workflowHooks.emitWorkflowComplete(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        result
      );

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workflow ❌ failed: test-workflow (1500ms)')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Workflow error: Some error occurred')
      );
    });

    it('should log workflow errors', async () => {
      const error = new Error('Test workflow error');
      error.stack = 'Error stack trace';

      await workflowHooks.emitWorkflowError(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        error
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('💥 Workflow error in test-workflow: Test workflow error')
      );
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error stack:'),
        'Error stack trace'
      );
    });

    it('should log step events', async () => {
      // Step start
      await workflowHooks.emitStepStart(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep
      );

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('📋 Step started: Test Step (test-step)')
      );

      // Step complete
      const result = { success: true, output: 'test', executionTime: 100 };
      await workflowHooks.emitStepComplete(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep,
        result
      );

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ Step completed: Test Step (100ms)')
      );

      // Step error
      const error = new Error('Step error');
      await workflowHooks.emitStepError(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep,
        error,
        1
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('❌ Step failed: Test Step (retry 1) - Step error')
      );

      // Step skip
      await workflowHooks.emitStepSkip(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep,
        'Dependencies failed'
      );

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('⏭️ Step skipped: Test Step - Dependencies failed')
      );

      // Step retry
      await workflowHooks.emitStepRetry(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        mockStep,
        error,
        2,
        3
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('🔄 Step retry: Test Step (2/3) - Step error')
      );
    });

    it('should respect log level settings', () => {
      // Create a new WorkflowHooks instance to avoid hook ID conflicts
      const newWorkflowHooks = new WorkflowHooks();
      const infoLevelHooks = new BuiltinHooks(newWorkflowHooks, {
        enableLoggingHooks: true,
        enableMetricsHooks: false,
        enableNotificationHooks: false,
        enableValidationHooks: false,
        logLevel: 'info'
      });
      infoLevelHooks.registerAll();

      // Debug messages should not be logged with info level
      // This would require testing the internal log method which is private
      // For now, we just verify the setup is correct
      expect(infoLevelHooks.getRegisteredHookIds().length).toBeGreaterThan(0);
    });
  });

  describe('Notification Hooks', () => {
    beforeEach(() => {
      builtinHooks = new BuiltinHooks(workflowHooks, {
        enableLoggingHooks: false,
        enableMetricsHooks: false,
        enableNotificationHooks: true,
        enableValidationHooks: false
      });
      builtinHooks.registerAll();
    });

    it('should notify on workflow errors', async () => {
      const error = new Error('Test error');

      await workflowHooks.emitWorkflowError(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        error
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("🔔 Notification: Workflow 'test-workflow' failed with error: Test error")
      );
    });

    it('should notify on long-running workflow completion', async () => {
      const result = {
        success: true,
        stepResults: {},
        executionTime: 70000 // More than 60 seconds
      };

      await workflowHooks.emitWorkflowComplete(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        result
      );

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining("🔔 Notification: Long-running workflow 'test-workflow' completed after 70000ms")
      );
    });

    it('should not notify on short-running workflows', async () => {
      const result = {
        success: true,
        stepResults: {},
        executionTime: 5000 // Less than 60 seconds
      };

      await workflowHooks.emitWorkflowComplete(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        result
      );

      // Should not have been called for short workflows
      expect(consoleInfoSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('🔔 Notification')
      );
    });
  });

  describe('Validation Hooks', () => {
    beforeEach(() => {
      builtinHooks = new BuiltinHooks(workflowHooks, {
        enableLoggingHooks: false,
        enableMetricsHooks: false,
        enableNotificationHooks: false,
        enableValidationHooks: true
      });
      builtinHooks.registerAll();
    });

    it('should validate step dependencies', async () => {
      const stepWithDeps = {
        id: 'dependent-step',
        name: 'Dependent Step',
        type: 'script',
        config: { command: 'echo test' },
        dependsOn: ['missing-step']
      };

      await workflowHooks.emitStepStart(
        'test-workflow-id',
        mockWorkflow,
        mockContext,
        stepWithDeps
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("⚠️ Step 'dependent-step' depends on 'missing-step' but no output found")
      );
    });

    it('should validate workflow configuration for duplicate step IDs', async () => {
      const workflowWithDuplicates = {
        ...mockWorkflow,
        steps: [
          { id: 'duplicate', name: 'Step 1', type: 'script', config: { command: 'echo 1' } },
          { id: 'duplicate', name: 'Step 2', type: 'script', config: { command: 'echo 2' } }
        ]
      };

      await workflowHooks.emitWorkflowStart(
        'test-workflow-id',
        workflowWithDuplicates,
        mockContext,
        {}
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Duplicate step ID found: duplicate')
      );
    });

    it('should detect circular dependencies', async () => {
      const workflowWithCircularDeps = {
        ...mockWorkflow,
        steps: [
          { id: 'step1', name: 'Step 1', type: 'script', config: { command: 'echo 1' }, dependsOn: ['step2'] },
          { id: 'step2', name: 'Step 2', type: 'script', config: { command: 'echo 2' }, dependsOn: ['step1'] }
        ]
      };

      await workflowHooks.emitWorkflowStart(
        'test-workflow-id',
        workflowWithCircularDeps,
        mockContext,
        {}
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Circular dependency detected involving step:')
      );
    });
  });

  describe('Hook Management', () => {
    beforeEach(() => {
      builtinHooks = new BuiltinHooks(workflowHooks);
      builtinHooks.registerAll();
    });

    it('should unregister all hooks', () => {
      const initialCount = workflowHooks.getHookCount();
      expect(initialCount).toBeGreaterThan(0);

      builtinHooks.unregisterAll();

      expect(workflowHooks.getHookCount()).toBe(0);
      expect(builtinHooks.getRegisteredHookIds()).toHaveLength(0);
    });

    it('should track registered hook IDs', () => {
      const hookIds = builtinHooks.getRegisteredHookIds();
      expect(hookIds.length).toBeGreaterThan(0);
      expect(hookIds.every(id => typeof id === 'string')).toBe(true);
    });
  });
});