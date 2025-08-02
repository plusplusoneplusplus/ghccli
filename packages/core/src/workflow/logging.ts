/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger, createLogger, LogLevel } from '../utils/logging.js';
import { 
  logToolCall, 
  logApiError, 
  logApiRequest, 
  logApiResponse 
} from '../telemetry/loggers.js';
import { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult } from './types.js';
import { WorkflowError } from './errors.js';

export enum WorkflowLogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  TRACE = 'trace'
}

export interface WorkflowLogContext {
  workflowId: string;
  stepId?: string;
  phase?: 'init' | 'validation' | 'execution' | 'cleanup' | 'completed' | 'failed';
  executionTime?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkflowLogEntry {
  timestamp: string;
  level: WorkflowLogLevel;
  message: string;
  context: WorkflowLogContext;
  error?: WorkflowError;
  data?: Record<string, unknown>;
}

export interface WorkflowMetrics {
  workflowId: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  stepCount: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  parallelExecution: boolean;
  maxConcurrency?: number;
  resourceUtilization?: Record<string, number>;
  errorCount: number;
  warningCount: number;
}

/**
 * Structured logger for workflow operations
 */
export class WorkflowLogger {
  private debugLogger: DebugLogger;
  private logEntries: WorkflowLogEntry[] = [];
  private metrics: WorkflowMetrics;
  private telemetryEnabled: boolean;

  constructor(
    workflowId: string,
    workflowName: string,
    telemetryEnabled: boolean = true
  ) {
    this.debugLogger = createLogger('workflow');
    this.telemetryEnabled = telemetryEnabled;
    this.metrics = {
      workflowId,
      name: workflowName,
      startTime: Date.now(),
      status: 'running',
      stepCount: 0,
      completedSteps: 0,
      failedSteps: 0,
      skippedSteps: 0,
      parallelExecution: false,
      errorCount: 0,
      warningCount: 0
    };
  }

  /**
   * Initialize workflow logging
   */
  initialize(workflow: WorkflowDefinition): void {
    this.metrics.stepCount = workflow.steps.length;
    this.metrics.parallelExecution = workflow.parallel?.enabled ?? false;
    this.metrics.maxConcurrency = workflow.parallel?.defaultMaxConcurrency;

    this.log(WorkflowLogLevel.INFO, 'Workflow initialized', {
      workflowId: this.metrics.workflowId,
      phase: 'init'
    }, {
      name: workflow.name,
      version: workflow.version,
      stepCount: workflow.steps.length,
      parallelEnabled: this.metrics.parallelExecution,
      timeout: workflow.timeout
    });

    // TODO: Integrate with telemetry when Config is available
    // if (this.telemetryEnabled) {
    //   logToolCall(config, new ToolCallEvent(...));
    // }
  }

  /**
   * Log workflow validation phase
   */
  logValidation(success: boolean, errors?: string[]): void {
    const level = success ? WorkflowLogLevel.INFO : WorkflowLogLevel.ERROR;
    const message = success ? 'Workflow validation passed' : 'Workflow validation failed';

    this.log(level, message, {
      workflowId: this.metrics.workflowId,
      phase: 'validation'
    }, {
      success,
      errors
    });

    if (!success) {
      this.metrics.errorCount++;
    }
  }

  /**
   * Log workflow execution start
   */
  logExecutionStart(options?: Record<string, unknown>): void {
    this.log(WorkflowLogLevel.INFO, 'Workflow execution started', {
      workflowId: this.metrics.workflowId,
      phase: 'execution'
    }, options);

    // TODO: Integrate with telemetry when Config is available
  }

  /**
   * Log step execution start
   */
  logStepStart(step: WorkflowStep): void {
    this.log(WorkflowLogLevel.INFO, `Step started: ${step.name}`, {
      workflowId: this.metrics.workflowId,
      stepId: step.id,
      phase: 'execution'
    }, {
      stepType: step.type,
      dependsOn: step.dependsOn,
      parallel: step.parallel?.enabled
    });

    // TODO: Integrate with telemetry when Config is available
  }

  /**
   * Log step execution completion
   */
  logStepComplete(step: WorkflowStep, result: StepResult): void {
    this.metrics.completedSteps++;
    const executionTime = result.executionTime || 0;

    this.log(WorkflowLogLevel.INFO, `Step completed: ${step.name}`, {
      workflowId: this.metrics.workflowId,
      stepId: step.id,
      phase: 'execution',
      executionTime
    }, {
      success: result.success,
      executionTime,
      parallelGroup: result.parallelGroup
    });

    // TODO: Integrate with telemetry when Config is available
  }

  /**
   * Log step execution failure
   */
  logStepFailure(step: WorkflowStep, error: WorkflowError | Error, executionTime?: number): void {
    this.metrics.failedSteps++;
    this.metrics.errorCount++;

    const workflowError = error instanceof WorkflowError ? error : undefined;
    
    this.log(WorkflowLogLevel.ERROR, `Step failed: ${step.name}`, {
      workflowId: this.metrics.workflowId,
      stepId: step.id,
      phase: 'execution',
      executionTime
    }, {
      errorMessage: error.message,
      errorCode: workflowError?.code,
      executionTime
    }, workflowError);

    // TODO: Integrate with telemetry when Config is available
  }

