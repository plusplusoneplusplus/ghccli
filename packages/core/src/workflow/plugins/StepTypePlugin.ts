/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowStep } from '../types.js';
import { WorkflowContext } from '../WorkflowContext.js';
import { StepExecutor } from '../StepExecutor.js';

export interface StepTypePluginMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  homepage?: string;
  keywords?: string[];
  supportedStepTypes: string[];
  dependencies?: Record<string, string>;
  capabilities?: {
    concurrent?: boolean;
    timeout?: boolean;
    retry?: boolean;
    conditional?: boolean;
  };
}

export interface StepTypePluginConfig {
  enabled: boolean;
  priority?: number;
  sandboxed?: boolean;
  allowedCapabilities?: string[];
  blockedCapabilities?: string[];
  resourceLimits?: {
    memory?: number;
    cpu?: number;
    timeout?: number;
  };
}

export abstract class StepTypePlugin {
  protected metadata: StepTypePluginMetadata;
  protected config: StepTypePluginConfig;

  constructor(metadata: StepTypePluginMetadata, config?: StepTypePluginConfig) {
    this.metadata = metadata;
    this.config = {
      enabled: true,
      priority: 0,
      sandboxed: false,
      ...config
    };
  }

  getMetadata(): StepTypePluginMetadata {
    return { ...this.metadata };
  }

  getConfig(): StepTypePluginConfig {
    return { ...this.config };
  }

  getSupportedStepTypes(): string[] {
    return [...this.metadata.supportedStepTypes];
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  abstract createStepExecutor(stepType: string): StepExecutor | null;

  abstract validateStepConfig(step: WorkflowStep): { valid: boolean; errors: string[] };

  async initialize(): Promise<void> {
    // Override if initialization is needed
  }

  async shutdown(): Promise<void> {
    // Override if cleanup is needed
  }

  async validatePluginIntegrity(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!this.metadata.name || typeof this.metadata.name !== 'string') {
      errors.push('Plugin metadata must include a valid name');
    }

    if (!this.metadata.version || typeof this.metadata.version !== 'string') {
      errors.push('Plugin metadata must include a valid version');
    }

    if (!this.metadata.supportedStepTypes || !Array.isArray(this.metadata.supportedStepTypes) || this.metadata.supportedStepTypes.length === 0) {
      errors.push('Plugin must support at least one step type');
    }

    for (const stepType of this.metadata.supportedStepTypes) {
      const executor = this.createStepExecutor(stepType);
      if (!executor) {
        errors.push(`Plugin cannot create executor for declared step type: ${stepType}`);
      } else if (!executor.canExecute({ id: 'test', name: 'test', type: stepType, config: {} } as WorkflowStep)) {
        errors.push(`Executor for step type ${stepType} cannot execute its own type`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export interface PluginExecutionContext {
  workflowContext: WorkflowContext;
  pluginConfig: StepTypePluginConfig;
  sandbox?: PluginSandbox;
}

export interface PluginSandbox {
  executeInSandbox<T>(fn: () => Promise<T>, limits?: ResourceLimits): Promise<T>;
  validateAccess(resource: string, operation: string): boolean;
}

export interface ResourceLimits {
  memory?: number;
  cpu?: number;
  timeout?: number;
  networkAccess?: boolean;
  fileSystemAccess?: {
    read?: string[];
    write?: string[];
  };
}

export interface StepTypePluginFactory {
  name: string;
  version: string;
  create(config?: Record<string, unknown>): Promise<StepTypePlugin>;
  validateConfig?(config: Record<string, unknown>): { valid: boolean; errors: string[] };
}