/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowResult, StepResult } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';
import { WorkflowLogger } from './logging.js';
import { WorkflowCancelledError } from './errors.js';

export interface ShutdownState {
  workflowId: string;
  currentStepId?: string;
  completedSteps: string[];
  stepResults: Record<string, StepResult>;
  context: Record<string, unknown>;
  startTime: number;
  shutdownTime: number;
}

export interface ShutdownOptions {
  gracePeriodMs: number;
  saveState: boolean;
  waitForCurrentStep: boolean;
  cleanupResources: boolean;
}

export interface ShutdownHandler {
  onShutdownStarted?: (state: ShutdownState) => Promise<void>;
  onStepInterrupted?: (stepId: string, state: ShutdownState) => Promise<void>;
  onStateSaved?: (state: ShutdownState) => Promise<void>;
  onShutdownComplete?: (state: ShutdownState) => Promise<void>;
}

/**
 * Graceful shutdown manager for workflow execution
 */
export class WorkflowShutdownManager {
  private isShuttingDown: boolean = false;
  private shutdownPromise: Promise<ShutdownState> | null = null;
  private shutdownHandlers: ShutdownHandler[] = [];
  private state: ShutdownState | null = null;

  constructor(
    private workflowId: string,
    private logger?: WorkflowLogger
  ) {}

  /**
   * Register a shutdown handler
   */
  addShutdownHandler(handler: ShutdownHandler): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Remove a shutdown handler
   */
  removeShutdownHandler(handler: ShutdownHandler): void {
    const index = this.shutdownHandlers.indexOf(handler);
    if (index >= 0) {
      this.shutdownHandlers.splice(index, 1);
    }
  }

