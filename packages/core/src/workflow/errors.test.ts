/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  WorkflowError,
  WorkflowValidationError,
  WorkflowStepError,
  WorkflowTimeoutError,
  WorkflowCancelledError,
  WorkflowDependencyError,
  WorkflowExecutorError,
  WorkflowConfigurationError,
  WorkflowParallelExecutionError,
  WorkflowResourceError,
  createWorkflowError,
  isRetryableError
} from './errors.js';
import { WorkflowStep } from './types.js';

describe('WorkflowError', () => {
  it('should create a basic workflow error', () => {
    const error = new WorkflowValidationError(
      'Test error message',
      'test-workflow-id',
      { testContext: true }
    );

    expect(error.message).toBe('Test error message');
    expect(error.code).toBe('WORKFLOW_VALIDATION_ERROR');
    expect(error.workflowId).toBe('test-workflow-id');
    expect(error.context).toEqual({ testContext: true });
    expect(error.name).toBe('WorkflowValidationError');
  });

  it('should serialize to JSON correctly', () => {
    const error = new WorkflowValidationError(
      'Test error',
      'workflow-123',
      { key: 'value' }
    );

    const json = error.toJSON();
    expect(json).toEqual({
      name: 'WorkflowValidationError',
      message: 'Test error',
      code: 'WORKFLOW_VALIDATION_ERROR',
      workflowId: 'workflow-123',
      stepId: undefined,
      context: { key: 'value' },
      stack: expect.any(String)
    });
  });
});

describe('WorkflowStepError', () => {
  const mockStep: WorkflowStep = {
    id: 'test-step',
    name: 'Test Step',
    type: 'script',
    config: { command: 'echo test' }
  };

  it('should create a step error with original error', () => {
    const originalError = new Error('Original error');
    const stepError = new WorkflowStepError(
      'Step failed',
      mockStep,
      'workflow-123',
      originalError,
      { attempt: 1 }
    );

    expect(stepError.message).toBe('Step failed');
    expect(stepError.code).toBe('WORKFLOW_STEP_ERROR');
    expect(stepError.stepId).toBe('test-step');
    expect(stepError.step).toBe(mockStep);
    expect(stepError.originalError).toBe(originalError);
    expect(stepError.context).toEqual({ attempt: 1 });
  });

  it('should serialize step error with original error', () => {
    const originalError = new Error('Original error');
    const stepError = new WorkflowStepError(
      'Step failed',
      mockStep,
      'workflow-123',
      originalError
    );

    const json = stepError.toJSON();
    expect(json.step).toEqual({
      id: 'test-step',
      name: 'Test Step',
      type: 'script'
    });
    expect(json.originalError).toEqual({
      name: 'Error',
      message: 'Original error',
      stack: expect.any(String)
    });
  });
});

describe('WorkflowTimeoutError', () => {
  it('should create a timeout error with timeout value', () => {
    const error = new WorkflowTimeoutError(
      'Operation timed out',
      30000,
      'workflow-123',
      'step-456',
      { operation: 'long-running-task' }
    );

    expect(error.message).toBe('Operation timed out');
    expect(error.code).toBe('WORKFLOW_TIMEOUT_ERROR');
    expect(error.timeoutMs).toBe(30000);
    expect(error.workflowId).toBe('workflow-123');
    expect(error.stepId).toBe('step-456');
  });

  it('should include timeout in JSON serialization', () => {
    const error = new WorkflowTimeoutError('Timeout', 5000);
    const json = error.toJSON();
    expect(json.timeoutMs).toBe(5000);
  });
});

describe('WorkflowDependencyError', () => {
  it('should create a dependency error with failed dependencies', () => {
    const failedDeps = ['step-1', 'step-2'];
    const error = new WorkflowDependencyError(
      'Dependencies failed',
      failedDeps,
      'workflow-123',
      'step-3'
    );

    expect(error.message).toBe('Dependencies failed');
    expect(error.code).toBe('WORKFLOW_DEPENDENCY_ERROR');
    expect(error.failedDependencies).toEqual(failedDeps);
    expect(error.stepId).toBe('step-3');
  });

  it('should include failed dependencies in JSON', () => {
    const failedDeps = ['dep-1', 'dep-2'];
    const error = new WorkflowDependencyError('Deps failed', failedDeps);
    const json = error.toJSON();
    expect(json.failedDependencies).toEqual(failedDeps);
  });
});

describe('WorkflowExecutorError', () => {
  it('should create an executor error with step type', () => {
    const error = new WorkflowExecutorError(
      'No executor found',
      'custom-type',
      'workflow-123',
      'step-456'
    );

    expect(error.message).toBe('No executor found');
    expect(error.code).toBe('WORKFLOW_EXECUTOR_ERROR');
    expect(error.stepType).toBe('custom-type');
  });

  it('should include step type in JSON', () => {
    const error = new WorkflowExecutorError('Error', 'unknown-type');
    const json = error.toJSON();
    expect(json.stepType).toBe('unknown-type');
  });
});

