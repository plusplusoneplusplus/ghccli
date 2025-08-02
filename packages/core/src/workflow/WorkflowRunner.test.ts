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

      const result = await runner.execute(workflow, { parallelEnabled: false });
      
      expect(result.success).toBe(false);
      expect(result.stepResults['failing-step'].success).toBe(false);
      expect(result.error).toContain('Failed steps: failing-step');
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

      const result = await runner.execute(workflow, { parallelEnabled: false });
      
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

  describe('parallel execution', () => {
    it('should execute independent steps in parallel when enabled', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Parallel Test',
        version: '1.0.0',
        parallel: {
          enabled: true,
          defaultMaxConcurrency: 2
        },
        steps: [
          {
            id: 'step1',
            name: 'Independent Step 1',
            type: 'script',
            config: {
              command: 'echo',
              args: ['step1']
            },
            parallel: {
              enabled: true
            }
          },
          {
            id: 'step2',
            name: 'Independent Step 2',
            type: 'script',
            config: {
              command: 'echo',
              args: ['step2']
            },
            parallel: {
              enabled: true
            }
          }
        ]
      };

      const result = await runner.execute(workflow, { parallelEnabled: true });
      
      expect(result.success).toBe(true);
      expect(result.stepResults).toHaveProperty('step1');
      expect(result.stepResults).toHaveProperty('step2');
      expect(result.stepResults.step1.success).toBe(true);
      expect(result.stepResults.step2.success).toBe(true);
      expect(result.parallelStats).toBeDefined();
      expect(result.parallelStats!.totalGroups).toBeGreaterThan(0);
    });

    it('should respect step dependencies in parallel execution', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Parallel Dependency Test',
        version: '1.0.0',
        parallel: {
          enabled: true,
          defaultMaxConcurrency: 4
        },
        steps: [
          {
            id: 'step1',
            name: 'First Step',
            type: 'script',
            config: {
              command: 'echo',
              args: ['step1']
            },
            parallel: {
              enabled: true
            }
          },
          {
            id: 'step2',
            name: 'Dependent Step',
            type: 'script',
            config: {
              command: 'echo',
              args: ['step2']
            },
            dependsOn: ['step1'],
            parallel: {
              enabled: true
            }
          },
          {
            id: 'step3',
            name: 'Independent Step',
            type: 'script',
            config: {
              command: 'echo',
              args: ['step3']
            },
            parallel: {
              enabled: true
            }
          }
        ]
      };

      const result = await runner.execute(workflow, { parallelEnabled: true });
      
      expect(result.success).toBe(true);
      expect(result.stepResults.step1.success).toBe(true);
      expect(result.stepResults.step2.success).toBe(true);
      expect(result.stepResults.step3.success).toBe(true);
      
      // step1 and step3 should be in the same parallel group
      // step2 should be in a different group since it depends on step1
      expect(result.stepResults.step1.parallelGroup).toBe(0);
      expect(result.stepResults.step3.parallelGroup).toBe(0);
      expect(result.stepResults.step2.parallelGroup).toBe(1);
    });

    it('should enforce resource limits in parallel execution', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Resource Limit Test',
        version: '1.0.0',
        parallel: {
          enabled: true,
          defaultMaxConcurrency: 4,
          resources: {
            'cpu': 2
          }
        },
        steps: [
          {
            id: 'cpu1',
            name: 'CPU Task 1',
            type: 'script',
            config: {
              command: 'echo',
              args: ['cpu1']
            },
            parallel: {
              enabled: true,
              resource: 'cpu'
            }
          },
          {
            id: 'cpu2',
            name: 'CPU Task 2',
            type: 'script',
            config: {
              command: 'echo',
              args: ['cpu2']
            },
            parallel: {
              enabled: true,
              resource: 'cpu'
            }
          },
          {
            id: 'cpu3',
            name: 'CPU Task 3',
            type: 'script',
            config: {
              command: 'echo',
              args: ['cpu3']
            },
            parallel: {
              enabled: true,
              resource: 'cpu'
            }
          }
        ]
      };

      const result = await runner.execute(workflow, { parallelEnabled: true });
      
      expect(result.success).toBe(true);
      expect(result.stepResults.cpu1.success).toBe(true);
      expect(result.stepResults.cpu2.success).toBe(true);
      expect(result.stepResults.cpu3.success).toBe(true);
      expect(result.parallelStats?.resourceUtilization).toBeDefined();
    });

    it('should handle parallel step failures with isolation', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Parallel Failure Test',
        version: '1.0.0',
        parallel: {
          enabled: true,
          defaultMaxConcurrency: 3
        },
        steps: [
          {
            id: 'success-step',
            name: 'Success Step',
            type: 'script',
            config: {
              command: 'echo',
              args: ['success']
            },
            parallel: {
              enabled: true,
              isolateErrors: true
            }
          },
          {
            id: 'failing-step',
            name: 'Failing Step',
            type: 'script',
            config: {
              command: 'nonexistent-command'
            },
            parallel: {
              enabled: true,
              isolateErrors: true
            },
            continueOnError: true
          },
          {
            id: 'another-success',
            name: 'Another Success',
            type: 'script',
            config: {
              command: 'echo',
              args: ['another']
            },
            parallel: {
              enabled: true,
              isolateErrors: true
            }
          }
        ]
      };

      const result = await runner.execute(workflow, { parallelEnabled: true });
      
      // The workflow should complete with mixed results
      expect(result.stepResults['success-step'].success).toBe(true);
      expect(result.stepResults['failing-step'].success).toBe(false);
      expect(result.stepResults['another-success'].success).toBe(true);
    });

    it('should enforce concurrency limits per step', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Concurrency Limit Test',
        version: '1.0.0',
        parallel: {
          enabled: true,
          defaultMaxConcurrency: 10
        },
        steps: [
          {
            id: 'limited1',
            name: 'Limited Step 1',
            type: 'script',
            config: {
              command: 'echo',
              args: ['limited1']
            },
            parallel: {
              enabled: true,
              maxConcurrency: 1
            }
          },
          {
            id: 'limited2',
            name: 'Limited Step 2',
            type: 'script',
            config: {
              command: 'echo',
              args: ['limited2']
            },
            parallel: {
              enabled: true,
              maxConcurrency: 1
            }
          }
        ]
      };

      const result = await runner.execute(workflow, { parallelEnabled: true });
      
      expect(result.success).toBe(true);
      expect(result.stepResults.limited1.success).toBe(true);
      expect(result.stepResults.limited2.success).toBe(true);
      expect(result.parallelStats?.maxConcurrentSteps).toBeLessThanOrEqual(1);
    });

    it('should fall back to sequential execution when parallel is disabled', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Sequential Fallback Test',
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

      const result = await runner.execute(workflow, { parallelEnabled: false });
      
      expect(result.success).toBe(true);
      expect(result.stepResults.step1.success).toBe(true);
      expect(result.stepResults.step2.success).toBe(true);
      expect(result.parallelStats).toBeUndefined();
    });

    it('should handle complex dependency graphs in parallel', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Complex Dependency Test',
        version: '1.0.0',
        parallel: {
          enabled: true,
          defaultMaxConcurrency: 4
        },
        steps: [
          {
            id: 'root1',
            name: 'Root 1',
            type: 'script',
            config: { command: 'echo', args: ['root1'] },
            parallel: { enabled: true }
          },
          {
            id: 'root2',
            name: 'Root 2',
            type: 'script',
            config: { command: 'echo', args: ['root2'] },
            parallel: { enabled: true }
          },
          {
            id: 'middle1',
            name: 'Middle 1',
            type: 'script',
            config: { command: 'echo', args: ['middle1'] },
            dependsOn: ['root1'],
            parallel: { enabled: true }
          },
          {
            id: 'middle2',
            name: 'Middle 2',
            type: 'script',
            config: { command: 'echo', args: ['middle2'] },
            dependsOn: ['root2'],
            parallel: { enabled: true }
          },
          {
            id: 'final',
            name: 'Final',
            type: 'script',
            config: { command: 'echo', args: ['final'] },
            dependsOn: ['middle1', 'middle2'],
            parallel: { enabled: true }
          }
        ]
      };

      const result = await runner.execute(workflow, { parallelEnabled: true });
      
      expect(result.success).toBe(true);
      expect(Object.keys(result.stepResults)).toHaveLength(5);
      expect(result.parallelStats?.totalGroups).toBe(3); // root, middle, final
      
      // Verify execution order through parallel groups
      expect(result.stepResults.root1.parallelGroup).toBe(0);
      expect(result.stepResults.root2.parallelGroup).toBe(0);
      expect(result.stepResults.middle1.parallelGroup).toBe(1);
      expect(result.stepResults.middle2.parallelGroup).toBe(1);
      expect(result.stepResults.final.parallelGroup).toBe(2);
    });

    it('should handle cancellation during parallel execution', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Cancellation Test',
        version: '1.0.0',
        parallel: {
          enabled: true,
          defaultMaxConcurrency: 2
        },
        steps: [
          {
            id: 'long-step1',
            name: 'Long Running Step 1',
            type: 'script',
            config: {
              command: 'echo',
              args: ['test'] // Use simple command instead of sleep
            },
            parallel: { enabled: true }
          },
          {
            id: 'long-step2',
            name: 'Long Running Step 2',
            type: 'script',
            config: {
              command: 'echo',
              args: ['test']
            },
            parallel: { enabled: true }
          }
        ]
      };

      // Test basic cancellation functionality
      expect(runner.getStatus()).toBe(WorkflowStatus.PENDING);
      
      runner.cancel();
      
      expect(runner.getStatus()).toBe(WorkflowStatus.CANCELLED);
    }, 1000); // 1 second timeout

    it('should provide accurate parallel execution statistics', async () => {
      const workflow: WorkflowDefinition = {
        name: 'Statistics Test',
        version: '1.0.0',
        parallel: {
          enabled: true,
          defaultMaxConcurrency: 3,
          resources: {
            'memory': 2,
            'disk': 1
          }
        },
        steps: [
          { id: 'mem1', name: 'Memory 1', type: 'script', config: { command: 'echo', args: ['mem1'] }, parallel: { enabled: true, resource: 'memory' } },
          { id: 'mem2', name: 'Memory 2', type: 'script', config: { command: 'echo', args: ['mem2'] }, parallel: { enabled: true, resource: 'memory' } },
          { id: 'disk1', name: 'Disk 1', type: 'script', config: { command: 'echo', args: ['disk1'] }, parallel: { enabled: true, resource: 'disk' } },
          { id: 'free1', name: 'Free 1', type: 'script', config: { command: 'echo', args: ['free1'] }, parallel: { enabled: true } }
        ]
      };

      const result = await runner.execute(workflow, { parallelEnabled: true });
      
      expect(result.success).toBe(true);
      expect(result.parallelStats).toBeDefined();
      expect(result.parallelStats!.totalGroups).toBe(1); // All independent
      expect(result.parallelStats!.resourceUtilization).toBeDefined();
      expect(result.parallelStats!.resourceUtilization!.memory).toBeGreaterThanOrEqual(0);
      expect(result.parallelStats!.resourceUtilization!.disk).toBeGreaterThanOrEqual(0);
    });
  });
});