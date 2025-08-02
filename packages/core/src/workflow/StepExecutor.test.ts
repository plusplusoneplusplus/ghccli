/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { StepExecutor } from './StepExecutor.js';
import { WorkflowStep } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';

// Mock implementation for testing
class MockStepExecutor extends StepExecutor {
  private shouldFail: boolean = false;
  
  constructor(shouldFail: boolean = false) {
    super();
    this.shouldFail = shouldFail;
  }

  getSupportedType(): string {
    return 'mock';
  }

  validate(step: WorkflowStep): { valid: boolean; errors: string[] } {
    return { valid: true, errors: [] };
  }

  async execute(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    if (this.shouldFail) {
      throw new Error('Mock execution failed');
    }
    return { stepId: step.id, success: true };
  }
}

// Test implementation with hooks
class HookedStepExecutor extends MockStepExecutor {
  private hooks: {
    beforeExecute: Mock;
    afterExecute: Mock;
    onError: Mock;
  };

  constructor(shouldFail: boolean = false) {
    super(shouldFail);
    this.hooks = {
      beforeExecute: vi.fn(),
      afterExecute: vi.fn(),
      onError: vi.fn()
    };
  }

  getHooks() {
    return this.hooks;
  }

  protected async beforeExecute(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    this.hooks.beforeExecute(step, context);
  }

  protected async afterExecute(step: WorkflowStep, context: WorkflowContext, result: unknown): Promise<void> {
    this.hooks.afterExecute(step, context, result);
  }

  protected async onError(step: WorkflowStep, context: WorkflowContext, error: Error): Promise<void> {
    this.hooks.onError(step, context, error);
  }
}

describe('StepExecutor', () => {
  let executor: MockStepExecutor;
  let context: WorkflowContext;
  let step: WorkflowStep;

  beforeEach(() => {
    executor = new MockStepExecutor();
    context = new WorkflowContext('test-workflow');
    step = {
      id: 'test-step',
      name: 'Test Step',
      type: 'mock' as any, // Cast to allow mock type in tests
      config: { command: 'test' }
    };
  });

  describe('abstract methods', () => {
    it('should provide supported type', () => {
      expect(executor.getSupportedType()).toBe('mock');
    });

    it('should validate step configuration', () => {
      const result = executor.validate(step);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('canExecute', () => {
    it('should return true for supported step type', () => {
      expect(executor.canExecute(step)).toBe(true);
    });

    it('should return false for unsupported step type', () => {
      const unsupportedStep = { ...step, type: 'unsupported' as any };
      expect(executor.canExecute(unsupportedStep)).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute step successfully', async () => {
      const result = await executor.execute(step, context);
      
      expect(result).toEqual({
        stepId: 'test-step',
        success: true
      });
    });

    it('should handle execution errors', async () => {
      const failingExecutor = new MockStepExecutor(true);
      
      await expect(failingExecutor.execute(step, context))
        .rejects.toThrow('Mock execution failed');
    });
  });

  describe('executeWithHooks', () => {
    let hookedExecutor: HookedStepExecutor;

    beforeEach(() => {
      hookedExecutor = new HookedStepExecutor();
    });

    it('should call hooks in correct order for successful execution', async () => {
      const result = await hookedExecutor.executeWithHooks(step, context);
      const hooks = hookedExecutor.getHooks();
      
      expect(hooks.beforeExecute).toHaveBeenCalledWith(step, context);
      expect(hooks.afterExecute).toHaveBeenCalledWith(step, context, result);
      expect(hooks.onError).not.toHaveBeenCalled();
      
      // Check call order
      expect(hooks.beforeExecute).toHaveBeenCalledBefore(hooks.afterExecute);
    });

    it('should call error hook on execution failure', async () => {
      const failingExecutor = new HookedStepExecutor(true);
      const hooks = failingExecutor.getHooks();
      
      await expect(failingExecutor.executeWithHooks(step, context))
        .rejects.toThrow('Mock execution failed');
      
      expect(hooks.beforeExecute).toHaveBeenCalledWith(step, context);
      expect(hooks.onError).toHaveBeenCalledWith(
        step, 
        context, 
        expect.any(Error)
      );
      expect(hooks.afterExecute).not.toHaveBeenCalled();
    });

    it('should handle hook errors gracefully', async () => {
      // Create a new executor that will fail in beforeExecute
      const failingHookedExecutor = new (class extends HookedStepExecutor {
        protected async beforeExecute(step: WorkflowStep, context: WorkflowContext): Promise<void> {
          await super.beforeExecute(step, context);
          throw new Error('Before hook failed');
        }
      })();

      const hooks = failingHookedExecutor.getHooks();
      
      await expect(failingHookedExecutor.executeWithHooks(step, context))
        .rejects.toThrow('Before hook failed');
      
      expect(hooks.onError).toHaveBeenCalledWith(
        step,
        context,
        expect.objectContaining({ message: 'Before hook failed' })
      );
    });

    it('should convert non-Error objects to Error in hooks', async () => {
      const executor = new (class extends StepExecutor {
        getSupportedType() { return 'test'; }
        validate() { return { valid: true, errors: [] }; }
        async execute() { throw 'String error'; }
      })();
      
      const onErrorSpy = vi.fn();
      executor['onError'] = onErrorSpy;
      
      await expect(executor.executeWithHooks(step, context))
        .rejects.toThrow('String error');
      
      expect(onErrorSpy).toHaveBeenCalledWith(
        step,
        context,
        expect.objectContaining({ message: 'String error' })
      );
    });
  });

  describe('default hook implementations', () => {
    it('should have no-op default hook implementations', async () => {
      // This test ensures the default implementations don't throw
      await expect(executor['beforeExecute'](step, context)).resolves.toBeUndefined();
      await expect(executor['afterExecute'](step, context, {})).resolves.toBeUndefined();
      await expect(executor['onError'](step, context, new Error())).resolves.toBeUndefined();
    });
  });
});