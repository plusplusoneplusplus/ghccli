/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  HookSystem, 
  WorkflowEvent, 
  EventData,
  type WorkflowStartEventData,
  type WorkflowCompleteEventData,
  type WorkflowErrorEventData,
  type StepEventData,
  type StepCompleteEventData,
  type StepErrorEventData,
  type StepSkipEventData,
  type StepRetryEventData,
  type HookHandler
} from './HookSystem.js';
import { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult } from '../types.js';
import { WorkflowContext } from '../WorkflowContext.js';

export interface WorkflowHookRegistry {
  onWorkflowStart(handler: (data: any) => Promise<void> | void, options?: HookOptions): string;
  onWorkflowComplete(handler: (data: any) => Promise<void> | void, options?: HookOptions): string;
  onWorkflowError(handler: (data: any) => Promise<void> | void, options?: HookOptions): string;
  onWorkflowCancelled(handler: (data: any) => Promise<void> | void, options?: HookOptions): string;
  onStepStart(handler: (data: any) => Promise<void> | void, options?: HookOptions): string;
  onStepComplete(handler: (data: any) => Promise<void> | void, options?: HookOptions): string;
  onStepError(handler: (data: any) => Promise<void> | void, options?: HookOptions): string;
  onStepSkip(handler: (data: any) => Promise<void> | void, options?: HookOptions): string;
  onStepRetry(handler: (data: any) => Promise<void> | void, options?: HookOptions): string;
}

export interface HookOptions {
  priority?: number;
  enabled?: boolean;
  async?: boolean;
  id?: string;
}

export interface WorkflowHooksOptions {
  enableBuiltinHooks?: boolean;
  maxHooks?: number;
  defaultPriority?: number;
  enableErrorHandling?: boolean;
  maxExecutionTime?: number;
}

export class WorkflowHooks implements WorkflowHookRegistry {
  private hookSystem: HookSystem;
  private hookIdCounter = 0;

  constructor(options: WorkflowHooksOptions = {}) {
    this.hookSystem = new HookSystem({
      maxHooks: options.maxHooks,
      defaultPriority: options.defaultPriority,
      enableErrorHandling: options.enableErrorHandling,
      maxExecutionTime: options.maxExecutionTime
    });
  }

  /**
   * Get the underlying hook system
   */
  getHookSystem(): HookSystem {
    return this.hookSystem;
  }

