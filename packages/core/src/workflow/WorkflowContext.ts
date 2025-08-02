/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  stepId?: string;
}

/**
 * Context object that maintains state throughout workflow execution
 * Provides access to variables, step outputs, environment, and logging
 */
export class WorkflowContext {
  private workflowId: string;
  private currentStepId: string | null = null;
  private variables: Record<string, unknown>;
  private stepOutputs: Map<string, unknown> = new Map();
  private environmentVariables: Record<string, string>;
  private logs: LogEntry[] = [];
  private startTime: Date = new Date();

  constructor(
    workflowId: string,
    initialVariables: Record<string, unknown> = {},
    environmentVariables: Record<string, string> = {}
  ) {
    this.workflowId = workflowId;
    this.variables = { ...initialVariables };
    this.environmentVariables = { ...environmentVariables };
  }

  /**
   * Get the workflow ID
   */
  getWorkflowId(): string {
    return this.workflowId;
  }

  /**
   * Get the current step ID being executed
   */
  getCurrentStepId(): string | null {
    return this.currentStepId;
  }

  /**
   * Set the current step ID being executed
   */
  setCurrentStepId(stepId: string | null): void {
    this.currentStepId = stepId;
  }

  /**
   * Get a variable value
   */
  getVariable(name: string): unknown {
    return this.variables[name];
  }

  /**
   * Set a variable value
   */
  setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }

  /**
   * Get all variables
   */
  getVariables(): Record<string, unknown> {
    return { ...this.variables };
  }

  /**
   * Set multiple variables at once
   */
  setVariables(variables: Record<string, unknown>): void {
    Object.assign(this.variables, variables);
  }

  /**
   * Get environment variables
   */
  getEnvironmentVariables(): Record<string, string> {
    return { ...this.environmentVariables };
  }

  /**
   * Set an environment variable
   */
  setEnvironmentVariable(name: string, value: string): void {
    this.environmentVariables[name] = value;
  }

  /**
   * Get output from a specific step
   */
  getStepOutput(stepId: string): unknown {
    return this.stepOutputs.get(stepId);
  }

  /**
   * Set output for a specific step
   */
  setStepOutput(stepId: string, output: unknown): void {
    this.stepOutputs.set(stepId, output);
  }

  /**
   * Get all step outputs
   */
  getAllStepOutputs(): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const [stepId, output] of this.stepOutputs.entries()) {
      outputs[stepId] = output;
    }
    return outputs;
  }

  /**
   * Check if a step has produced output
   */
  hasStepOutput(stepId: string): boolean {
    return this.stepOutputs.has(stepId);
  }

  /**
   * Log a message with optional level and step context
   */
  log(message: string, level: LogLevel = 'info', stepId?: string): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      stepId: stepId || this.currentStepId || undefined
    };
    
    this.logs.push(entry);
    
    // Also log to console for debugging (can be disabled in production)
    const prefix = stepId || this.currentStepId ? `[${stepId || this.currentStepId}]` : '[workflow]';
    const timestamp = entry.timestamp.toISOString();
    
    switch (level) {
      case 'debug':
        console.debug(`${timestamp} DEBUG ${prefix}: ${message}`);
        break;
      case 'info':
        console.info(`${timestamp} INFO ${prefix}: ${message}`);
        break;
      case 'warn':
        console.warn(`${timestamp} WARN ${prefix}: ${message}`);
        break;
      case 'error':
        console.error(`${timestamp} ERROR ${prefix}: ${message}`);
        break;
    }
  }

  /**
   * Get all log entries
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(entry => entry.level === level);
  }

  /**
   * Get logs for a specific step
   */
  getLogsForStep(stepId: string): LogEntry[] {
    return this.logs.filter(entry => entry.stepId === stepId);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Get workflow start time
   */
  getStartTime(): Date {
    return this.startTime;
  }

  /**
   * Get workflow execution duration in milliseconds
   */
  getExecutionDuration(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Create a snapshot of the current context state
   */
  createSnapshot(): WorkflowContextSnapshot {
    return {
      workflowId: this.workflowId,
      currentStepId: this.currentStepId,
      variables: { ...this.variables },
      stepOutputs: { ...this.getAllStepOutputs() },
      environmentVariables: { ...this.environmentVariables },
      logs: [...this.logs],
      startTime: this.startTime,
      snapshotTime: new Date()
    };
  }

  /**
   * Restore context from a snapshot
   */
  restoreFromSnapshot(snapshot: WorkflowContextSnapshot): void {
    this.workflowId = snapshot.workflowId;
    this.currentStepId = snapshot.currentStepId;
    this.variables = { ...snapshot.variables };
    this.environmentVariables = { ...snapshot.environmentVariables };
    this.logs = [...snapshot.logs];
    this.startTime = snapshot.startTime;
    
    // Restore step outputs
    this.stepOutputs.clear();
    for (const [stepId, output] of Object.entries(snapshot.stepOutputs)) {
      this.stepOutputs.set(stepId, output);
    }
  }

  /**
   * Evaluate a simple expression against the context
   * This is a basic implementation that can be extended for more complex expressions
   */
  evaluateExpression(expression: string): unknown {
    try {
      // Simple variable substitution for expressions like:
      // - "variables.someVar"
      // - "steps.stepId.property"
      // - "env.NODE_ENV"
      
      if (expression.startsWith('variables.')) {
        const varPath = expression.substring('variables.'.length);
        return this.getNestedValue(this.variables, varPath);
      }
      
      if (expression.startsWith('steps.')) {
        const stepPath = expression.substring('steps.'.length);
        const [stepId, ...propertyPath] = stepPath.split('.');
        const stepOutput = this.getStepOutput(stepId);
        
        if (propertyPath.length === 0) {
          return stepOutput;
        }
        
        return this.getNestedValue(stepOutput, propertyPath.join('.'));
      }
      
      if (expression.startsWith('env.')) {
        const envVar = expression.substring('env.'.length);
        return this.environmentVariables[envVar];
      }
      
      // For now, return the expression as-is if not recognized
      // In a full implementation, this could use a proper expression parser
      return expression;
      
    } catch (error) {
      this.log(`Failed to evaluate expression "${expression}": ${error}`, 'warn');
      return undefined;
    }
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    if (!obj || typeof obj !== 'object') {
      return undefined;
    }
    
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' ? current[key] : undefined;
    }, obj);
  }
}

/**
 * Snapshot of workflow context state for persistence/restoration
 */
export interface WorkflowContextSnapshot {
  workflowId: string;
  currentStepId: string | null;
  variables: Record<string, unknown>;
  stepOutputs: Record<string, unknown>;
  environmentVariables: Record<string, string>;
  logs: LogEntry[];
  startTime: Date;
  snapshotTime: Date;
}