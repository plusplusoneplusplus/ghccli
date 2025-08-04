/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult } from '../types.js';
import { WorkflowContext } from '../WorkflowContext.js';

export enum WorkflowEvent {
  WORKFLOW_START = 'workflow:start',
  WORKFLOW_COMPLETE = 'workflow:complete',
  WORKFLOW_ERROR = 'workflow:error',
  WORKFLOW_CANCELLED = 'workflow:cancelled',
  STEP_START = 'step:start',
  STEP_COMPLETE = 'step:complete',
  STEP_ERROR = 'step:error',
  STEP_SKIP = 'step:skip',
  STEP_RETRY = 'step:retry'
}

export interface WorkflowEventData {
  workflowId: string;
  workflow: WorkflowDefinition;
  context: WorkflowContext;
  timestamp: number;
}

export interface WorkflowStartEventData extends WorkflowEventData {
  options: Record<string, unknown>;
}

export interface WorkflowCompleteEventData extends WorkflowEventData {
  result: WorkflowResult;
}

export interface WorkflowErrorEventData extends WorkflowEventData {
  error: Error;
}

export interface StepEventData extends WorkflowEventData {
  step: WorkflowStep;
}

export interface StepCompleteEventData extends StepEventData {
  result: StepResult;
}

export interface StepErrorEventData extends StepEventData {
  error: Error;
  retryCount?: number;
}

export interface StepSkipEventData extends StepEventData {
  reason: string;
}

export interface StepRetryEventData extends StepEventData {
  error: Error;
  retryCount: number;
  maxRetries: number;
}

export type EventData = 
  | WorkflowStartEventData
  | WorkflowCompleteEventData
  | WorkflowErrorEventData
  | StepEventData
  | StepCompleteEventData
  | StepErrorEventData
  | StepSkipEventData
  | StepRetryEventData;

export type HookHandler = (eventData: EventData) => Promise<void> | void;
export type SyncHookHandler = (eventData: EventData) => void;
export type AsyncHookHandler = (eventData: EventData) => Promise<void>;

export interface HookRegistration {
  id: string;
  event: WorkflowEvent;
  handler: HookHandler;
  priority: number;
  enabled: boolean;
  async: boolean;
}

export interface HookSystemOptions {
  maxHooks?: number;
  defaultPriority?: number;
  enableErrorHandling?: boolean;
  maxExecutionTime?: number;
}

export class HookSystem {
  private hooks: Map<WorkflowEvent, HookRegistration[]> = new Map();
  private options: Required<HookSystemOptions>;
  private executionStats = new Map<string, { totalCalls: number; totalTime: number; errors: number }>();

  constructor(options: HookSystemOptions = {}) {
    this.options = {
      maxHooks: options.maxHooks ?? 100,
      defaultPriority: options.defaultPriority ?? 50,
      enableErrorHandling: options.enableErrorHandling ?? true,
      maxExecutionTime: options.maxExecutionTime ?? 5000
    };
  }

  /**
   * Register a hook for a specific workflow event
   */
  registerHook(
    id: string,
    event: WorkflowEvent,
    handler: HookHandler,
    options: {
      priority?: number;
      enabled?: boolean;
      async?: boolean;
    } = {}
  ): void {
    // Check for maximum hooks limit
    const totalHooks = Array.from(this.hooks.values()).reduce((sum, hooks) => sum + hooks.length, 0);
    if (totalHooks >= this.options.maxHooks) {
      throw new Error(`Maximum number of hooks (${this.options.maxHooks}) exceeded`);
    }

    // Check for duplicate IDs
    if (this.findHookById(id)) {
      throw new Error(`Hook with ID '${id}' already exists`);
    }

    const registration: HookRegistration = {
      id,
      event,
      handler,
      priority: options.priority ?? this.options.defaultPriority,
      enabled: options.enabled ?? true,
      async: options.async ?? false
    };

    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }

    const eventHooks = this.hooks.get(event)!;
    eventHooks.push(registration);

    // Sort by priority (higher priority first)
    eventHooks.sort((a, b) => b.priority - a.priority);