  /**
   * Register a hook for workflow start event
   */
  onWorkflowStart(
    handler: (data: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    return this.registerTypedHook(WorkflowEvent.WORKFLOW_START, handler, options);
  }

  /**
   * Register a hook for workflow complete event
   */
  onWorkflowComplete(
    handler: (data: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    return this.registerTypedHook(WorkflowEvent.WORKFLOW_COMPLETE, handler, options);
  }

  /**
   * Register a hook for workflow error event
   */
  onWorkflowError(
    handler: (data: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    return this.registerTypedHook(WorkflowEvent.WORKFLOW_ERROR, handler, options);
  }

  /**
   * Register a hook for workflow cancelled event
   */
  onWorkflowCancelled(
    handler: (data: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    return this.registerTypedHook(WorkflowEvent.WORKFLOW_CANCELLED, handler, options);
  }

  /**
   * Register a hook for step start event
   */
  onStepStart(
    handler: (data: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    return this.registerTypedHook(WorkflowEvent.STEP_START, handler, options);
  }

  /**
   * Register a hook for step complete event
   */
  onStepComplete(
    handler: (data: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    return this.registerTypedHook(WorkflowEvent.STEP_COMPLETE, handler, options);
  }

  /**
   * Register a hook for step error event
   */
  onStepError(
    handler: (data: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    return this.registerTypedHook(WorkflowEvent.STEP_ERROR, handler, options);
  }

  /**
   * Register a hook for step skip event
   */
  onStepSkip(
    handler: (data: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    return this.registerTypedHook(WorkflowEvent.STEP_SKIP, handler, options);
  }

  /**
   * Register a hook for step retry event
   */
  onStepRetry(
    handler: (data: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    return this.registerTypedHook(WorkflowEvent.STEP_RETRY, handler, options);
  }

  /**
   * Emit a workflow start event
   */
  async emitWorkflowStart(
    workflowId: string,
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    options: Record<string, unknown>
  ): Promise<void> {
    const eventData: WorkflowStartEventData = {
      workflowId,
      workflow,
      context,
      options,
      timestamp: Date.now()
    };

    await this.hookSystem.executeHooks(WorkflowEvent.WORKFLOW_START, eventData);
  }

  /**
   * Emit a workflow complete event
   */
  async emitWorkflowComplete(
    workflowId: string,
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    result: WorkflowResult
  ): Promise<void> {
    const eventData: WorkflowCompleteEventData = {
      workflowId,
      workflow,
      context,
      result,
      timestamp: Date.now()
    };

    await this.hookSystem.executeHooks(WorkflowEvent.WORKFLOW_COMPLETE, eventData);
  }

  /**
   * Emit a workflow error event
   */
  async emitWorkflowError(
    workflowId: string,
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    error: Error
  ): Promise<void> {
    const eventData: WorkflowErrorEventData = {
      workflowId,
      workflow,
      context,
      error,
      timestamp: Date.now()
    };

    await this.hookSystem.executeHooks(WorkflowEvent.WORKFLOW_ERROR, eventData);
  }

  /**
   * Emit a workflow cancelled event
   */
  async emitWorkflowCancelled(
    workflowId: string,
    workflow: WorkflowDefinition,
    context: WorkflowContext
  ): Promise<void> {
    const eventData = {
      workflowId,
      workflow,
      context,
      timestamp: Date.now()
    } as EventData;

    await this.hookSystem.executeHooks(WorkflowEvent.WORKFLOW_CANCELLED, eventData);
  }

  /**
   * Emit a step start event
   */
  async emitStepStart(
    workflowId: string,
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    step: WorkflowStep
  ): Promise<void> {
    const eventData: StepEventData = {
      workflowId,
      workflow,
      context,
      step,
      timestamp: Date.now()
    };

    await this.hookSystem.executeHooks(WorkflowEvent.STEP_START, eventData);
  }

  /**
   * Emit a step complete event
   */
  async emitStepComplete(
    workflowId: string,
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    step: WorkflowStep,
    result: StepResult
  ): Promise<void> {
    const eventData: StepCompleteEventData = {
      workflowId,
      workflow,
      context,
      step,
      result,
      timestamp: Date.now()
    };

    await this.hookSystem.executeHooks(WorkflowEvent.STEP_COMPLETE, eventData);
  }

  /**
   * Emit a step error event
   */
  async emitStepError(
    workflowId: string,
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    step: WorkflowStep,
    error: Error,
    retryCount?: number
  ): Promise<void> {
    const eventData: StepErrorEventData = {
      workflowId,
      workflow,
      context,
      step,
      error,
      retryCount,
      timestamp: Date.now()
    };

    await this.hookSystem.executeHooks(WorkflowEvent.STEP_ERROR, eventData);
  }

  /**
   * Emit a step skip event
   */
  async emitStepSkip(
    workflowId: string,
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    step: WorkflowStep,
    reason: string
  ): Promise<void> {
    const eventData: StepSkipEventData = {
      workflowId,
      workflow,
      context,
      step,
      reason,
      timestamp: Date.now()
    };

    await this.hookSystem.executeHooks(WorkflowEvent.STEP_SKIP, eventData);
  }

  /**
   * Emit a step retry event
   */
  async emitStepRetry(
    workflowId: string,
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    step: WorkflowStep,
    error: Error,
    retryCount: number,
    maxRetries: number
  ): Promise<void> {
    const eventData: StepRetryEventData = {
      workflowId,
      workflow,
      context,
      step,
      error,
      retryCount,
      maxRetries,
      timestamp: Date.now()
    };

    await this.hookSystem.executeHooks(WorkflowEvent.STEP_RETRY, eventData);
  }

  /**
   * Remove a hook by ID
   */
  removeHook(id: string): boolean {
    return this.hookSystem.unregisterHook(id);
  }

  /**
   * Enable or disable a hook
   */
  setHookEnabled(id: string, enabled: boolean): boolean {
    return this.hookSystem.setHookEnabled(id, enabled);
  }

  /**
   * Get hook execution statistics
   */
  getHookStats(id: string) {
    return this.hookSystem.getHookStats(id);
  }

  /**
   * Get all hook execution statistics
   */
  getAllHookStats() {
    return this.hookSystem.getAllStats();
  }

  /**
   * Clear all hooks
   */
  clearHooks(): void {
    this.hookSystem.clear();
  }

  /**
   * Get the total number of registered hooks
   */
  getHookCount(): number {
    return this.hookSystem.getHookCount();
  }

  /**
   * Register a typed hook with auto-generated ID
   */
  private registerTypedHook(
    event: WorkflowEvent,
    handler: (eventData: any) => Promise<void> | void,
    options: HookOptions = {}
  ): string {
    const id = options.id || this.generateHookId(event);
    
    this.hookSystem.registerHook(id, event, handler as HookHandler, {
      priority: options.priority,
      enabled: options.enabled,
      async: options.async
    });

    return id;
  }

  /**
   * Generate a unique hook ID
   */
  private generateHookId(event: WorkflowEvent): string {
    return `${event}-${++this.hookIdCounter}-${Date.now()}`;
  }
}