/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlmClient } from './index.js';
import type {
  ClientProfile,
  ClientProfileKey,
  ClientRegistry,
} from './ClientRegistry.js';

export enum LlmTask {
  PRIMARY = 'primary',
  LIGHTWEIGHT_SUMMARY = 'lightweight_summary',
  NEXT_SPEAKER = 'next_speaker',
}

export interface TaskClientSelectorOptions {
  registry: ClientRegistry;
  /**
   * Resolve a task into a ClientProfileKey. Implementations typically look up
   * config overrides such as config.llm.taskProfiles[task] -> key.
   * Should return undefined if no override exists for the given task.
   */
  resolveTaskProfileKey?: (task: LlmTask) => ClientProfileKey | undefined;
  /**
   * Optional accessor used by getModelFor() when a profile sets a default model.
   * If provided, allows consumers to use model overrides per task without
   * mutating global config.
   */
  resolveProfile?: (key: ClientProfileKey) => ClientProfile | undefined;
}

export class TaskClientSelector {
  private readonly registry: ClientRegistry;
  private readonly resolveTaskProfileKey?: (task: LlmTask) => ClientProfileKey | undefined;
  private readonly resolveProfile?: (key: ClientProfileKey) => ClientProfile | undefined;

  constructor(options: TaskClientSelectorOptions) {
    this.registry = options.registry;
    this.resolveTaskProfileKey = options.resolveTaskProfileKey;
    this.resolveProfile = options.resolveProfile;
  }

  /**
   * Returns the LlmClient for the provided task, falling back to the 'primary' key.
   */
  getClientFor(task: LlmTask): LlmClient {
    const key = this.resolveTaskProfileKey?.(task) ?? (LlmTask.PRIMARY as ClientProfileKey);
    return this.registry.getClient(key);
  }

  /**
   * Resolves the effective model for a given task.
   * If a profile exists for the resolved key and specifies a model, returns it.
   * Otherwise falls back to the provided defaultResolver callback.
   */
  getModelFor(
    task: LlmTask,
    defaultResolver: () => string,
  ): string {
    const key = this.resolveTaskProfileKey?.(task) ?? (LlmTask.PRIMARY as ClientProfileKey);
    const profile = this.resolveProfile?.(key);
    if (profile?.model && profile.model.trim().length > 0) {
      return profile.model;
    }
    return defaultResolver();
  }
}

// Global/shared selector support (optional)
let GLOBAL_TASK_CLIENT_SELECTOR: TaskClientSelector | undefined;

export function setGlobalTaskClientSelector(selector: TaskClientSelector): void {
  GLOBAL_TASK_CLIENT_SELECTOR = selector;
}

export function getGlobalTaskClientSelector(): TaskClientSelector {
  if (!GLOBAL_TASK_CLIENT_SELECTOR) {
    throw new Error('Global TaskClientSelector has not been set');
  }
  return GLOBAL_TASK_CLIENT_SELECTOR;
}

export function hasGlobalTaskClientSelector(): boolean {
  return !!GLOBAL_TASK_CLIENT_SELECTOR;
}


