/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowStep } from './types.js';

/**
 * Base class for all workflow-related errors
 */
export abstract class WorkflowError extends Error {
  public readonly code: string;
  public readonly workflowId?: string;
  public readonly stepId?: string;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    workflowId?: string,
    stepId?: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.workflowId = workflowId;
    this.stepId = stepId;
    this.context = context;

    // Maintain proper stack trace for where error was thrown (only in V8 environments)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get error details in a structured format
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      workflowId: this.workflowId,
      stepId: this.stepId,
      context: this.context,
      stack: this.stack
    };
  }
}

/**
 * Error thrown when workflow validation fails
 */
export class WorkflowValidationError extends WorkflowError {
  constructor(
    message: string,
    workflowId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_VALIDATION_ERROR', workflowId, undefined, context);
  }
}

/**
 * Error thrown when a workflow step fails
 */
export class WorkflowStepError extends WorkflowError {
  public readonly step: WorkflowStep;
  public readonly originalError?: Error;

  constructor(
    message: string,
    step: WorkflowStep,
    workflowId?: string,
    originalError?: Error,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_STEP_ERROR', workflowId, step.id, context);
    this.step = step;
    this.originalError = originalError;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      step: {
        id: this.step.id,
        name: this.step.name,
        type: this.step.type
      },
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
        stack: this.originalError.stack
      } : undefined
    };
  }
}

/**
 * Error thrown when a workflow step times out
 */
export class WorkflowTimeoutError extends WorkflowError {
  public readonly timeoutMs: number;

  constructor(
    message: string,
    timeoutMs: number,
    workflowId?: string,
    stepId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_TIMEOUT_ERROR', workflowId, stepId, context);
    this.timeoutMs = timeoutMs;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      timeoutMs: this.timeoutMs
    };
  }
}

/**
 * Error thrown when workflow execution is cancelled
 */
export class WorkflowCancelledError extends WorkflowError {
  constructor(
    message: string = 'Workflow execution was cancelled',
    workflowId?: string,
    stepId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_CANCELLED_ERROR', workflowId, stepId, context);
  }
}

/**
 * Error thrown when step dependencies fail
 */
export class WorkflowDependencyError extends WorkflowError {
  public readonly failedDependencies: string[];

  constructor(
    message: string,
    failedDependencies: string[],
    workflowId?: string,
    stepId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_DEPENDENCY_ERROR', workflowId, stepId, context);
    this.failedDependencies = failedDependencies;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      failedDependencies: this.failedDependencies
    };
  }
}

/**
 * Error thrown when step executor is not found
 */
export class WorkflowExecutorError extends WorkflowError {
  public readonly stepType: string;

  constructor(
    message: string,
    stepType: string,
    workflowId?: string,
    stepId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_EXECUTOR_ERROR', workflowId, stepId, context);
    this.stepType = stepType;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stepType: this.stepType
    };
  }
}

/**
 * Error thrown when workflow configuration is invalid
 */
export class WorkflowConfigurationError extends WorkflowError {
  constructor(
    message: string,
    workflowId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_CONFIGURATION_ERROR', workflowId, undefined, context);
  }
}

/**
 * Error thrown during parallel execution
 */
export class WorkflowParallelExecutionError extends WorkflowError {
  public readonly failedSteps: string[];
  public readonly errors: Error[];

  constructor(
    message: string,
    failedSteps: string[],
    errors: Error[],
    workflowId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_PARALLEL_EXECUTION_ERROR', workflowId, undefined, context);
    this.failedSteps = failedSteps;
    this.errors = errors;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      failedSteps: this.failedSteps,
      errors: this.errors.map(error => ({
        name: error.name,
        message: error.message,
        stack: error.stack
      }))
    };
  }
}

/**
 * Error thrown when workflow resource limits are exceeded
 */
export class WorkflowResourceError extends WorkflowError {
  public readonly resource: string;
  public readonly limit: number;
  public readonly current: number;

  constructor(
    message: string,
    resource: string,
    limit: number,
    current: number,
    workflowId?: string,
    stepId?: string,
    context?: Record<string, unknown>
  ) {
    super(message, 'WORKFLOW_RESOURCE_ERROR', workflowId, stepId, context);
    this.resource = resource;
    this.limit = limit;
    this.current = current;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      resource: this.resource,
      limit: this.limit,
      current: this.current
    };
  }
}

/**
 * Utility function to create a workflow error from a generic error
 */
export function createWorkflowError(
  error: Error,
  step?: WorkflowStep,
  workflowId?: string,
  context?: Record<string, unknown>
): WorkflowError {
  if (error instanceof WorkflowError) {
    return error;
  }

  if (step) {
    return new WorkflowStepError(
      error.message,
      step,
      workflowId,
      error,
      context
    );
  }

  return new WorkflowValidationError(
    error.message,
    workflowId,
    context
  );
}

/**
 * Utility function to check if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  // Network-related errors that might be transient
  if (error.message.includes('ECONNRESET') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('timeout')) {
    return true;
  }

  // HTTP status codes that indicate retryable errors
  if (error.message.includes('429') ||  // Too Many Requests
      error.message.includes('502') ||  // Bad Gateway
      error.message.includes('503') ||  // Service Unavailable
      error.message.includes('504')) {  // Gateway Timeout
    return true;
  }

  // Workflow-specific non-retryable errors
  if (error instanceof WorkflowValidationError ||
      error instanceof WorkflowConfigurationError ||
      error instanceof WorkflowCancelledError ||
      error instanceof WorkflowExecutorError) {
    return false;
  }

  // Default to non-retryable for unknown errors
  return false;
}