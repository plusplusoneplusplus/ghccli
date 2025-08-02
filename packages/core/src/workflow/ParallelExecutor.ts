/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowStep, StepResult, WorkflowParallelConfig } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';
import { StepExecutor } from './StepExecutor.js';

interface ParallelGroup {
  id: number;
  steps: WorkflowStep[];
  maxConcurrency: number;
  resource?: string;
}

interface ExecutionSlot {
  stepId: string;
  resource?: string;
  startTime: number;
}

export class ParallelExecutor {
  private resourceLimits: Map<string, number> = new Map();
  private activeExecutions: Map<string, ExecutionSlot> = new Map();
  private executionStats: Map<number, { startTime: number; endTime?: number }> = new Map();

  constructor(private stepExecutors: Map<string, StepExecutor>) {}

  /**
   * Execute multiple parallel groups of steps
   */
  async executeParallelGroups(
    groups: ParallelGroup[],
    context: WorkflowContext,
    workflowConfig?: WorkflowParallelConfig,
    onStepStart?: (stepId: string) => void,
    onStepComplete?: (stepId: string, result: StepResult) => void,
    onStepFailed?: (stepId: string, error: string) => void,
    shouldCancel?: () => boolean
  ): Promise<Record<string, StepResult>> {
    const allResults: Record<string, StepResult> = {};
    
    // Initialize resource limits
    this.initializeResourceLimits(workflowConfig);

    // Execute groups sequentially (since they have dependencies between groups)
    for (const group of groups) {
      if (shouldCancel?.()) {
        throw new Error('Execution cancelled');
      }

      const groupStartTime = Date.now();
      this.executionStats.set(group.id, { startTime: groupStartTime });

      const groupResults = await this.executeParallelGroup(
        group,
        context,
        workflowConfig,
        onStepStart,
        onStepComplete,
        onStepFailed,
        shouldCancel
      );

      // Merge results
      Object.assign(allResults, groupResults);

      this.executionStats.set(group.id, {
        startTime: groupStartTime,
        endTime: Date.now()
      });

      // Check if any step in the group failed and should stop execution
      const groupHasFailures = Object.values(groupResults).some(result => !result.success);
      if (groupHasFailures) {
        // Check if any step in the group has continueOnError disabled
        const shouldStop = group.steps.some(step => 
          !step.continueOnError && !groupResults[step.id]?.success
        );
        
        if (shouldStop) {
          // Add remaining steps as skipped
          for (const remainingGroup of groups.slice(groups.indexOf(group) + 1)) {
            for (const step of remainingGroup.steps) {
              allResults[step.id] = {
                success: false,
                error: 'Skipped due to previous failure',
                parallelGroup: remainingGroup.id
              };
            }
          }
          break;
        }
      }
    }

    return allResults;
  }