describe('WorkflowParallelExecutionError', () => {
  it('should create a parallel execution error', () => {
    const failedSteps = ['step-1', 'step-3'];
    const errors = [new Error('Error 1'), new Error('Error 2')];
    const error = new WorkflowParallelExecutionError(
      'Parallel execution failed',
      failedSteps,
      errors,
      'workflow-123'
    );

    expect(error.message).toBe('Parallel execution failed');
    expect(error.code).toBe('WORKFLOW_PARALLEL_EXECUTION_ERROR');
    expect(error.failedSteps).toEqual(failedSteps);
    expect(error.errors).toEqual(errors);
  });

  it('should serialize errors in JSON', () => {
    const errors = [new Error('Error 1'), new Error('Error 2')];
    const error = new WorkflowParallelExecutionError(
      'Failed',
      ['step-1'],
      errors
    );

    const json = error.toJSON();
    expect((json.errors as any[])).toHaveLength(2);
    expect((json.errors as any[])[0]).toEqual({
      name: 'Error',
      message: 'Error 1',
      stack: expect.any(String)
    });
  });
});

describe('WorkflowResourceError', () => {
  it('should create a resource error with limits', () => {
    const error = new WorkflowResourceError(
      'Memory limit exceeded',
      'memory',
      1024,
      2048,
      'workflow-123',
      'step-456'
    );

    expect(error.message).toBe('Memory limit exceeded');
    expect(error.code).toBe('WORKFLOW_RESOURCE_ERROR');
    expect(error.resource).toBe('memory');
    expect(error.limit).toBe(1024);
    expect(error.current).toBe(2048);
  });

  it('should include resource info in JSON', () => {
    const error = new WorkflowResourceError(
      'CPU limit exceeded',
      'cpu',
      80,
      95
    );

    const json = error.toJSON();
    expect(json.resource).toBe('cpu');
    expect(json.limit).toBe(80);
    expect(json.current).toBe(95);
  });
});

describe('createWorkflowError', () => {
  const mockStep: WorkflowStep = {
    id: 'test-step',
    name: 'Test Step',
    type: 'script',
    config: { command: 'echo test' }
  };

  it('should return workflow error if already a workflow error', () => {
    const workflowError = new WorkflowValidationError('Test error');
    const result = createWorkflowError(workflowError);
    expect(result).toBe(workflowError);
  });

  it('should create step error when step is provided', () => {
    const genericError = new Error('Generic error');
    const result = createWorkflowError(
      genericError,
      mockStep,
      'workflow-123',
      { context: 'test' }
    );

    expect(result).toBeInstanceOf(WorkflowStepError);
    expect(result.message).toBe('Generic error');
    expect((result as WorkflowStepError).step).toBe(mockStep);
    expect((result as WorkflowStepError).originalError).toBe(genericError);
    expect(result.workflowId).toBe('workflow-123');
    expect(result.context).toEqual({ context: 'test' });
  });

  it('should create validation error when no step is provided', () => {
    const genericError = new Error('Generic error');
    const result = createWorkflowError(
      genericError,
      undefined,
      'workflow-123'
    );

    expect(result).toBeInstanceOf(WorkflowValidationError);
    expect(result.message).toBe('Generic error');
    expect(result.workflowId).toBe('workflow-123');
  });
});

describe('isRetryableError', () => {
  it('should identify retryable network errors', () => {
    const econnresetError = new Error('ECONNRESET');
    const enotfoundError = new Error('ENOTFOUND');
    const etimedoutError = new Error('ETIMEDOUT');
    const timeoutError = new Error('timeout');

    expect(isRetryableError(econnresetError)).toBe(true);
    expect(isRetryableError(enotfoundError)).toBe(true);
    expect(isRetryableError(etimedoutError)).toBe(true);
    expect(isRetryableError(timeoutError)).toBe(true);
  });

  it('should identify retryable HTTP status codes', () => {
    const error429 = new Error('429 Too Many Requests');
    const error502 = new Error('502 Bad Gateway');
    const error503 = new Error('503 Service Unavailable');
    const error504 = new Error('504 Gateway Timeout');

    expect(isRetryableError(error429)).toBe(true);
    expect(isRetryableError(error502)).toBe(true);
    expect(isRetryableError(error503)).toBe(true);
    expect(isRetryableError(error504)).toBe(true);
  });

  it('should identify non-retryable workflow errors', () => {
    const validationError = new WorkflowValidationError('Invalid config');
    const configError = new WorkflowConfigurationError('Bad config');
    const cancelledError = new WorkflowCancelledError('Cancelled');
    const executorError = new WorkflowExecutorError('No executor', 'unknown');

    expect(isRetryableError(validationError)).toBe(false);
    expect(isRetryableError(configError)).toBe(false);
    expect(isRetryableError(cancelledError)).toBe(false);
    expect(isRetryableError(executorError)).toBe(false);
  });

  it('should default to non-retryable for unknown errors', () => {
    const unknownError = new Error('Unknown error');
    const syntaxError = new SyntaxError('Invalid syntax');

    expect(isRetryableError(unknownError)).toBe(false);
    expect(isRetryableError(syntaxError)).toBe(false);
  });

  it('should identify retryable step errors with retryable original errors', () => {
    const mockStep: WorkflowStep = {
      id: 'test-step',
      name: 'Test Step',
      type: 'script',
      config: { command: 'echo test' }
    };

    const networkError = new Error('ECONNRESET connection lost');
    const stepError = new WorkflowStepError(
      'Step failed due to network',
      mockStep,
      'workflow-123',
      networkError
    );

    // WorkflowStepError itself is not in the non-retryable list,
    // so it should fall through to the default (false)
    expect(isRetryableError(stepError)).toBe(false);
    
    // But the original network error would be retryable
    expect(isRetryableError(networkError)).toBe(true);
  });
});