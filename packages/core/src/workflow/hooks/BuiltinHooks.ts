/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowHooks } from './WorkflowHooks.js';
import { 
  type WorkflowStartEventData,
  type WorkflowCompleteEventData,
  type WorkflowErrorEventData,
  type StepEventData,
  type StepCompleteEventData,
  type StepErrorEventData,
  type StepSkipEventData,
  type StepRetryEventData
} from './HookSystem.js';

export interface BuiltinHooksOptions {
  enableLoggingHooks?: boolean;
  enableMetricsHooks?: boolean;
  enableNotificationHooks?: boolean;
  enableValidationHooks?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  metricsPrefix?: string;
}

export class BuiltinHooks {
  private workflowHooks: WorkflowHooks;
  private options: Required<BuiltinHooksOptions>;
  private registeredHookIds: string[] = [];

  constructor(workflowHooks: WorkflowHooks, options: BuiltinHooksOptions = {}) {
    this.workflowHooks = workflowHooks;
    this.options = {
      enableLoggingHooks: options.enableLoggingHooks ?? true,
      enableMetricsHooks: options.enableMetricsHooks ?? true,
      enableNotificationHooks: options.enableNotificationHooks ?? false,
      enableValidationHooks: options.enableValidationHooks ?? true,
      logLevel: options.logLevel ?? 'info',
      metricsPrefix: options.metricsPrefix ?? 'workflow'
    };
  }

  /**
   * Register all built-in hooks based on configuration
   */
  registerAll(): void {
    if (this.options.enableLoggingHooks) {
      this.registerLoggingHooks();
    }
    
    if (this.options.enableMetricsHooks) {
      this.registerMetricsHooks();
    }
    
    if (this.options.enableNotificationHooks) {
      this.registerNotificationHooks();
    }
    
    if (this.options.enableValidationHooks) {
      this.registerValidationHooks();
    }
  }

  /**
   * Unregister all built-in hooks
   */
  unregisterAll(): void {
    for (const hookId of this.registeredHookIds) {
      this.workflowHooks.removeHook(hookId);
    }
    this.registeredHookIds = [];
  }

  /**
   * Register logging hooks for workflow events
   */
  private registerLoggingHooks(): void {
    // Workflow start logging
    const workflowStartId = this.workflowHooks.onWorkflowStart(
      (data: WorkflowStartEventData) => {
        this.log('info', `🚀 Workflow started: ${data.workflow.name} (ID: ${data.workflowId})`);
        this.log('debug', `Workflow options:`, data.options);
      },
      { id: 'builtin-logging-workflow-start', priority: 100 }
    );
    this.registeredHookIds.push(workflowStartId);

    // Workflow complete logging
    const workflowCompleteId = this.workflowHooks.onWorkflowComplete(
      (data: WorkflowCompleteEventData) => {
        const status = data.result.success ? '✅ completed successfully' : '❌ failed';
        this.log('info', `Workflow ${status}: ${data.workflow.name} (${data.result.executionTime}ms)`);
        
        if (!data.result.success && data.result.error) {
          this.log('error', `Workflow error: ${data.result.error}`);
        }
      },
      { id: 'builtin-logging-workflow-complete', priority: 100 }
    );
    this.registeredHookIds.push(workflowCompleteId);

    // Workflow error logging
    const workflowErrorId = this.workflowHooks.onWorkflowError(
      (data: WorkflowErrorEventData) => {
        this.log('error', `💥 Workflow error in ${data.workflow.name}: ${data.error.message}`);
        this.log('debug', 'Error stack:', data.error.stack);
      },
      { id: 'builtin-logging-workflow-error', priority: 100 }
    );
    this.registeredHookIds.push(workflowErrorId);

    // Step start logging
    const stepStartId = this.workflowHooks.onStepStart(
      (data: StepEventData) => {
        this.log('debug', `📋 Step started: ${data.step.name} (${data.step.id})`);
      },
      { id: 'builtin-logging-step-start', priority: 90 }
    );
    this.registeredHookIds.push(stepStartId);

    // Step complete logging
    const stepCompleteId = this.workflowHooks.onStepComplete(
      (data: StepCompleteEventData) => {
        const duration = data.result.executionTime ? ` (${data.result.executionTime}ms)` : '';
        this.log('debug', `✅ Step completed: ${data.step.name}${duration}`);
      },
      { id: 'builtin-logging-step-complete', priority: 90 }
    );
    this.registeredHookIds.push(stepCompleteId);

    // Step error logging
    const stepErrorId = this.workflowHooks.onStepError(
      (data: StepErrorEventData) => {
        const retryInfo = data.retryCount !== undefined ? ` (retry ${data.retryCount})` : '';
        this.log('warn', `❌ Step failed: ${data.step.name}${retryInfo} - ${data.error.message}`);
      },
      { id: 'builtin-logging-step-error', priority: 90 }
    );
    this.registeredHookIds.push(stepErrorId);

    // Step skip logging
    const stepSkipId = this.workflowHooks.onStepSkip(
      (data: StepSkipEventData) => {
        this.log('info', `⏭️ Step skipped: ${data.step.name} - ${data.reason}`);
      },
      { id: 'builtin-logging-step-skip', priority: 90 }
    );
    this.registeredHookIds.push(stepSkipId);

    // Step retry logging
    const stepRetryId = this.workflowHooks.onStepRetry(
      (data: StepRetryEventData) => {
        this.log('warn', `🔄 Step retry: ${data.step.name} (${data.retryCount}/${data.maxRetries}) - ${data.error.message}`);
      },
      { id: 'builtin-logging-step-retry', priority: 90 }
    );
    this.registeredHookIds.push(stepRetryId);
  }

