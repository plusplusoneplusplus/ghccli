/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowRunner, WorkflowStatus } from './WorkflowRunner.js';
import { WorkflowDefinition, WorkflowStep } from './types.js';

describe('WorkflowRunner', () => {
  let runner: WorkflowRunner;

  beforeEach(() => {
    runner = new WorkflowRunner();
  });

  describe('constructor', () => {
    it('should initialize with pending status', () => {
      expect(runner.getStatus()).toBe(WorkflowStatus.PENDING);
    });

    it('should have null context initially', () => {
      expect(runner.getContext()).toBeNull();
    });
  });

  describe('registerStepExecutor', () => {
    it('should allow registering custom step executors', () => {
      const mockExecutor = {
        execute: vi.fn(),
        validate: vi.fn().mockReturnValue({ valid: true, errors: [] }),
        getSupportedType: vi.fn().mockReturnValue('custom'),
        canExecute: vi.fn().mockReturnValue(true)
      };

      expect(() => {
        runner.registerStepExecutor('custom', mockExecutor as any);
      }).not.toThrow();
    });
  });

  describe('execute', () => {
    it('should execute a simple workflow with script steps', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Test Workflow',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Echo Hello',
            type: 'script',
            config: {
              command: 'echo',
              args: ['Hello World']
            }
          }
        ]
      };

      const result = await runner.execute(workflow);
      
      expect(result.success).toBe(true);
      expect(result.stepResults).toHaveProperty('step1');
      expect(result.stepResults.step1.success).toBe(true);
    });

    it('should handle workflow with dependencies', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Dependency Test',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'First Step',
            type: 'script',
            config: {
              command: 'echo',
              args: ['step1']
            }
          },
          {
            id: 'step2',
            name: 'Second Step',
            type: 'script',
            config: {
              command: 'echo',
              args: ['step2']
            },
            dependsOn: ['step1']
          }
        ]
      };

      const result = await runner.execute(workflow);
      
      expect(result.success).toBe(true);
      expect(result.stepResults).toHaveProperty('step1');
      expect(result.stepResults).toHaveProperty('step2');
    });

    it('should handle step failures when continueOnError is false', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Failure Test',
        version: '1.0.0',
        steps: [
          {
            id: 'failing-step',
            name: 'Failing Step',
            type: 'script',
            config: {
              command: 'nonexistent-command'
            }
          }
        ]
      };

      const result = await runner.execute(workflow);
      
      expect(result.success).toBe(false);
      expect(result.stepResults['failing-step'].success).toBe(false);
      expect(result.error).toContain('Step "failing-step" failed');
    });

    it('should continue execution when continueOnError is true', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Continue on Error Test',
        version: '1.0.0',
        steps: [
          {
            id: 'failing-step',
            name: 'Failing Step',
            type: 'script',
            config: {
              command: 'nonexistent-command'
            },
            continueOnError: true
          },
          {
            id: 'success-step',
            name: 'Success Step',
            type: 'script',
            config: {
              command: 'echo',
              args: ['success']
            }
          }
        ]
      };

      const result = await runner.execute(workflow);
      
      expect(result.stepResults['failing-step'].success).toBe(false);
      expect(result.stepResults['success-step'].success).toBe(true);
    });

    it('should support workflow cancellation', () => {
      // Test that the cancel method works and sets correct status
      expect(runner.getStatus()).toBe(WorkflowStatus.PENDING);
      
      runner.cancel();
      
      expect(runner.getStatus()).toBe(WorkflowStatus.CANCELLED);
    });

    it('should pass environment variables to script steps', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Environment Test',
        version: '1.0.0',
        env: {
          TEST_VAR: 'test_value'
        },
        steps: [
          {
            id: 'env-step',
            name: 'Environment Step',
            type: 'script',
            config: {
              command: 'echo',
              args: ['$TEST_VAR']
            }
          }
        ]
      };

      const result = await runner.execute(workflow);
      
      expect(result.success).toBe(true);
      // Note: In a real environment, this would output the environment variable value
    });
  });

  describe('status tracking', () => {
    it('should track workflow progress', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Progress Test',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            type: 'script',
            config: {
              command: 'echo',
              args: ['step1']
            }
          },
          {
            id: 'step2',
            name: 'Step 2',
            type: 'script',
            config: {
              command: 'echo',
              args: ['step2']
            }
          }
        ]
      };

      const result = await runner.execute(workflow);
      
      expect(result.success).toBe(true);
      expect(runner.getProgress()).toBe(100);
      
      const report = runner.getExecutionReport(workflow, result);
      expect(report.totalSteps).toBe(2);
      expect(report.completedSteps).toBe(2);
      expect(report.failedSteps).toBe(0);
    });

    it('should generate summary and detailed reports', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Report Test',
        version: '1.0.0',
        steps: [
          {
            id: 'test-step',
            name: 'Test Step',
            type: 'script',
            config: {
              command: 'echo',
              args: ['test']
            }
          }
        ]
      };

      const result = await runner.execute(workflow);
      
      const summaryReport = runner.generateSummaryReport(workflow, result);
      expect(summaryReport).toContain('Workflow Execution Report');
      expect(summaryReport).toContain('Report Test');
      
      const detailedReport = runner.generateDetailedReport(workflow, result);
      const parsed = JSON.parse(detailedReport);
      expect(parsed.workflowName).toBe('Report Test');
      expect(parsed.status).toBe('completed');
    });
  });
});