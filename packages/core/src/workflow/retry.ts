/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { retryWithBackoff, RetryOptions } from '../utils/retry.js';
import { WorkflowStep, StepResult } from './types.js';
import { 
  WorkflowError, 
  WorkflowStepError, 
  WorkflowTimeoutError,
  isRetryableError 
} from './errors.js';
import { WorkflowLogger } from './logging.js';

export interface WorkflowRetryOptions extends Partial<RetryOptions> {
  enableRetry?: boolean;
  stepSpecificRetry?: Record<string, Partial<RetryOptions>>;
}

export interface WorkflowRetryContext {
  workflowId: string;
  step: WorkflowStep;
  logger?: WorkflowLogger;
}

/**
 * Enhanced retry logic specifically for workflow steps
 */
export class WorkflowRetryManager {
  private defaultOptions: WorkflowRetryOptions;

  constructor(defaultOptions: WorkflowRetryOptions = {}) {
    this.defaultOptions = {
      enableRetry: true,
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      shouldRetry: this.shouldRetryWorkflowStep,
      ...defaultOptions
    };
  }

  /**
   * Execute a step with retry logic
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    context: WorkflowRetryContext,
    options?: Partial<WorkflowRetryOptions>
  ): Promise<T> {
    const effectiveOptions = this.getEffectiveOptions(context.step, options);

    if (!effectiveOptions.enableRetry) {
      return await fn();
    }

    const retryOptions: RetryOptions = {
      maxAttempts: effectiveOptions.maxAttempts!,
      initialDelayMs: effectiveOptions.initialDelayMs!,
      maxDelayMs: effectiveOptions.maxDelayMs!,
      shouldRetry: (error: Error) => this.shouldRetryWorkflowStep(error, context),
    };

    return await retryWithBackoff(async () => {
      try {
        return await fn();
      } catch (error) {
        // Log retry attempt if logger is available
        if (context.logger && error instanceof Error) {
          const currentAttempt = this.getCurrentAttempt(error);
          if (currentAttempt > 1) {
            context.logger.logRetryAttempt(
              context.step,
              currentAttempt,
              effectiveOptions.maxAttempts!,
              error
            );
          }
        }

        // Wrap non-workflow errors in WorkflowStepError
        if (!(error instanceof WorkflowError)) {
          throw new WorkflowStepError(
            `Step execution failed: ${error instanceof Error ? error.message : String(error)}`,
            context.step,
            context.workflowId,
            error instanceof Error ? error : undefined,
            { attempt: this.getCurrentAttempt(error) }
          );
        }

        throw error;
      }
    }, retryOptions);
  }

  /**
   * Determine if a workflow step should be retried
   */
  private shouldRetryWorkflowStep(error: Error, context?: WorkflowRetryContext): boolean {
    // Never retry certain workflow-specific errors
    if (error instanceof WorkflowTimeoutError && 
        error.timeoutMs > 60000) { // Don't retry long timeouts
      return false;
    }

    // Check step-specific retry configuration
    if (context?.step.config && 'retryable' in context.step.config) {
      return (context.step.config as { retryable: boolean }).retryable;
    }

    // Use generic retry logic for other errors
    return isRetryableError(error);
  }

  /**
   * Get effective retry options for a specific step
   */
  private getEffectiveOptions(
    step: WorkflowStep,
    options?: Partial<WorkflowRetryOptions>
  ): WorkflowRetryOptions {
    const stepSpecificOptions = this.defaultOptions.stepSpecificRetry?.[step.id] || {};
    
    return {
      ...this.defaultOptions,
      ...stepSpecificOptions,
      ...options
    };
  }

  /**
   * Extract current attempt number from error (heuristic)
   */
  private getCurrentAttempt(error: unknown): number {
    if (error instanceof WorkflowStepError && error.context?.attempt) {
      return error.context.attempt as number;
    }
    return 1;
  }
}

/**
 * Utility function to create a configured retry manager
 */
export function createWorkflowRetryManager(
  options: WorkflowRetryOptions = {}
): WorkflowRetryManager {
  return new WorkflowRetryManager(options);
}

/**
 * Circuit breaker pattern for workflow steps
 */
export class WorkflowCircuitBreaker {
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private failureThreshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(
    fn: () => Promise<T>,
    context: WorkflowRetryContext
  ): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
        context.logger?.logStepStart(context.step);
      } else {
        throw new WorkflowStepError(
          'Circuit breaker is open - too many recent failures',
          context.step,
          context.workflowId,
          undefined,
          { 
            circuitBreakerState: this.state,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime
          }
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): { state: string; failureCount: number; lastFailureTime: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }

  /**
   * Reset circuit breaker to closed state
   */
  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
  }
}