  /**
   * Register metrics collection hooks
   */
  private registerMetricsHooks(): void {
    const metrics = new Map<string, any>();

    // Workflow start metrics
    const workflowStartId = this.workflowHooks.onWorkflowStart(
      (data: WorkflowStartEventData) => {
        metrics.set(`${this.options.metricsPrefix}.workflows.total`, 
          (metrics.get(`${this.options.metricsPrefix}.workflows.total`) || 0) + 1);
        metrics.set(`${this.options.metricsPrefix}.workflows.${data.workflowId}.start_time`, data.timestamp);
      },
      { id: 'builtin-metrics-workflow-start', priority: 80 }
    );
    this.registeredHookIds.push(workflowStartId);

    // Workflow complete metrics
    const workflowCompleteId = this.workflowHooks.onWorkflowComplete(
      (data: WorkflowCompleteEventData) => {
        const metricKey = data.result.success ? 'successful' : 'failed';
        metrics.set(`${this.options.metricsPrefix}.workflows.${metricKey}`, 
          (metrics.get(`${this.options.metricsPrefix}.workflows.${metricKey}`) || 0) + 1);
        
        metrics.set(`${this.options.metricsPrefix}.workflows.${data.workflowId}.duration`, 
          data.result.executionTime);
        
        // Calculate step metrics
        const stepCount = Object.keys(data.result.stepResults).length;
        const successfulSteps = Object.values(data.result.stepResults).filter((result: any) => result.success).length;
        
        metrics.set(`${this.options.metricsPrefix}.workflows.${data.workflowId}.steps.total`, stepCount);
        metrics.set(`${this.options.metricsPrefix}.workflows.${data.workflowId}.steps.successful`, successfulSteps);
        metrics.set(`${this.options.metricsPrefix}.workflows.${data.workflowId}.steps.failed`, stepCount - successfulSteps);
      },
      { id: 'builtin-metrics-workflow-complete', priority: 80 }
    );
    this.registeredHookIds.push(workflowCompleteId);

    // Step execution metrics
    const stepCompleteId = this.workflowHooks.onStepComplete(
      (data: StepCompleteEventData) => {
        metrics.set(`${this.options.metricsPrefix}.steps.total`, 
          (metrics.get(`${this.options.metricsPrefix}.steps.total`) || 0) + 1);
        
        if (data.result.executionTime) {
          const durations = metrics.get(`${this.options.metricsPrefix}.steps.durations`) || [];
          durations.push(data.result.executionTime);
          metrics.set(`${this.options.metricsPrefix}.steps.durations`, durations);
        }
      },
      { id: 'builtin-metrics-step-complete', priority: 80 }
    );
    this.registeredHookIds.push(stepCompleteId);
  }