  /**
   * Log step skipped
   */
  logStepSkipped(step: WorkflowStep, reason: string): void {
    this.metrics.skippedSteps++;

    this.log(WorkflowLogLevel.WARN, `Step skipped: ${step.name}`, {
      workflowId: this.metrics.workflowId,
      stepId: step.id,
      phase: 'execution'
    }, {
      reason
    });

    this.metrics.warningCount++;
  }

  /**
   * Log retry attempt
   */
  logRetryAttempt(step: WorkflowStep, attempt: number, maxAttempts: number, error: Error): void {
    this.log(WorkflowLogLevel.WARN, `Step retry attempt ${attempt}/${maxAttempts}: ${step.name}`, {
      workflowId: this.metrics.workflowId,
      stepId: step.id,
      phase: 'execution'
    }, {
      attempt,
      maxAttempts,
      errorMessage: error.message
    });

    this.metrics.warningCount++;
  }

  /**
   * Log workflow completion
   */
  logWorkflowComplete(result: WorkflowResult): void {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;
    this.metrics.status = result.success ? 'completed' : 'failed';

    this.log(WorkflowLogLevel.INFO, 'Workflow completed', {
      workflowId: this.metrics.workflowId,
      phase: 'completed',
      executionTime: this.metrics.duration
    }, {
      success: result.success,
      duration: this.metrics.duration,
      stepResults: Object.keys(result.stepResults).length,
      parallelStats: result.parallelStats
    });

    // TODO: Integrate with telemetry when Config is available
  }

  /**
   * Log workflow cancellation
   */
  logWorkflowCancelled(reason?: string): void {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;
    this.metrics.status = 'cancelled';

    this.log(WorkflowLogLevel.WARN, 'Workflow cancelled', {
      workflowId: this.metrics.workflowId,
      phase: 'failed',
      executionTime: this.metrics.duration
    }, {
      reason,
      duration: this.metrics.duration
    });

    this.metrics.warningCount++;
  }

  /**
   * Log resource utilization
   */
  logResourceUtilization(resource: string, current: number, limit: number): void {
    if (!this.metrics.resourceUtilization) {
      this.metrics.resourceUtilization = {};
    }
    this.metrics.resourceUtilization[resource] = current / limit;

    const level = current > limit * 0.8 ? WorkflowLogLevel.WARN : WorkflowLogLevel.DEBUG;
    const message = `Resource utilization: ${resource} = ${current}/${limit} (${Math.round(current/limit * 100)}%)`;

    this.log(level, message, {
      workflowId: this.metrics.workflowId,
      phase: 'execution'
    }, {
      resource,
      current,
      limit,
      utilization: current / limit
    });

    if (current > limit * 0.8) {
      this.metrics.warningCount++;
    }
  }

  /**
   * Log parallel execution statistics
   */
  logParallelStats(stats: { totalGroups: number; maxConcurrentSteps: number; resourceUtilization?: Record<string, number> }): void {
    this.log(WorkflowLogLevel.INFO, 'Parallel execution completed', {
      workflowId: this.metrics.workflowId,
      phase: 'execution'
    }, stats);

    if (stats.resourceUtilization) {
      this.metrics.resourceUtilization = { ...this.metrics.resourceUtilization, ...stats.resourceUtilization };
    }
  }

  /**
   * Core logging method
   */
  log(
    level: WorkflowLogLevel, 
    message: string, 
    context: WorkflowLogContext, 
    data?: Record<string, unknown>,
    error?: WorkflowError
  ): void {
    const entry: WorkflowLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      data,
      error
    };

    this.logEntries.push(entry);

    // Log to debug logger with appropriate level
    const debugMessage = `[${context.stepId || 'workflow'}] ${message}`;
    const debugData = data ? ` ${JSON.stringify(data)}` : '';
    
    switch (level) {
      case WorkflowLogLevel.ERROR:
        this.debugLogger.error(debugMessage + debugData);
        break;
      case WorkflowLogLevel.WARN:
        this.debugLogger.warn(debugMessage + debugData);
        break;
      case WorkflowLogLevel.INFO:
        this.debugLogger.debug(debugMessage + debugData, LogLevel.NORMAL);
        break;
      case WorkflowLogLevel.DEBUG:
        this.debugLogger.debug(debugMessage + debugData, LogLevel.VERBOSE);
        break;
      case WorkflowLogLevel.TRACE:
        this.debugLogger.debug(debugMessage + debugData, LogLevel.VERBOSE);
        break;
    }
  }

  /**
   * Get current workflow metrics
   */
  getMetrics(): WorkflowMetrics {
    return { ...this.metrics };
  }

  /**
   * Get all log entries
   */
  getLogEntries(): WorkflowLogEntry[] {
    return [...this.logEntries];
  }

  /**
   * Get log entries filtered by level
   */
  getLogEntriesByLevel(level: WorkflowLogLevel): WorkflowLogEntry[] {
    return this.logEntries.filter(entry => entry.level === level);
  }

  /**
   * Get log entries for a specific step
   */
  getStepLogEntries(stepId: string): WorkflowLogEntry[] {
    return this.logEntries.filter(entry => entry.context.stepId === stepId);
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify({
      metrics: this.metrics,
      logEntries: this.logEntries
    }, null, 2);
  }

  /**
   * Clear all log entries (useful for testing)
   */
  clearLogs(): void {
    this.logEntries = [];
  }
}

/**
 * Factory function to create a workflow logger
 */
export function createWorkflowLogger(
  workflowId: string,
  workflowName: string,
  telemetryEnabled: boolean = true
): WorkflowLogger {
  return new WorkflowLogger(workflowId, workflowName, telemetryEnabled);
}