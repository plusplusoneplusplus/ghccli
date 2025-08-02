/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowResult, WorkflowExecutionContext, StepResult } from './types.js';
import { DependencyResolver } from './DependencyResolver.js';
import { WorkflowContext } from './WorkflowContext.js';
import { StepExecutor } from './StepExecutor.js';
import { ScriptStepExecutor } from './ScriptStepExecutor.js';
import { AgentStepExecutor } from './AgentStepExecutor.js';
import { WorkflowStatusReporter, WorkflowExecutionReport } from './WorkflowStatusReporter.js';
import { ParallelExecutor } from './ParallelExecutor.js';

export enum WorkflowStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface WorkflowExecutionOptions {
  timeout?: number;
  continueOnError?: boolean;
  variables?: Record<string, unknown>;
  parallelEnabled?: boolean;
  maxConcurrency?: number;
}

export class WorkflowRunner {
  private dependencyResolver: DependencyResolver;
  private stepExecutors: Map<string, StepExecutor>;
  private parallelExecutor: ParallelExecutor;
  private status: WorkflowStatus = WorkflowStatus.PENDING;
  private context: WorkflowContext | null = null;
  private statusReporter: WorkflowStatusReporter = new WorkflowStatusReporter();
  private startTime: number = 0;
  private cancelled: boolean = false;

  constructor() {
    this.dependencyResolver = new DependencyResolver();
    this.stepExecutors = new Map();
    
    // Register built-in step executors
    this.registerStepExecutor('script', new ScriptStepExecutor());
    this.registerStepExecutor('agent', new AgentStepExecutor());
    
    // Initialize parallel executor
    this.parallelExecutor = new ParallelExecutor(this.stepExecutors);
  }

  /**
   * Register a custom step executor for a specific step type
   */
  registerStepExecutor(type: string, executor: StepExecutor): void {
    this.stepExecutors.set(type, executor);
    // Reinitialize parallel executor with updated executors
    this.parallelExecutor = new ParallelExecutor(this.stepExecutors);
  }