  /**
   * Register notification hooks (placeholder for external integrations)
   */
  private registerNotificationHooks(): void {
    // Workflow error notifications
    const workflowErrorId = this.workflowHooks.onWorkflowError(
      async (data: WorkflowErrorEventData) => {
        // This could integrate with external notification systems like Slack, email, etc.
        console.warn(`🔔 Notification: Workflow '${data.workflow.name}' failed with error: ${data.error.message}`);
      },
      { id: 'builtin-notification-workflow-error', priority: 70, async: true }
    );
    this.registeredHookIds.push(workflowErrorId);

    // Workflow complete notifications for long-running workflows
    const workflowCompleteId = this.workflowHooks.onWorkflowComplete(
      async (data: WorkflowCompleteEventData) => {
        if (data.result.executionTime > 60000) { // Notify if workflow took more than 60 seconds
          const status = data.result.success ? 'completed' : 'failed';
          console.info(`🔔 Notification: Long-running workflow '${data.workflow.name}' ${status} after ${data.result.executionTime}ms`);
        }
      },
      { id: 'builtin-notification-workflow-complete', priority: 70, async: true }
    );
    this.registeredHookIds.push(workflowCompleteId);
  }

  /**
   * Register validation hooks
   */
  private registerValidationHooks(): void {
    // Validate step dependencies before execution
    const stepStartId = this.workflowHooks.onStepStart(
      (data: StepEventData) => {
        if (data.step.dependsOn) {
          for (const dependency of data.step.dependsOn) {
            const dependencyOutput = data.context.getStepOutput(dependency);
            if (dependencyOutput === undefined) {
              this.log('warn', `⚠️ Step '${data.step.id}' depends on '${dependency}' but no output found`);
            }
          }
        }
      },
      { id: 'builtin-validation-step-dependencies', priority: 95 }
    );
    this.registeredHookIds.push(stepStartId);

    // Validate workflow configuration
    const workflowStartId = this.workflowHooks.onWorkflowStart(
      (data: WorkflowStartEventData) => {
        const { workflow } = data;
        
        // Check for duplicate step IDs
        const stepIds = new Set<string>();
        for (const step of workflow.steps) {
          if (stepIds.has(step.id)) {
            this.log('error', `⚠️ Duplicate step ID found: ${step.id}`);
          }
          stepIds.add(step.id);
        }

        // Check for circular dependencies
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCycle = (stepId: string): boolean => {
          if (recursionStack.has(stepId)) {
            return true;
          }
          if (visited.has(stepId)) {
            return false;
          }

          visited.add(stepId);
          recursionStack.add(stepId);

          const step = workflow.steps.find((s: any) => s.id === stepId);
          if (step?.dependsOn) {
            for (const dependency of step.dependsOn) {
              if (hasCycle(dependency)) {
                return true;
              }
            }
          }

          recursionStack.delete(stepId);
          return false;
        };

        for (const step of workflow.steps) {
          if (hasCycle(step.id)) {
            this.log('error', `⚠️ Circular dependency detected involving step: ${step.id}`);
            break;
          }
        }
      },
      { id: 'builtin-validation-workflow-config', priority: 95 }
    );
    this.registeredHookIds.push(workflowStartId);
  }

  /**
   * Get registered hook IDs
   */
  getRegisteredHookIds(): string[] {
    return [...this.registeredHookIds];
  }

  /**
   * Log a message based on configured log level
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const currentLevel = levels[this.options.logLevel];
    const messageLevel = levels[level];

    if (messageLevel >= currentLevel) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      
      if (data !== undefined) {
        console[level](`${prefix} ${message}`, data);
      } else {
        console[level](`${prefix} ${message}`);
      }
    }
  }
}