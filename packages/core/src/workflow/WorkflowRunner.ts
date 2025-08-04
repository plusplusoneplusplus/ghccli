/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowResult, WorkflowExecutionContext, StepResult, WorkflowStep } from './types.js';
import { DependencyResolver } from './DependencyResolver.js';
import { WorkflowContext } from './WorkflowContext.js';
import { StepExecutor } from './StepExecutor.js';
import { ScriptStepExecutor } from './ScriptStepExecutor.js';
import { AgentStepExecutor, AgentStepExecutorConfig } from './AgentStepExecutor.js';
import { WorkflowStatusReporter, WorkflowExecutionReport } from './WorkflowStatusReporter.js';
import { ParallelExecutor } from './ParallelExecutor.js';
import { Config } from '../config/config.js';
import { 
  WorkflowError, 
  WorkflowStepError, 
  WorkflowTimeoutError,
  WorkflowCancelledError,
  WorkflowExecutorError,
  createWorkflowError 
} from './errors.js';
import { WorkflowLogger, createWorkflowLogger } from './logging.js';
import { WorkflowRetryManager, createWorkflowRetryManager, WorkflowRetryOptions } from './retry.js';
import { WorkflowShutdownManager, GlobalWorkflowShutdownManager } from './shutdown.js';
import { WorkflowMetricsCollector, createWorkflowMetricsCollector, WorkflowExecutionMetrics } from './metrics.js';
import { PluginRegistry, PluginLoader } from './plugins/index.js';
import { WorkflowHooks, BuiltinHooks, type WorkflowHooksOptions, type BuiltinHooksOptions } from './hooks/index.js';
import { WorkflowState, StepStatus } from './persistence/WorkflowState.js';
import { StatePersistence, PersistenceConfig } from './persistence/StatePersistence.js';

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
  enableLogging?: boolean;
  enableTelemetry?: boolean;
  enableMetrics?: boolean;
  retryOptions?: WorkflowRetryOptions;
  enableGracefulShutdown?: boolean;
  pluginRegistry?: PluginRegistry;
  enablePluginAutoDiscovery?: boolean;
  pluginSearchPaths?: string[];
  enableHooks?: boolean;
  hooksOptions?: WorkflowHooksOptions;
  builtinHooksOptions?: BuiltinHooksOptions;
  enablePersistence?: boolean;
  persistenceConfig?: PersistenceConfig;
  resumeFromState?: boolean;
  checkpointInterval?: number; // Save state every N steps
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
  private config?: Config;
  private logger?: WorkflowLogger;
  private retryManager?: WorkflowRetryManager;
  private shutdownManager?: WorkflowShutdownManager;
  private metricsCollector?: WorkflowMetricsCollector;
  private currentWorkflowId?: string;
  private pluginRegistry?: PluginRegistry;
  private pluginLoader?: PluginLoader;
  private workflowHooks?: WorkflowHooks;
  private builtinHooks?: BuiltinHooks;
  private workflowState?: WorkflowState;
  private statePersistence?: StatePersistence;
  private checkpointInterval: number = 1;
  private stepExecutionCount: number = 0;

  constructor(config?: Config) {
    this.dependencyResolver = new DependencyResolver();
    this.stepExecutors = new Map();
    this.config = config;
    
    // Register built-in step executors
    this.registerStepExecutor('script', new ScriptStepExecutor());
    
    // Only register AgentStepExecutor if we have a config
    if (config) {
      const agentExecutorConfig: AgentStepExecutorConfig = {
        config,
        defaultTimeout: 60000,
        maxRounds: 10
      };
      this.registerStepExecutor('agent', new AgentStepExecutor(agentExecutorConfig));
    }
    
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
   * Initialize plugin system with optional auto-discovery
   */
  async initializePlugins(options: WorkflowExecutionOptions = {}): Promise<void> {
    if (options.pluginRegistry) {
      this.pluginRegistry = options.pluginRegistry;
    } else {
      this.pluginRegistry = new PluginRegistry({
        enableSandboxing: true,
        maxPlugins: 50,
        allowDuplicateStepTypes: false
      });
    }

    if (options.enablePluginAutoDiscovery !== false) {
      this.pluginLoader = new PluginLoader(this.pluginRegistry, {
        searchPaths: options.pluginSearchPaths || ['./plugins', './node_modules'],
        fileExtensions: ['.js', '.mjs', '.ts'],
        maxDepth: 3,
        ignoreNodeModules: true,
        includePackageJson: true
      });

      const loadResult = await this.pluginLoader.loadAllDiscoveredPlugins();
      if (loadResult.loaded > 0) {
        console.log(`Loaded ${loadResult.loaded} plugin(s)`);
      }
      if (loadResult.failed > 0) {
        console.warn(`Failed to load ${loadResult.failed} plugin(s)`);
      }
    }

    this.updateStepExecutorsFromPlugins();
  }

  /**
   * Get the plugin registry instance
   */
  getPluginRegistry(): PluginRegistry | undefined {
    return this.pluginRegistry;
  }

  /**
   * Update step executors with plugin-provided executors
   */
  private updateStepExecutorsFromPlugins(): void {
    if (!this.pluginRegistry) {
      return;
    }

    const supportedStepTypes = this.pluginRegistry.getSupportedStepTypes();
    for (const stepType of supportedStepTypes) {
      const executor = this.pluginRegistry.createStepExecutor(stepType);
      if (executor) {
        this.registerStepExecutor(stepType, executor);
      }
    }
  }

  /**
   * Resume a workflow from saved state
   */
  async resume(
    workflowId: string,
    options: WorkflowExecutionOptions = {}
  ): Promise<WorkflowResult> {
    // Initialize persistence if enabled
    if (options.enablePersistence !== false) {
      this.statePersistence = new StatePersistence(options.persistenceConfig);
      await this.statePersistence.initialize();
    }

    if (!this.statePersistence) {
      throw new Error('State persistence not enabled - cannot resume workflow');
    }

    // Load saved state
    const savedWorkflowState = await this.statePersistence.loadState(workflowId);
    if (!savedWorkflowState || !savedWorkflowState.canResume()) {
      throw new Error(`Cannot resume workflow ${workflowId} - no valid state found`);
    }

    this.workflowState = savedWorkflowState;
    this.currentWorkflowId = workflowId;

    const snapshot = this.workflowState.getSnapshot();
    const workflow = snapshot.definition;

    // Mark as resumed
    this.workflowState.markResumed('User requested resume');
    this.workflowState.updatePausedDuration();

    // Execute workflow starting from where we left off
    return this.executeInternal(workflow, { ...options, resumeFromState: true });
  }

  /**
   * Execute a workflow definition
   */
  async execute(
    workflow: WorkflowDefinition,
    options: WorkflowExecutionOptions = {}
  ): Promise<WorkflowResult> {
    return this.executeInternal(workflow, options);
  }

  /**
   * Internal execute method that handles both new execution and resume
   */
  private async executeInternal(
    workflow: WorkflowDefinition,
    options: WorkflowExecutionOptions = {}
  ): Promise<WorkflowResult> {
    // Handle resuming vs new execution
    const isResuming = options.resumeFromState && this.workflowState;
    
    if (!isResuming) {
      this.startTime = Date.now();
      this.currentWorkflowId = `${workflow.name}-${Date.now()}`;
      this.stepExecutionCount = 0;
    }
    
    this.status = WorkflowStatus.RUNNING;
    this.cancelled = false;

    try {
      // Initialize persistence if enabled
      if (options.enablePersistence !== false && !this.statePersistence) {
        this.statePersistence = new StatePersistence(options.persistenceConfig);
        await this.statePersistence.initialize();
        this.checkpointInterval = options.checkpointInterval || 1;
      }

      // Initialize logging and monitoring
      this.initializeInfrastructure(workflow, options);

      // Initialize plugin system if enabled
      if (options.pluginRegistry || options.enablePluginAutoDiscovery !== false) {
        await this.initializePlugins(options);
      }

      // Create or restore workflow context
      if (isResuming && this.workflowState) {
        const snapshot = this.workflowState.getSnapshot();
        this.context = new WorkflowContext(
          snapshot.context.workflowId,
          snapshot.context.variables,
          snapshot.context.environmentVariables
        );
        this.context.restoreFromSnapshot(snapshot.context);
        
        // Update workflow state status
        this.workflowState.updateWorkflowStatus(WorkflowStatus.RUNNING);
      } else {
        this.context = new WorkflowContext(
          workflow.name,
          options.variables || {},
          workflow.env || {}
        );
        
        // Create new workflow state if persistence is enabled
        if (this.statePersistence) {
          const executionOrder = this.dependencyResolver.resolve(workflow.steps).map(step => step.id);
          this.workflowState = new WorkflowState(
            this.currentWorkflowId!,
            workflow,
            this.context.createSnapshot(),
            executionOrder
          );
          this.workflowState.updateWorkflowStatus(WorkflowStatus.RUNNING);
          await this.statePersistence.saveState(this.workflowState);
        }
      }

      // Initialize hooks system if enabled
      if (options.enableHooks !== false) {
        this.initializeHooks(options);
      }

      // Log workflow start
      this.logger?.initialize(workflow);
      this.logger?.logExecutionStart(options as Record<string, unknown>);

      // Emit workflow start event
      if (this.workflowHooks) {
        await this.workflowHooks.emitWorkflowStart(
          this.currentWorkflowId!,
          workflow,
          this.context,
          options as Record<string, unknown>
        );
      }

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

      const result: WorkflowResult = {
        success,
        stepResults,
        executionTime: Date.now() - this.startTime,
        error: failedSteps.length > 0 ? `Failed steps: ${failedSteps.join(', ')}` : undefined,
        parallelStats: shouldUseParallelExecution ? this.parallelExecutor.getParallelStats() : undefined
      };

      // Complete logging and metrics
      this.logger?.logWorkflowComplete(result);
      const metrics = this.metricsCollector?.complete(result);

      // Add metrics to result if available
      if (metrics) {
        (result as any).metrics = metrics;
      }

      // Update final workflow state
      if (this.workflowState) {
        this.workflowState.updateWorkflowStatus(this.status);
        this.workflowState.updateContext(this.context!.createSnapshot());
        
        // Save final state
        if (this.statePersistence) {
          await this.statePersistence.saveState(this.workflowState);
        }
      }

      // Emit workflow complete event
      if (this.workflowHooks) {
        await this.workflowHooks.emitWorkflowComplete(
          this.currentWorkflowId!,
          workflow,
          this.context,
          result
        );
      }

      return result;

    } catch (error) {
      this.status = WorkflowStatus.FAILED;
      this.statusReporter.updateWorkflowStatus(WorkflowStatus.FAILED);
      
      const workflowError = createWorkflowError(
        error instanceof Error ? error : new Error(String(error)),
        undefined,
        this.currentWorkflowId
      );

      this.logger?.logStepFailure(
        { id: 'workflow', name: workflow.name, type: 'script', config: { command: 'workflow-execution' } },
        workflowError,
        Date.now() - this.startTime
      );

      const result: WorkflowResult = {
        success: false,
        stepResults: {},
        executionTime: Date.now() - this.startTime,
        error: workflowError.message
      };

      // Complete metrics even on failure
      const metrics = this.metricsCollector?.complete(result);
      if (metrics) {
        (result as any).metrics = metrics;
      }

      // Update workflow state on error
      if (this.workflowState) {
        this.workflowState.updateWorkflowStatus(WorkflowStatus.FAILED);
        if (this.context) {
          this.workflowState.updateContext(this.context.createSnapshot());
        }
        
        // Save error state
        if (this.statePersistence) {
          await this.statePersistence.saveState(this.workflowState);
        }
      }

      // Emit workflow error event
      if (this.workflowHooks && this.context) {
        await this.workflowHooks.emitWorkflowError(
          this.currentWorkflowId!,
          workflow,
          this.context,
          workflowError
        );
      }

      return result;
    } finally {
      // Cleanup
      this.cleanupInfrastructure();
    }
  }

  /**
   * Cancel the current workflow execution
   */
  async cancel(reason: string = 'User requested cancellation'): Promise<void> {
    this.cancelled = true;
    this.status = WorkflowStatus.CANCELLED;
    this.statusReporter.updateWorkflowStatus(WorkflowStatus.CANCELLED);
    this.logger?.logWorkflowCancelled(reason);

    // Emit workflow cancelled event
    if (this.workflowHooks && this.context) {
      await this.workflowHooks.emitWorkflowCancelled(
        this.currentWorkflowId!,
        { name: 'current_workflow', version: '1.0.0', steps: [] } as WorkflowDefinition,
        this.context
      );
    }

    // Graceful shutdown if enabled
    if (this.shutdownManager && this.context) {
      try {
        await this.shutdownManager.shutdown(
          { name: 'current_workflow', version: '1.0.0', steps: [] } as WorkflowDefinition,
          this.context,
          {},
          undefined,
          { gracePeriodMs: 5000 }
        );
      } catch (error) {
        // Log error but don't throw as cancellation should succeed
        this.logger?.logStepFailure(
          { id: 'cancel', name: 'Cancel Operation', type: 'script', config: { command: 'cancel' } },
          createWorkflowError(
            error instanceof Error ? error : new Error(String(error)),
            undefined,
            this.currentWorkflowId
          )
        );
      }
    }
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
    
    // If resuming, populate completed step results and start from current position
    let startIndex = 0;
    if (options.resumeFromState && this.workflowState) {
      const snapshot = this.workflowState.getSnapshot();
      
      // Restore completed step results
      for (const [stepId, stepState] of Object.entries(snapshot.stepStates)) {
        if (stepState.status === StepStatus.COMPLETED && stepState.result) {
          stepResults[stepId] = stepState.result;
        }
      }
      
      // Find where to resume from
      const currentStepId = this.workflowState.getCurrentStepId();
      if (currentStepId) {
        startIndex = executionOrder.findIndex(step => step.id === currentStepId);
        if (startIndex === -1) startIndex = 0;
      }
    }
    
    for (let i = startIndex; i < executionOrder.length; i++) {
      const step = executionOrder[i];
      if (this.isCancelledOrShuttingDown()) {
        this.status = WorkflowStatus.CANCELLED;
        this.statusReporter.updateWorkflowStatus(WorkflowStatus.CANCELLED);
        throw new WorkflowCancelledError(
          'Workflow execution was cancelled',
          this.currentWorkflowId,
          step.id
        );
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
          this.logger?.logStepSkipped(step, errorMsg);
          this.metricsCollector?.recordStepSkipped(step, errorMsg);

          // Emit step skip event
          if (this.workflowHooks && this.context) {
            await this.workflowHooks.emitStepSkip(
              this.currentWorkflowId!,
              workflow,
              this.context,
              step,
              errorMsg
            );
          }
          continue;
        }
      }

      const stepStartTime = Date.now();
      
      try {
        // Get appropriate executor
        const executor = this.stepExecutors.get(step.type);
        if (!executor) {
          throw new WorkflowExecutorError(
            `No executor found for step type: ${step.type}`,
            step.type,
            this.currentWorkflowId,
            step.id
          );
        }

        // Mark step as started
        this.context!.setCurrentStepId(step.id);
        this.statusReporter.markStepStarted(step.id);
        this.logger?.logStepStart(step);
        this.metricsCollector?.recordStepStart(step);
        
        // Update workflow state
        if (this.workflowState) {
          this.workflowState.updateStepState(step.id, StepStatus.RUNNING);
        }

        // Emit step start event
        if (this.workflowHooks && this.context) {
          await this.workflowHooks.emitStepStart(
            this.currentWorkflowId!,
            workflow,
            this.context,
            step
          );
        }

        // Execute step with retry logic
        const stepTimeout = step.config.timeout || workflow.timeout || options.timeout;
        const stepResult = await this.executeStepWithRetryAndTimeout(
          () => executor.execute(step, this.context!),
          step,
          stepTimeout
        );

        const result: StepResult = {
          success: true,
          output: stepResult,
          executionTime: Date.now() - stepStartTime
        };

        stepResults[step.id] = result;

        // Update context with step output
        this.context!.setStepOutput(step.id, stepResult);
        this.statusReporter.markStepCompleted(step.id, stepResult);
        this.logger?.logStepComplete(step, result);
        this.metricsCollector?.recordStepComplete(step, result);
        
        // Update workflow state and save checkpoint
        if (this.workflowState) {
          this.workflowState.updateStepState(step.id, StepStatus.COMPLETED, result);
          this.workflowState.updateContext(this.context!.createSnapshot());
          this.workflowState.advanceToNextStep();
          
          // Save state checkpoint periodically
          this.stepExecutionCount++;
          if (this.statePersistence && this.stepExecutionCount % this.checkpointInterval === 0) {
            await this.statePersistence.saveState(this.workflowState);
          }
        }

        // Emit step complete event
        if (this.workflowHooks && this.context) {
          await this.workflowHooks.emitStepComplete(
            this.currentWorkflowId!,
            workflow,
            this.context,
            step,
            result
          );
        }

      } catch (error) {
        const executionTime = Date.now() - stepStartTime;
        const workflowError = createWorkflowError(
          error instanceof Error ? error : new Error(String(error)),
          step,
          this.currentWorkflowId
        );

        const result: StepResult = {
          success: false,
          error: workflowError.message,
          executionTime
        };

        stepResults[step.id] = result;

        this.statusReporter.markStepFailed(step.id, workflowError.message);
        this.logger?.logStepFailure(step, workflowError, executionTime);
        this.metricsCollector?.recordStepFailure(step, workflowError, executionTime);
        
        // Update workflow state for failed step
        if (this.workflowState) {
          this.workflowState.updateStepState(step.id, StepStatus.FAILED, result);
          this.workflowState.updateContext(this.context!.createSnapshot());
          
          // Save state on failure for potential recovery
          if (this.statePersistence) {
            await this.statePersistence.saveState(this.workflowState);
          }
        }

        // Emit step error event
        if (this.workflowHooks && this.context) {
          await this.workflowHooks.emitStepError(
            this.currentWorkflowId!,
            workflow,
            this.context,
            step,
            workflowError
          );
        }

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

  /**
   * Initialize logging, monitoring, and infrastructure
   */
  private initializeInfrastructure(
    workflow: WorkflowDefinition,
    options: WorkflowExecutionOptions
  ): void {
    // Initialize logger
    if (options.enableLogging !== false) {
      this.logger = createWorkflowLogger(
        this.currentWorkflowId!,
        workflow.name,
        options.enableTelemetry !== false
      );
    }

    // Initialize retry manager
    if (options.retryOptions || options.retryOptions !== false) {
      this.retryManager = createWorkflowRetryManager(options.retryOptions);
    }

    // Initialize shutdown manager
    if (options.enableGracefulShutdown !== false) {
      this.shutdownManager = new WorkflowShutdownManager(
        this.currentWorkflowId!,
        this.logger
      );
      
      // Register with global shutdown manager
      GlobalWorkflowShutdownManager.getInstance().registerWorkflow(
        this.currentWorkflowId!,
        this.shutdownManager
      );
    }

    // Initialize metrics collector
    if (options.enableMetrics !== false) {
      this.metricsCollector = createWorkflowMetricsCollector(
        workflow,
        this.currentWorkflowId!
      );
    }
  }

  /**
   * Initialize hooks system
   */
  private initializeHooks(options: WorkflowExecutionOptions): void {
    this.workflowHooks = new WorkflowHooks(options.hooksOptions);
    
    if (options.builtinHooksOptions?.enableLoggingHooks !== false ||
        options.builtinHooksOptions?.enableMetricsHooks !== false ||
        options.builtinHooksOptions?.enableNotificationHooks ||
        options.builtinHooksOptions?.enableValidationHooks !== false) {
      this.builtinHooks = new BuiltinHooks(this.workflowHooks, options.builtinHooksOptions);
      this.builtinHooks.registerAll();
    }
  }

  /**
   * Cleanup infrastructure resources
   */
  private cleanupInfrastructure(): void {
    // Unregister from global shutdown manager
    if (this.currentWorkflowId) {
      GlobalWorkflowShutdownManager.getInstance().unregisterWorkflow(
        this.currentWorkflowId
      );
    }

    // Clear references
    this.logger = undefined;
    this.retryManager = undefined;
    this.shutdownManager = undefined;
    this.metricsCollector = undefined;
    this.builtinHooks?.unregisterAll();
    this.workflowHooks = undefined;
    this.builtinHooks = undefined;
  }

  /**
   * Execute step with retry logic and timeout
   */
  private async executeStepWithRetryAndTimeout<T>(
    fn: () => Promise<T>,
    step: WorkflowStep,
    timeout?: number
  ): Promise<T> {
    const executeWithTimeout = timeout ? 
      () => this.executeWithTimeout(fn, timeout) : 
      fn;

    if (this.retryManager) {
      return await this.retryManager.executeWithRetry(
        executeWithTimeout,
        {
          workflowId: this.currentWorkflowId!,
          step,
          logger: this.logger
        }
      );
    }

    return await executeWithTimeout();
  }

  /**
   * Get current workflow metrics
   */
  getMetrics(): WorkflowExecutionMetrics | undefined {
    return this.metricsCollector?.getCurrentMetrics();
  }

  /**
   * Get workflow logger
   */
  getLogger(): WorkflowLogger | undefined {
    return this.logger;
  }

  /**
   * Get workflow hooks system
   */
  getWorkflowHooks(): WorkflowHooks | undefined {
    return this.workflowHooks;
  }

  /**
   * Get built-in hooks instance
   */
  getBuiltinHooks(): BuiltinHooks | undefined {
    return this.builtinHooks;
  }

  /**
   * Check if workflow is cancelled or shutdown is in progress
   */
  private isCancelledOrShuttingDown(): boolean {
    return this.cancelled || this.shutdownManager?.isShutdownInProgress() || false;
  }

  /**
   * Get current workflow state
   */
  getWorkflowState(): WorkflowState | undefined {
    return this.workflowState;
  }

  /**
   * Get state persistence instance
   */
  getStatePersistence(): StatePersistence | undefined {
    return this.statePersistence;
  }

  /**
   * List all persisted workflow states
   */
  async listPersistedStates(): Promise<any[]> {
    if (!this.statePersistence) {
      throw new Error('State persistence not enabled');
    }
    return this.statePersistence.listStates();
  }

  /**
   * Delete a persisted workflow state
   */
  async deletePersistedState(workflowId: string): Promise<void> {
    if (!this.statePersistence) {
      throw new Error('State persistence not enabled');
    }
    await this.statePersistence.deleteState(workflowId);
  }

  /**
   * Clean up old workflow states
   */
  async cleanupOldStates(): Promise<number> {
    if (!this.statePersistence) {
      throw new Error('State persistence not enabled');
    }
    return this.statePersistence.cleanup();
  }

  /**
   * Save current workflow state checkpoint
   */
  async saveCheckpoint(): Promise<void> {
    if (!this.workflowState || !this.statePersistence) {
      throw new Error('State persistence not enabled or no active workflow');
    }
    
    if (this.context) {
      this.workflowState.updateContext(this.context.createSnapshot());
    }
    
    await this.statePersistence.saveState(this.workflowState);
  }

  /**
   * Create backup of current state
   */
  async createStateBackup(): Promise<void> {
    if (!this.workflowState || !this.statePersistence) {
      throw new Error('State persistence not enabled or no active workflow');
    }
    
    const snapshot = this.workflowState.getSnapshot();
    await this.statePersistence.createBackup(snapshot.workflowId);
  }
}