    this.initializeStats(id);
  }

  /**
   * Unregister a hook by ID
   */
  unregisterHook(id: string): boolean {
    for (const [event, hooks] of this.hooks.entries()) {
      const index = hooks.findIndex(hook => hook.id === id);
      if (index !== -1) {
        hooks.splice(index, 1);
        if (hooks.length === 0) {
          this.hooks.delete(event);
        }
        this.executionStats.delete(id);
        return true;
      }
    }
    return false;
  }

  /**
   * Enable or disable a hook
   */
  setHookEnabled(id: string, enabled: boolean): boolean {
    const hook = this.findHookById(id);
    if (hook) {
      hook.enabled = enabled;
      return true;
    }
    return false;
  }

  /**
   * Get all registered hooks for an event
   */
  getHooksForEvent(event: WorkflowEvent): HookRegistration[] {
    return this.hooks.get(event)?.filter(hook => hook.enabled) ?? [];
  }

  /**
   * Get all registered hooks
   */
  getAllHooks(): HookRegistration[] {
    const allHooks: HookRegistration[] = [];
    for (const hooks of this.hooks.values()) {
      allHooks.push(...hooks);
    }
    return allHooks;
  }

  /**
   * Execute all hooks for a specific event
   */
  async executeHooks(event: WorkflowEvent, eventData: EventData): Promise<void> {
    const hooks = this.getHooksForEvent(event);
    if (hooks.length === 0) {
      return;
    }

    const syncHooks = hooks.filter(hook => !hook.async);
    const asyncHooks = hooks.filter(hook => hook.async);

    // Execute sync hooks first (in priority order)
    for (const hook of syncHooks) {
      await this.executeHook(hook, eventData);
    }

    // Execute async hooks in parallel
    if (asyncHooks.length > 0) {
      await Promise.allSettled(
        asyncHooks.map(hook => this.executeHook(hook, eventData))
      );
    }
  }

  /**
   * Execute a single hook with error handling and timeout
   */
  private async executeHook(hook: HookRegistration, eventData: EventData): Promise<void> {
    const startTime = Date.now();
    const stats = this.executionStats.get(hook.id)!;

    try {
      if (hook.async) {
        // Execute async hook with timeout
        await this.executeWithTimeout(
          () => (hook.handler as AsyncHookHandler)(eventData),
          this.options.maxExecutionTime
        );
      } else {
        // Execute sync hook
        const result = hook.handler(eventData);
        if (result instanceof Promise) {
          await result;
        }
      }

      stats.totalCalls++;
      stats.totalTime += Date.now() - startTime;

    } catch (error) {
      stats.errors++;
      
      if (this.options.enableErrorHandling) {
        console.warn(`Hook '${hook.id}' failed:`, error);
        // Don't re-throw to prevent one hook from breaking the entire workflow
      } else {
        throw error;
      }
    }
  }

  /**
   * Execute a function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Hook execution timed out after ${timeout}ms`));
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
   * Get execution statistics for a hook
   */
  getHookStats(id: string): { totalCalls: number; totalTime: number; errors: number; avgTime: number } | undefined {
    const stats = this.executionStats.get(id);
    if (!stats) {
      return undefined;
    }

    return {
      ...stats,
      avgTime: stats.totalCalls > 0 ? stats.totalTime / stats.totalCalls : 0
    };
  }

  /**
   * Get execution statistics for all hooks
   */
  getAllStats(): Record<string, { totalCalls: number; totalTime: number; errors: number; avgTime: number }> {
    const result: Record<string, { totalCalls: number; totalTime: number; errors: number; avgTime: number }> = {};
    
    for (const [id, stats] of this.executionStats.entries()) {
      result[id] = {
        ...stats,
        avgTime: stats.totalCalls > 0 ? stats.totalTime / stats.totalCalls : 0
      };
    }

    return result;
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks.clear();
    this.executionStats.clear();
  }

  /**
   * Get the number of registered hooks
   */
  getHookCount(): number {
    return Array.from(this.hooks.values()).reduce((sum, hooks) => sum + hooks.length, 0);
  }

  /**
   * Find a hook by ID
   */
  private findHookById(id: string): HookRegistration | undefined {
    for (const hooks of this.hooks.values()) {
      const hook = hooks.find(h => h.id === id);
      if (hook) {
        return hook;
      }
    }
    return undefined;
  }

  /**
   * Initialize statistics for a hook
   */
  private initializeStats(id: string): void {
    this.executionStats.set(id, {
      totalCalls: 0,
      totalTime: 0,
      errors: 0
    });
  }
}