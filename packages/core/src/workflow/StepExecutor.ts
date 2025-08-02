/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowStep } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';

/**
 * Abstract base class for step executors
 * Each step type (script, agent, etc.) should implement this interface
 */
export abstract class StepExecutor {
  /**
   * Execute a workflow step
   * @param step The workflow step to execute
   * @param context The current workflow context
   * @returns Promise that resolves to the step output
   */
  abstract execute(step: WorkflowStep, context: WorkflowContext): Promise<unknown>;

  /**
   * Validate that the step configuration is valid for this executor
   * @param step The workflow step to validate
   * @returns Validation result with errors if any
   */
  abstract validate(step: WorkflowStep): { valid: boolean; errors: string[] };

  /**
   * Get the supported step type for this executor
   */
  abstract getSupportedType(): string;

  /**
   * Check if this executor can handle the given step
   */
  canExecute(step: WorkflowStep): boolean {
    return step.type === this.getSupportedType();
  }

  /**
   * Pre-execution hook - called before step execution
   * Can be overridden by concrete implementations
   */
  protected async beforeExecute(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Post-execution hook - called after step execution
   * Can be overridden by concrete implementations
   */
  protected async afterExecute(step: WorkflowStep, context: WorkflowContext, result: unknown): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Error handling hook - called when step execution fails
   * Can be overridden by concrete implementations
   */
  protected async onError(step: WorkflowStep, context: WorkflowContext, error: Error): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Template method that wraps the execution with hooks
   */
  async executeWithHooks(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    try {
      await this.beforeExecute(step, context);
      const result = await this.execute(step, context);
      await this.afterExecute(step, context, result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.onError(step, context, err);
      throw err;
    }
  }
}