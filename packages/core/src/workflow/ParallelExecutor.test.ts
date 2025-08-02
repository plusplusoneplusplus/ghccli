/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParallelExecutor } from './ParallelExecutor.js';
import { WorkflowStep, StepResult, WorkflowParallelConfig } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';
import { StepExecutor } from './StepExecutor.js';

describe('ParallelExecutor', () => {
  let parallelExecutor: ParallelExecutor;
  let mockStepExecutors: Map<string, StepExecutor>;
  let mockContext: WorkflowContext;

  beforeEach(() => {
    mockStepExecutors = new Map();
    
    // Mock script executor
    const mockScriptExecutor = {
      execute: vi.fn().mockImplementation(async (step) => {
        // Simulate different execution times
        const delay = step.id.includes('slow') ? 100 : 10;
        await new Promise(resolve => setTimeout(resolve, delay));
        return `Output from ${step.id}`;
      }),
      validate: vi.fn().mockReturnValue({ valid: true, errors: [] }),
      getSupportedType: vi.fn().mockReturnValue('script'),
      canExecute: vi.fn().mockReturnValue(true)
    };

    mockStepExecutors.set('script', mockScriptExecutor as any);
    
    parallelExecutor = new ParallelExecutor(mockStepExecutors);
    mockContext = new WorkflowContext('test-workflow', {}, {});
  });

  describe('executeParallelGroups', () => {
    it('should execute single group with multiple steps in parallel', async () => {
      const groups = [{
        id: 0,
        steps: [
          createMockStep('step1', 'script'),
          createMockStep('step2', 'script'),
          createMockStep('step3', 'script')
        ],
        maxConcurrency: 3
      }];

      const startTime = Date.now();
      const results = await parallelExecutor.executeParallelGroups(
        groups,
        mockContext
      );

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      expect(Object.keys(results)).toHaveLength(3);
      expect(results.step1.success).toBe(true);
      expect(results.step2.success).toBe(true);
      expect(results.step3.success).toBe(true);
      expect(results.step1.parallelGroup).toBe(0);
      expect(results.step2.parallelGroup).toBe(0);
      expect(results.step3.parallelGroup).toBe(0);

      // Should execute in parallel (faster than sequential)
      expect(executionTime).toBeLessThan(100); // Less than 3 * 10ms if truly parallel
    });

    it('should respect concurrency limits', async () => {
      const groups = [{
        id: 0,
        steps: [
          createMockStep('step1', 'script'),
          createMockStep('step2', 'script'),
          createMockStep('step3', 'script'),
          createMockStep('step4', 'script')
        ],
        maxConcurrency: 2 // Limit to 2 concurrent executions
      }];

      const executionOrder: string[] = [];
      const mockExecutor = mockStepExecutors.get('script')!;
      (mockExecutor.execute as any).mockImplementation(async (step: WorkflowStep) => {
        executionOrder.push(`${step.id}-start`);
        await new Promise(resolve => setTimeout(resolve, 50));
        executionOrder.push(`${step.id}-end`);
        return `Output from ${step.id}`;
      });

      const results = await parallelExecutor.executeParallelGroups(
        groups,
        mockContext
      );

      expect(Object.keys(results)).toHaveLength(4);
      expect(results.step1.success).toBe(true);
      expect(results.step2.success).toBe(true);
      expect(results.step3.success).toBe(true);
      expect(results.step4.success).toBe(true);

      // Check that no more than 2 steps were running concurrently
      let concurrentSteps = 0;
      let maxConcurrent = 0;
      
      for (const event of executionOrder) {
        if (event.endsWith('-start')) {
          concurrentSteps++;
          maxConcurrent = Math.max(maxConcurrent, concurrentSteps);
        } else if (event.endsWith('-end')) {
          concurrentSteps--;
        }
      }
      
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should handle resource constraints', async () => {
      const workflowConfig: WorkflowParallelConfig = {
        enabled: true,
        resources: {
          'cpu': 2,
          'memory': 1
        }
      };

      const groups = [{
        id: 0,
        steps: [
          createMockStep('cpu1', 'script', 'cpu'),
          createMockStep('cpu2', 'script', 'cpu'),
          createMockStep('cpu3', 'script', 'cpu'), // Should wait
          createMockStep('mem1', 'script', 'memory'),
          createMockStep('mem2', 'script', 'memory') // Should wait
        ],
        maxConcurrency: 10,
        resource: undefined
      }];

      const results = await parallelExecutor.executeParallelGroups(
        groups,
        mockContext,
        workflowConfig
      );

      expect(Object.keys(results)).toHaveLength(5);
      expect(results.cpu1.success).toBe(true);
      expect(results.cpu2.success).toBe(true);
      expect(results.cpu3.success).toBe(true);
      expect(results.mem1.success).toBe(true);
      expect(results.mem2.success).toBe(true);
    });

    it('should handle step failures with error isolation', async () => {
      const mockExecutor = mockStepExecutors.get('script')!;
      (mockExecutor.execute as any).mockImplementation(async (step: WorkflowStep) => {
        if (step.id === 'failing-step') {
          throw new Error('Step failed');
        }
        return `Output from ${step.id}`;
      });

      const groups = [{
        id: 0,
        steps: [
          createMockStep('success-step', 'script'),
          {
            ...createMockStep('failing-step', 'script'),
            parallel: { enabled: true, isolateErrors: true },
            continueOnError: true
          },
          createMockStep('another-success', 'script')
        ],
        maxConcurrency: 3
      }];

      const results = await parallelExecutor.executeParallelGroups(
        groups,
        mockContext
      );

      expect(results['success-step'].success).toBe(true);
      expect(results['failing-step'].success).toBe(false);
      expect(results['failing-step'].error).toContain('Step failed');
      expect(results['another-success'].success).toBe(true);
    });

    it('should execute multiple groups sequentially', async () => {
      const groups = [
        {
          id: 0,
          steps: [createMockStep('group1-step1', 'script'), createMockStep('group1-step2', 'script')],
          maxConcurrency: 2
        },
        {
          id: 1,
          steps: [createMockStep('group2-step1', 'script'), createMockStep('group2-step2', 'script')],
          maxConcurrency: 2
        }
      ];

      const executionOrder: string[] = [];
      const mockExecutor = mockStepExecutors.get('script')!;
      (mockExecutor.execute as any).mockImplementation(async (step: WorkflowStep) => {
        executionOrder.push(step.id);
        await new Promise(resolve => setTimeout(resolve, 10));
        return `Output from ${step.id}`;
      });

      const results = await parallelExecutor.executeParallelGroups(
        groups,
        mockContext
      );

      expect(Object.keys(results)).toHaveLength(4);
      
      // Group 1 steps should execute before group 2 steps
      const group1EndIndex = Math.max(
        executionOrder.indexOf('group1-step1'),
        executionOrder.indexOf('group1-step2')
      );
      const group2StartIndex = Math.min(
        executionOrder.indexOf('group2-step1'),
        executionOrder.indexOf('group2-step2')
      );
      
      expect(group1EndIndex).toBeLessThan(group2StartIndex);
      
      // Verify parallel group assignments
      expect(results['group1-step1'].parallelGroup).toBe(0);
      expect(results['group1-step2'].parallelGroup).toBe(0);
      expect(results['group2-step1'].parallelGroup).toBe(1);
      expect(results['group2-step2'].parallelGroup).toBe(1);
    });

    it('should handle cancellation', async () => {
      const groups = [{
        id: 0,
        steps: [
          createMockStep('long-step1', 'script'),
          createMockStep('long-step2', 'script')
        ],
        maxConcurrency: 2
      }];

      let cancelled = false;
      const shouldCancel = () => cancelled;

      // Mock long-running execution
      const mockExecutor = mockStepExecutors.get('script')!;
      (mockExecutor.execute as any).mockImplementation(async (step: WorkflowStep) => {
        for (let i = 0; i < 100; i++) {
          if (shouldCancel()) {
            throw new Error('Execution cancelled');
          }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        return `Output from ${step.id}`;
      });

      const executionPromise = parallelExecutor.executeParallelGroups(
        groups,
        mockContext,
        undefined,
        undefined,
        undefined,
        undefined,
        shouldCancel
      );

      // Cancel after short delay
      setTimeout(() => {
        cancelled = true;
      }, 50);

      await expect(executionPromise).rejects.toThrow('Execution cancelled');
    });

    it('should provide execution statistics', async () => {
      const workflowConfig: WorkflowParallelConfig = {
        enabled: true,
        resources: {
          'cpu': 2,
          'memory': 1
        }
      };

      const groups = [{
        id: 0,
        steps: [
          createMockStep('cpu-step', 'script', 'cpu'),
          createMockStep('mem-step', 'script', 'memory'),
          createMockStep('free-step', 'script')
        ],
        maxConcurrency: 3
      }];

      await parallelExecutor.executeParallelGroups(
        groups,
        mockContext,
        workflowConfig
      );

      const stats = parallelExecutor.getParallelStats();
      expect(stats.totalGroups).toBe(1);
      expect(stats.maxConcurrentSteps).toBeGreaterThanOrEqual(0);
      expect(stats.resourceUtilization).toBeDefined();
      expect(stats.resourceUtilization!.cpu).toBeGreaterThanOrEqual(0);
      expect(stats.resourceUtilization!.memory).toBeGreaterThanOrEqual(0);
    });

    it('should track execution times for steps', async () => {
      const groups = [{
        id: 0,
        steps: [
          createMockStep('fast-step', 'script'),
          createMockStep('slow-step', 'script')
        ],
        maxConcurrency: 2
      }];

      const results = await parallelExecutor.executeParallelGroups(
        groups,
        mockContext
      );

      expect(results['fast-step'].executionTime).toBeDefined();
      expect(results['slow-step'].executionTime).toBeDefined();
      expect(results['fast-step'].executionTime).toBeGreaterThan(0);
      expect(results['slow-step'].executionTime).toBeGreaterThan(0);
      
      // Slow step should take longer than fast step
      expect(results['slow-step'].executionTime!).toBeGreaterThan(
        results['fast-step'].executionTime!
      );
    });

    it('should handle condition evaluation', async () => {
      const groups = [{
        id: 0,
        steps: [
          createMockStep('always-run', 'script'),
          {
            ...createMockStep('conditional-step', 'script'),
            condition: 'false' // Condition that evaluates to false should be skipped
          },
          {
            ...createMockStep('another-conditional', 'script'),
            condition: 'true' // Non-empty condition should run
          }
        ],
        maxConcurrency: 3
      }];

      const results = await parallelExecutor.executeParallelGroups(
        groups,
        mockContext
      );

      expect(results['always-run'].success).toBe(true);
      expect(results['conditional-step'].success).toBe(true);
      expect(results['conditional-step'].output).toBe(null);
      expect(results['conditional-step'].error).toBe('Skipped due to condition');
      expect(results['another-conditional'].success).toBe(true);
      expect(results['another-conditional'].output).toBe('Output from another-conditional');
    });
  });

  describe('resource management', () => {
    it('should track resource utilization', async () => {
      const workflowConfig: WorkflowParallelConfig = {
        enabled: true,
        resources: {
          'cpu': 3,
          'memory': 2
        }
      };

      const groups = [{
        id: 0,
        steps: [
          createMockStep('cpu1', 'script', 'cpu'),
          createMockStep('cpu2', 'script', 'cpu'),
          createMockStep('mem1', 'script', 'memory')
        ],
        maxConcurrency: 5
      }];

      await parallelExecutor.executeParallelGroups(
        groups,
        mockContext,
        workflowConfig
      );

      const resourceUtilization = parallelExecutor.getResourceUtilization();
      expect(resourceUtilization.cpu).toBeDefined();
      expect(resourceUtilization.memory).toBeDefined();
      expect(resourceUtilization.cpu).toBeGreaterThanOrEqual(0);
      expect(resourceUtilization.memory).toBeGreaterThanOrEqual(0);
    });
  });
});

function createMockStep(id: string, type: string, resource?: string): WorkflowStep {
  return {
    id,
    name: `Step ${id}`,
    type: type as 'script' | 'agent',
    config: {
      command: 'echo',
      args: [id]
    },
    parallel: {
      enabled: true,
      resource
    }
  };
}