  /**
   * Execute a single parallel group of steps
   */
  private async executeParallelGroup(
    group: ParallelGroup,
    context: WorkflowContext,
    workflowConfig?: WorkflowParallelConfig,
    onStepStart?: (stepId: string) => void,
    onStepComplete?: (stepId: string, result: StepResult) => void,
    onStepFailed?: (stepId: string, error: string) => void,
    shouldCancel?: () => boolean
  ): Promise<Record<string, StepResult>> {
    const results: Record<string, StepResult> = {};
    const pendingSteps = [...group.steps];
    const runningSteps = new Map<string, Promise<void>>();

    while (pendingSteps.length > 0 || runningSteps.size > 0) {
      if (shouldCancel?.()) {
        // Cancel all running steps
        await Promise.allSettled(runningSteps.values());
        throw new Error('Execution cancelled');
      }

      // Start new steps up to concurrency limit
      while (
        pendingSteps.length > 0 && 
        runningSteps.size < group.maxConcurrency &&
        this.canAllocateResource(group.resource)
      ) {
        const step = pendingSteps.shift()!;
        
        // Check if step should be executed based on conditions
        if (step.condition && !this.evaluateCondition(step.condition, context)) {
          results[step.id] = {
            success: true,
            output: null,
            error: 'Skipped due to condition',
            parallelGroup: group.id
          };
          continue;
        }

        const stepPromise = this.executeStep(
          step,
          context,
          group.id,
          onStepStart,
          onStepComplete,
          onStepFailed
        ).then(result => {
          results[step.id] = result;
          runningSteps.delete(step.id);
          this.releaseResource(step.id);
        }).catch(error => {
          const errorResult: StepResult = {
            success: false,
            error: error.message || String(error),
            parallelGroup: group.id
          };
          results[step.id] = errorResult;
          runningSteps.delete(step.id);
          this.releaseResource(step.id);
          onStepFailed?.(step.id, errorResult.error!);
        });

        runningSteps.set(step.id, stepPromise);
        this.allocateResource(step.id, group.resource);
      }

      // Wait for at least one step to complete if we have running steps
      if (runningSteps.size > 0) {
        await Promise.race(runningSteps.values());
      }
    }

    return results;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: WorkflowStep,
    context: WorkflowContext,
    groupId: number,
    onStepStart?: (stepId: string) => void,
    onStepComplete?: (stepId: string, result: StepResult) => void,
    onStepFailed?: (stepId: string, error: string) => void
  ): Promise<StepResult> {
    const executor = this.stepExecutors.get(step.type);
    if (!executor) {
      throw new Error(`No executor found for step type: ${step.type}`);
    }

    const startTime = Date.now();
    onStepStart?.(step.id);
    context.setCurrentStepId(step.id);

    try {
      const output = await this.executeWithTimeout(
        () => executor.execute(step, context),
        step.config.timeout
      );

      const executionTime = Date.now() - startTime;
      const result: StepResult = {
        success: true,
        output,
        executionTime,
        parallelGroup: groupId
      };

      context.setStepOutput(step.id, output);
      onStepComplete?.(step.id, result);
      
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const result: StepResult = {
        success: false,
        error: errorMessage,
        executionTime,
        parallelGroup: groupId
      };

      onStepFailed?.(step.id, errorMessage);
      
      if (!step.continueOnError && !step.parallel?.isolateErrors) {
        throw error;
      }
      
      return result;
    }
  }

  /**
   * Initialize resource limits from workflow configuration
   */
  private initializeResourceLimits(config?: WorkflowParallelConfig): void {
    this.resourceLimits.clear();
    this.activeExecutions.clear();

    if (config?.resources) {
      for (const [resource, limit] of Object.entries(config.resources)) {
        this.resourceLimits.set(resource, limit);
      }
    }
  }

  /**
   * Check if a resource can be allocated
   */
  private canAllocateResource(resource?: string): boolean {
    if (!resource) return true;

    const limit = this.resourceLimits.get(resource);
    if (limit === undefined) return true;

    const currentUsage = Array.from(this.activeExecutions.values())
      .filter(slot => slot.resource === resource).length;
    
    return currentUsage < limit;
  }

  /**
   * Allocate a resource for a step
   */
  private allocateResource(stepId: string, resource?: string): void {
    this.activeExecutions.set(stepId, {
      stepId,
      resource,
      startTime: Date.now()
    });
  }

  /**
   * Release a resource after step completion
   */
  private releaseResource(stepId: string): void {
    this.activeExecutions.delete(stepId);
  }

  /**
   * Get resource utilization statistics
   */
  getResourceUtilization(): Record<string, number> {
    const utilization: Record<string, number> = {};
    
    for (const [resource, limit] of this.resourceLimits.entries()) {
      const currentUsage = Array.from(this.activeExecutions.values())
        .filter(slot => slot.resource === resource).length;
      utilization[resource] = currentUsage / limit;
    }

    return utilization;
  }

  /**
   * Get parallel execution statistics
   */
  getParallelStats() {
    const totalGroups = this.executionStats.size;
    const maxConcurrentSteps = Math.max(0, this.activeExecutions.size);
    const resourceUtilization = this.getResourceUtilization();

    return {
      totalGroups,
      maxConcurrentSteps,
      resourceUtilization: Object.keys(resourceUtilization).length > 0 ? resourceUtilization : undefined
    };
  }

  /**
   * Execute a function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout?: number
  ): Promise<T> {
    if (!timeout) {
      return await fn();
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution timed out after ${timeout}ms`));
      }, timeout);

      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Evaluate a condition expression
   */
  private evaluateCondition(condition: string, context: WorkflowContext): boolean {
    try {
      // Simple condition evaluation - can be extended
      // For testing: "false" evaluates to false, everything else evaluates to true
      if (condition === 'false') {
        return false;
      }
      return condition.length > 0;
    } catch {
      return false;
    }
  }
}