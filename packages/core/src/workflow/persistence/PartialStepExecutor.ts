/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { StepExecutor } from '../StepExecutor.js';
import { WorkflowStep, StepResult } from '../types.js';
import { WorkflowContext } from '../WorkflowContext.js';
import { WorkflowState, StepStatus } from './WorkflowState.js';

export interface PartialStepResult {
  partialData?: Record<string, unknown>;
  checkpoint?: string;
  progress?: number;
  canResume?: boolean;
}

export interface PartialExecutionContext {
  step: WorkflowStep;
  context: WorkflowContext;
  workflowState?: WorkflowState;
  partialData?: Record<string, unknown>;
}

/**
 * Wrapper for step executors that provides partial execution and rollback capabilities
 */
export class PartialStepExecutor {
  constructor(private baseExecutor: StepExecutor) {}

  /**
   * Execute step with partial result handling
   */
  async execute(
    step: WorkflowStep, 
    context: WorkflowContext,
    workflowState?: WorkflowState
  ): Promise<unknown> {
    const executionContext: PartialExecutionContext = {
      step,
      context,
      workflowState
    };

    // Check if step has partial data from previous execution
    if (workflowState) {
      const stepState = workflowState.getStepState(step.id);
      if (stepState?.status === StepStatus.PARTIAL && stepState.partialData) {
        executionContext.partialData = stepState.partialData;
        context.log(`Resuming step ${step.id} from partial state`, 'info');
      }
    }

    try {
      // Check if base executor supports partial execution
      if (this.supportsPartialExecution(this.baseExecutor)) {
        return await this.executeWithPartialSupport(executionContext);
      } else {
        return await this.baseExecutor.execute(step, context);
      }
    } catch (error) {
      // Handle rollback if needed
      await this.handleRollback(executionContext, error);
      throw error;
    }
  }

  /**
   * Execute step with partial execution support
   */
  private async executeWithPartialSupport(
    executionContext: PartialExecutionContext
  ): Promise<unknown> {
    const { step, context, workflowState, partialData } = executionContext;

    // Create enhanced context with partial data
    if (partialData) {
      context.setVariable('__partial_data', partialData);
    }

    // Execute with checkpoint callback
    const checkpointCallback = async (partialResult: PartialStepResult) => {
      if (workflowState && partialResult.partialData) {
        workflowState.updateStepState(
          step.id, 
          StepStatus.PARTIAL, 
          undefined, 
          partialResult.partialData
        );
        context.log(`Checkpoint saved for step ${step.id}`, 'debug');
      }
    };

    // Add checkpoint callback to step config if executor supports it
    const enhancedStep = this.enhanceStepWithCheckpoint(step, checkpointCallback);

    return await this.baseExecutor.execute(enhancedStep, context);
  }

  /**
   * Handle rollback when step fails
   */
  private async handleRollback(
    executionContext: PartialExecutionContext,
    error: any
  ): Promise<void> {
    const { step, context, workflowState } = executionContext;

    context.log(`Rolling back step ${step.id} due to error: ${error.message}`, 'warn');

    // Check if step has rollback configuration
    const rollbackConfig = this.getRollbackConfig(step);
    if (!rollbackConfig) {
      return;
    }

    try {
      // Execute rollback actions
      for (const action of rollbackConfig.actions || []) {
        await this.executeRollbackAction(action, context);
      }

      // Clear partial data if configured
      if (rollbackConfig.clearPartialData && workflowState) {
        workflowState.updateStepState(step.id, StepStatus.FAILED, undefined, undefined);
      }

      context.log(`Rollback completed for step ${step.id}`, 'info');
    } catch (rollbackError) {
      const errorMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      context.log(`Rollback failed for step ${step.id}: ${errorMessage}`, 'error');
      // Don't throw rollback errors - the original error should be preserved
    }
  }

  /**
   * Execute a rollback action
   */
  private async executeRollbackAction(
    action: RollbackAction,
    context: WorkflowContext
  ): Promise<void> {
    switch (action.type) {
      case 'script':
        // Execute cleanup script
        const { execSync } = await import('child_process');
        execSync(action.command!, { 
          stdio: 'pipe',
          cwd: action.workingDirectory 
        });
        break;

      case 'file_cleanup':
        // Clean up files
        const fs = await import('fs/promises');
        if (action.paths) {
          for (const filePath of action.paths) {
            try {
              await fs.unlink(filePath);
            } catch {
              // Ignore file not found errors
            }
          }
        }
        break;

      case 'variable_reset':
        // Reset context variables
        if (action.variables) {
          for (const varName of action.variables) {
            context.setVariable(varName, undefined);
          }
        }
        break;

      default:
        context.log(`Unknown rollback action type: ${action.type}`, 'warn');
    }
  }

  /**
   * Check if executor supports partial execution
   */
  private supportsPartialExecution(executor: StepExecutor): boolean {
    // Check if executor has partial execution methods
    return typeof (executor as any).executePartial === 'function' ||
           typeof (executor as any).supportsCheckpoints === 'function';
  }

  /**
   * Enhance step configuration with checkpoint callback
   */
  private enhanceStepWithCheckpoint(
    step: WorkflowStep,
    checkpointCallback: (result: PartialStepResult) => Promise<void>
  ): WorkflowStep {
    return {
      ...step,
      config: {
        ...step.config,
        __checkpointCallback: checkpointCallback
      } as any // Type assertion needed for enhanced config
    };
  }

  /**
   * Get rollback configuration from step
   */
  private getRollbackConfig(step: WorkflowStep): RollbackConfig | null {
    const config = step.config as any;
    return config.rollback || null;
  }
}

export interface RollbackAction {
  type: 'script' | 'file_cleanup' | 'variable_reset' | 'custom';
  command?: string;
  workingDirectory?: string;
  paths?: string[];
  variables?: string[];
  customHandler?: string;
}

export interface RollbackConfig {
  enabled: boolean;
  actions: RollbackAction[];
  clearPartialData?: boolean;
  retryAfterRollback?: boolean;
}