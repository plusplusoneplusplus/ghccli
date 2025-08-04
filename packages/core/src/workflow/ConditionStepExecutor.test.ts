/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConditionStepExecutor } from './ConditionStepExecutor.js';
import { WorkflowStep, ConditionConfig, ConditionOperator, BooleanExpression } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';

describe('ConditionStepExecutor', () => {
  let executor: ConditionStepExecutor;
  let context: WorkflowContext;

  beforeEach(() => {
    executor = new ConditionStepExecutor();
    context = new WorkflowContext('test-workflow', {
      status: 'success',
      count: 5,
      enableFeature: true
    });
    
    // Add some step outputs
    context.setStepOutput('previous-step', { result: 'completed', exitCode: 0 });
    context.setStepOutput('failed-step', { result: 'failed', exitCode: 1 });
  });

  describe('Basic Properties', () => {
    it('should return correct supported type', () => {
      expect(executor.getSupportedType()).toBe('condition');
    });

    it('should implement canExecute method correctly', () => {
      const conditionStep: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'success' },
          onTrue: ['step1']
        }
      };

      const scriptStep: WorkflowStep = {
        id: 'test-script',
        name: 'Test Script',
        type: 'script',
        config: { command: 'echo test' }
      };

      expect(executor.canExecute(conditionStep)).toBe(true);
      expect(executor.canExecute(scriptStep)).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should validate a correct condition step', () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'success' },
          onTrue: ['step1', 'step2'],
          onFalse: ['step3']
        }
      };

      const validation = executor.validate(step);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject steps with wrong type', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'script',
        config: { command: 'echo test' }
      };

      const validation = executor.validate(step);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Invalid step type: expected 'condition', got 'script'");
    });

    it('should reject steps without expression', () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {} as ConditionConfig
      };

      const validation = executor.validate(step);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Condition step must have an expression');
    });

    it('should validate onTrue and onFalse arrays', () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'success' },
          onTrue: 'invalid' as any,
          onFalse: [123, 'valid'] as any
        }
      };

      const validation = executor.validate(step);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('onTrue must be an array of step IDs');
      expect(validation.errors).toContain('All step IDs in onFalse must be strings');
    });

    it('should warn when neither onTrue nor onFalse is specified', () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'success' }
        }
      };

      const validation = executor.validate(step);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Condition step should specify either onTrue or onFalse (or both)');
    });

    it('should validate boolean expressions', () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: {
            type: 'and',
            conditions: [
              { type: 'equals', left: '{{status}}', right: 'success' },
              { type: 'invalid' as any, left: '{{count}}' }
            ]
          },
          onTrue: ['step1']
        }
      };

      const validation = executor.validate(step);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(err => err.includes('Unknown expression type'))).toBe(true);
    });
  });

  describe('Execution - Simple Conditions', () => {
    it('should execute condition that evaluates to true', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'success' },
          onTrue: ['step1', 'step2'],
          onFalse: ['step3']
        }
      };

      const result = await executor.execute(step, context);
      
      expect(result.conditionResult).toBe(true);
      expect(result.triggeredSteps).toEqual(['step1', 'step2']);
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.evaluationError).toBeUndefined();
    });

    it('should execute condition that evaluates to false', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'failed' },
          onTrue: ['step1', 'step2'],
          onFalse: ['step3']
        }
      };

      const result = await executor.execute(step, context);
      
      expect(result.conditionResult).toBe(false);
      expect(result.triggeredSteps).toEqual(['step3']);
    });

    it('should handle condition with only onTrue', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'failed' },
          onTrue: ['step1']
        }
      };

      const result = await executor.execute(step, context);
      
      expect(result.conditionResult).toBe(false);
      expect(result.triggeredSteps).toEqual([]);
    });

    it('should set context variables with condition results', async () => {
      const step: WorkflowStep = {
        id: 'my-condition',
        name: 'My Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'success' },
          onTrue: ['step1']
        }
      };

      await executor.execute(step, context);
      
      expect(context.getVariable('condition_my-condition_result')).toBe(true);
      expect(context.getVariable('condition_my-condition_triggered_steps')).toEqual(['step1']);
    });
  });

  describe('Execution - Complex Boolean Expressions', () => {
    it('should execute AND expressions correctly', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: {
            type: 'and',
            conditions: [
              { type: 'equals', left: '{{status}}', right: 'success' },
              { type: 'greater_than', left: '{{count}}', right: 3 }
            ]
          },
          onTrue: ['step1'],
          onFalse: ['step2']
        }
      };

      const result = await executor.execute(step, context);
      expect(result.conditionResult).toBe(true);
      expect(result.triggeredSteps).toEqual(['step1']);
    });

    it('should execute OR expressions correctly', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: {
            type: 'or',
            conditions: [
              { type: 'equals', left: '{{status}}', right: 'failed' },
              { type: 'greater_than', left: '{{count}}', right: 3 }
            ]
          },
          onTrue: ['step1'],
          onFalse: ['step2']
        }
      };

      const result = await executor.execute(step, context);
      expect(result.conditionResult).toBe(true);
      expect(result.triggeredSteps).toEqual(['step1']);
    });

    it('should execute NOT expressions correctly', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: {
            type: 'not',
            conditions: [
              { type: 'equals', left: '{{status}}', right: 'failed' }
            ]
          },
          onTrue: ['step1'],
          onFalse: ['step2']
        }
      };

      const result = await executor.execute(step, context);
      expect(result.conditionResult).toBe(true);
      expect(result.triggeredSteps).toEqual(['step1']);
    });
  });

  describe('Execution - Step Output References', () => {
    it('should reference step outputs correctly', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{steps.previous-step.result}}', right: 'completed' },
          onTrue: ['next-step']
        }
      };

      const result = await executor.execute(step, context);
      expect(result.conditionResult).toBe(true);
      expect(result.triggeredSteps).toEqual(['next-step']);
    });

    it('should handle numeric step output comparisons', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{steps.previous-step.exitCode}}', right: 0 },
          onTrue: ['success-step'],
          onFalse: ['error-step']
        }
      };

      const result = await executor.execute(step, context);
      expect(result.conditionResult).toBe(true);
      expect(result.triggeredSteps).toEqual(['success-step']);
    });
  });

  describe('Error Handling', () => {
    it('should throw error on evaluation failure by default', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'greater_than', left: '{{status}}', right: 5 }, // Invalid comparison
          onTrue: ['step1']
        }
      };

      await expect(executor.execute(step, context)).rejects.toThrow('Condition execution failed');
    });

    it('should continue on error when continueOnError is true', async () => {
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'greater_than', left: '{{status}}', right: 5 }, // Invalid comparison
          onTrue: ['step1'],
          onFalse: ['step2'],
          continueOnError: true
        }
      };

      const result = await executor.execute(step, context);
      expect(result.conditionResult).toBe(false);
      expect(result.triggeredSteps).toEqual(['step2']);
      expect(result.evaluationError).toBeDefined();
    });
  });

  describe('Hooks', () => {
    it('should call beforeExecute hook', async () => {
      const logSpy = vi.spyOn(context, 'log');
      
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'success' },
          onTrue: ['step1']
        }
      };

      await executor.executeWithHooks(step, context);
      
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Evaluating condition')
      );
    });

    it('should call afterExecute hook', async () => {
      const logSpy = vi.spyOn(context, 'log');
      
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'equals', left: '{{status}}', right: 'success' },
          onTrue: ['step1']
        }
      };

      await executor.executeWithHooks(step, context);
      
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Condition evaluated to: true')
      );
    });

    it('should call onError hook when execution fails', async () => {
      const logSpy = vi.spyOn(context, 'log');
      
      const step: WorkflowStep = {
        id: 'test-condition',
        name: 'Test Condition',
        type: 'condition',
        config: {
          expression: { type: 'greater_than', left: '{{status}}', right: 5 }, // Invalid comparison
          onTrue: ['step1']
        }
      };

      await expect(executor.executeWithHooks(step, context)).rejects.toThrow();
      
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Condition step test-condition failed'),
        'error'
      );
    });
  });
});