  /**
   * Execute a workflow definition
   */
  async execute(
    workflow: WorkflowDefinition,
    options: WorkflowExecutionOptions = {}
  ): Promise<WorkflowResult> {
    this.startTime = Date.now();
    this.status = WorkflowStatus.RUNNING;
    this.cancelled = false;

    try {
      // Create workflow context
      this.context = new WorkflowContext(
        workflow.name,
        options.variables || {},
        workflow.env || {}
      );

      // Initialize status reporter
      this.statusReporter.initialize(workflow, this.context);
      this.statusReporter.updateWorkflowStatus(WorkflowStatus.RUNNING);

      // Determine execution mode
      const shouldUseParallelExecution = this.shouldUseParallelExecution(workflow, options);
      
      let stepResults: Record<string, StepResult>;
      
      if (shouldUseParallelExecution) {
        stepResults = await this.executeParallel(workflow, options);
      } else {
        stepResults = await this.executeSequential(workflow, options);
      }

      // Check if all steps succeeded
      const failedSteps = Object.entries(stepResults)
        .filter(([, result]) => !result.success)
        .map(([stepId]) => stepId);

      const success = failedSteps.length === 0;
      this.status = success ? WorkflowStatus.COMPLETED : WorkflowStatus.FAILED;
      this.statusReporter.updateWorkflowStatus(this.status);

      return {
        success,
        stepResults,
        executionTime: Date.now() - this.startTime,
        error: failedSteps.length > 0 ? `Failed steps: ${failedSteps.join(', ')}` : undefined,
        parallelStats: shouldUseParallelExecution ? this.parallelExecutor.getParallelStats() : undefined
      };

    } catch (error) {
      this.status = WorkflowStatus.FAILED;
      this.statusReporter.updateWorkflowStatus(WorkflowStatus.FAILED);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        stepResults: {},
        executionTime: Date.now() - this.startTime,
        error: errorMessage
      };
    }
  }

  /**
   * Cancel the current workflow execution
   */
  cancel(): void {
    this.cancelled = true;
    this.status = WorkflowStatus.CANCELLED;
    this.statusReporter.updateWorkflowStatus(WorkflowStatus.CANCELLED);
  }

  /**
   * Get current execution status
   */
  getStatus(): WorkflowStatus {
    return this.status;
  }

  /**
   * Get current workflow context
   */
  getContext(): WorkflowContext | null {
    return this.context;
  }

  /**
   * Get current execution report
   */
  getExecutionReport(workflow: WorkflowDefinition, result?: WorkflowResult): WorkflowExecutionReport {
    return this.statusReporter.getExecutionReport(workflow, result);
  }

  /**
   * Generate a summary report as formatted string
   */
  generateSummaryReport(workflow: WorkflowDefinition, result?: WorkflowResult): string {
    return this.statusReporter.generateSummaryReport(workflow, result);
  }

  /**
   * Generate a detailed JSON report
   */
  generateDetailedReport(workflow: WorkflowDefinition, result?: WorkflowResult): string {
    return this.statusReporter.generateDetailedReport(workflow, result);
  }

  /**
   * Get execution progress as percentage
   */
  getProgress(): number {
    return this.statusReporter.getProgress();
  }

  /**
   * Determine if parallel execution should be used
   */
  private shouldUseParallelExecution(
    workflow: WorkflowDefinition,
    options: WorkflowExecutionOptions
  ): boolean {
    // Check if parallel execution is explicitly disabled
    if (options.parallelEnabled === false) {
      return false;
    }

    // Check if workflow has parallel configuration
    if (workflow.parallel?.enabled === false) {
      return false;
    }

    // Check if any steps have parallel configuration
    const hasParallelSteps = workflow.steps.some(step => step.parallel?.enabled);
    
    // Use parallel execution if explicitly enabled or if there are parallel steps
    return options.parallelEnabled === true || 
           workflow.parallel?.enabled === true || 
           hasParallelSteps;
  }

  /**
   * Execute workflow using parallel execution
   */
  private async executeParallel(
    workflow: WorkflowDefinition,
    options: WorkflowExecutionOptions
  ): Promise<Record<string, StepResult>> {
    const defaultMaxConcurrency = options.maxConcurrency || 
                                  workflow.parallel?.defaultMaxConcurrency || 
                                  4;

    const parallelGroups = this.dependencyResolver.getEnhancedParallelGroups(
      workflow.steps,
      defaultMaxConcurrency
    );

    return await this.parallelExecutor.executeParallelGroups(
      parallelGroups,
      this.context!,
      workflow.parallel,
      (stepId) => this.statusReporter.markStepStarted(stepId),
      (stepId, result) => {
        this.context!.setStepOutput(stepId, result.output);
        this.statusReporter.markStepCompleted(stepId, result.output);
      },
      (stepId, error) => this.statusReporter.markStepFailed(stepId, error),
      () => this.cancelled
    );
  }

  /**
   * Execute workflow using sequential execution (legacy mode)
   */
  private async executeSequential(
    workflow: WorkflowDefinition,
    options: WorkflowExecutionOptions
  ): Promise<Record<string, StepResult>> {
    // Resolve step execution order
    const executionOrder = this.dependencyResolver.resolve(workflow.steps);
    const stepResults: Record<string, StepResult> = {};
    
    for (const step of executionOrder) {
      if (this.cancelled) {
        this.status = WorkflowStatus.CANCELLED;
        this.statusReporter.updateWorkflowStatus(WorkflowStatus.CANCELLED);
        throw new Error('Workflow execution was cancelled');
      }

      // Check if step should be executed based on conditions
      if (step.condition && !this.evaluateCondition(step.condition)) {
        continue;
      }

      // Check if all dependencies succeeded (unless continueOnError is true)
      if (step.dependsOn && !options.continueOnError && !step.continueOnError) {
        const failedDeps = step.dependsOn.filter(depId => !stepResults[depId]?.success);
        if (failedDeps.length > 0) {
          const errorMsg = `Dependencies failed: ${failedDeps.join(', ')}`;
          stepResults[step.id] = {
            success: false,
            error: errorMsg
          };
          this.statusReporter.markStepSkipped(step.id, errorMsg);
          continue;
        }
      }

      const stepStartTime = Date.now();
      
      try {
        // Get appropriate executor
        const executor = this.stepExecutors.get(step.type);
        if (!executor) {
          throw new Error(`No executor found for step type: ${step.type}`);
        }

        // Mark step as started
        this.context!.setCurrentStepId(step.id);
        this.statusReporter.markStepStarted(step.id);

        // Execute step
        const stepTimeout = step.config.timeout || workflow.timeout || options.timeout;
        const stepResult = await this.executeWithTimeout(
          () => executor.execute(step, this.context!),
          stepTimeout
        );

        stepResults[step.id] = {
          success: true,
          output: stepResult,
          executionTime: Date.now() - stepStartTime
        };

        // Update context with step output
        this.context!.setStepOutput(step.id, stepResult);
        this.statusReporter.markStepCompleted(step.id, stepResult);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const executionTime = Date.now() - stepStartTime;
        stepResults[step.id] = {
          success: false,
          error: errorMessage,
          executionTime
        };

        this.statusReporter.markStepFailed(step.id, errorMessage);

        // Stop execution if continueOnError is false
        if (!step.continueOnError && !options.continueOnError) {
          this.status = WorkflowStatus.FAILED;
          this.statusReporter.updateWorkflowStatus(WorkflowStatus.FAILED);
          break; // Break the loop instead of throwing
        }
      }
    }

    return stepResults;
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
   * For now, this is a simple implementation
   * In the future, this could support more complex expressions
   */
  private evaluateCondition(condition: string): boolean {
    // Simple condition evaluation - can be extended
    // For testing: "false" evaluates to false, everything else evaluates to true
    // In practice, this would evaluate expressions like:
    // - "env.NODE_ENV === 'production'"
    // - "variables.skipTests !== true"
    // - "steps.analyze-code.success === true"
    
    try {
      // Placeholder implementation for testing
      if (condition === 'false') {
        return false;
      }
      return condition.length > 0;
    } catch {
      return false;
    }
  }
}