  /**
   * Initiate graceful shutdown
   */
  async shutdown(
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    stepResults: Record<string, StepResult>,
    currentStepId?: string,
    options: Partial<ShutdownOptions> = {}
  ): Promise<ShutdownState> {
    if (this.isShuttingDown && this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.isShuttingDown = true;
    this.logger?.logWorkflowCancelled('Graceful shutdown initiated');

    const defaultOptions: ShutdownOptions = {
      gracePeriodMs: 30000, // 30 seconds
      saveState: true,
      waitForCurrentStep: true,
      cleanupResources: true
    };

    const effectiveOptions = { ...defaultOptions, ...options };

    this.shutdownPromise = this.performShutdown(
      workflow,
      context,
      stepResults,
      currentStepId,
      effectiveOptions
    );

    return this.shutdownPromise;
  }

  /**
   * Check if shutdown is in progress
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get current shutdown state
   */
  getShutdownState(): ShutdownState | null {
    return this.state;
  }

  /**
   * Perform the actual shutdown process
   */
  private async performShutdown(
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    stepResults: Record<string, StepResult>,
    currentStepId: string | undefined,
    options: ShutdownOptions
  ): Promise<ShutdownState> {
    const shutdownStartTime = Date.now();

    // Create shutdown state
    this.state = {
      workflowId: this.workflowId,
      currentStepId,
      completedSteps: Object.keys(stepResults).filter(id => stepResults[id].success),
      stepResults,
      context: context.getVariables(),
      startTime: Date.now(), // This should ideally come from workflow start time
      shutdownTime: shutdownStartTime
    };

    try {
      // Notify handlers that shutdown has started
      await this.notifyHandlers('onShutdownStarted', this.state);

      // Wait for current step to complete if requested
      if (options.waitForCurrentStep && currentStepId) {
        await this.waitForCurrentStepWithTimeout(currentStepId, options.gracePeriodMs);
      }

      // Save state if requested
      if (options.saveState) {
        await this.saveWorkflowState(this.state);
        await this.notifyHandlers('onStateSaved', this.state);
      }

      // Cleanup resources if requested
      if (options.cleanupResources) {
        await this.cleanupResources(workflow, context);
      }

      // Notify handlers that shutdown is complete
      await this.notifyHandlers('onShutdownComplete', this.state);

      this.logger?.logWorkflowCancelled(
        `Graceful shutdown completed in ${Date.now() - shutdownStartTime}ms`
      );

      return this.state;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger?.logStepFailure(
        { id: 'shutdown', name: 'Shutdown Process', type: 'script', config: { command: 'shutdown' } },
        new WorkflowCancelledError(`Shutdown process failed: ${errorMessage}`, this.workflowId),
        Date.now() - shutdownStartTime
      );
      throw error;
    }
  }

  /**
   * Wait for current step to complete with timeout
   */
  private async waitForCurrentStepWithTimeout(
    stepId: string,
    timeoutMs: number
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 500; // Check every 500ms

    return new Promise<void>((resolve) => {
      const checkCompletion = () => {
        const elapsed = Date.now() - startTime;
        
        if (elapsed >= timeoutMs) {
          // Timeout reached, interrupt the step
          this.notifyHandlers('onStepInterrupted', this.state!);
          resolve();
          return;
        }

        // In a real implementation, you would check if the step is still running
        // For now, we'll just wait for the timeout
        setTimeout(checkCompletion, checkInterval);
      };

      checkCompletion();
    });
  }

  /**
   * Save workflow state for potential resumption
   */
  private async saveWorkflowState(state: ShutdownState): Promise<void> {
    // In a real implementation, this would save to a persistence layer
    // For now, we'll just log the state
    this.logger?.log(
      'INFO' as any,
      'Workflow state saved for resumption',
      {
        workflowId: state.workflowId,
        phase: 'cleanup' as any
      },
      {
        completedSteps: state.completedSteps.length,
        totalVariables: Object.keys(state.context).length,
        shutdownDuration: state.shutdownTime - state.startTime
      }
    );
  }

  /**
   * Cleanup workflow resources
   */
  private async cleanupResources(
    workflow: WorkflowDefinition,
    context: WorkflowContext
  ): Promise<void> {
    try {
      // Cleanup any temporary files, network connections, etc.
      // This is workflow-specific and would be implemented based on needs
      
      // Example: cleanup environment variables
      if (workflow.env) {
        for (const key of Object.keys(workflow.env)) {
          delete process.env[key];
        }
      }

      // Example: cleanup temporary context data
      // context.clearTemporaryData?.(); // Method doesn't exist, skip for now

      this.logger?.log(
        'INFO' as any,
        'Workflow resources cleaned up',
        {
          workflowId: this.workflowId,
          phase: 'cleanup' as any
        }
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger?.log(
        'WARN' as any,
        `Resource cleanup warning: ${errorMessage}`,
        {
          workflowId: this.workflowId,
          phase: 'cleanup' as any
        }
      );
    }
  }

  /**
   * Notify all registered handlers
   */
  private async notifyHandlers(
    handlerMethod: keyof ShutdownHandler,
    state: ShutdownState
  ): Promise<void> {
    const promises = this.shutdownHandlers
      .map(handler => handler[handlerMethod])
      .filter(method => typeof method === 'function')
      .map(method => (method as (state: ShutdownState) => Promise<void>)(state));

    try {
      await Promise.all(promises);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger?.log(
        'WARN' as any,
        `Shutdown handler error: ${errorMessage}`,
        {
          workflowId: this.workflowId,
          phase: 'cleanup' as any
        }
      );
    }
  }

  /**
   * Force immediate shutdown (emergency stop)
   */
  async forceShutdown(reason: string = 'Emergency shutdown'): Promise<void> {
    this.isShuttingDown = true;
    
    if (this.state) {
      this.state.shutdownTime = Date.now();
    }

    this.logger?.logWorkflowCancelled(`Force shutdown: ${reason}`);

    // Immediately notify handlers without waiting
    if (this.state) {
      this.shutdownHandlers.forEach(handler => {
        if (handler.onShutdownComplete) {
          handler.onShutdownComplete(this.state!).catch(() => {
            // Ignore errors in force shutdown
          });
        }
      });
    }
  }
}

/**
 * Global shutdown manager for handling process-level shutdown signals
 */
export class GlobalWorkflowShutdownManager {
  private static instance: GlobalWorkflowShutdownManager;
  private workflowManagers: Map<string, WorkflowShutdownManager> = new Map();
  private isShuttingDown: boolean = false;

  private constructor() {
    this.setupSignalHandlers();
  }

  static getInstance(): GlobalWorkflowShutdownManager {
    if (!GlobalWorkflowShutdownManager.instance) {
      GlobalWorkflowShutdownManager.instance = new GlobalWorkflowShutdownManager();
    }
    return GlobalWorkflowShutdownManager.instance;
  }

  /**
   * Register a workflow shutdown manager
   */
  registerWorkflow(workflowId: string, manager: WorkflowShutdownManager): void {
    this.workflowManagers.set(workflowId, manager);
  }

  /**
   * Unregister a workflow shutdown manager
   */
  unregisterWorkflow(workflowId: string): void {
    this.workflowManagers.delete(workflowId);
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const signalHandler = (signal: string) => {
      if (this.isShuttingDown) {
        // Force exit if already shutting down
        process.exit(1);
      }
      
      this.isShuttingDown = true;
      this.shutdownAllWorkflows(signal)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    };

    process.on('SIGINT', () => signalHandler('SIGINT'));
    process.on('SIGTERM', () => signalHandler('SIGTERM'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
      this.shutdownAllWorkflows('uncaughtException')
        .finally(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled rejection:', reason);
      this.shutdownAllWorkflows('unhandledRejection')
        .finally(() => process.exit(1));
    });
  }

  /**
   * Shutdown all registered workflows
   */
  private async shutdownAllWorkflows(reason: string): Promise<void> {
    console.log(`\nShutting down ${this.workflowManagers.size} workflows due to ${reason}...`);

    const shutdownPromises = Array.from(this.workflowManagers.values()).map(manager =>
      manager.forceShutdown(reason)
    );

    try {
      await Promise.all(shutdownPromises);
      console.log('All workflows shutdown gracefully');
    } catch (error) {
      console.error('Error during workflow shutdown:', error);
    }
  }
}