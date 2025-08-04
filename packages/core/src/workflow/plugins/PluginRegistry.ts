/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { StepTypePlugin, StepTypePluginMetadata, StepTypePluginConfig, StepTypePluginFactory } from './StepTypePlugin.js';
import { StepExecutor } from '../StepExecutor.js';
import { WorkflowStep } from '../types.js';

export interface PluginRegistrationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

export interface PluginRegistryOptions {
  enableSandboxing?: boolean;
  defaultPluginConfig?: Partial<StepTypePluginConfig>;
  maxPlugins?: number;
  allowDuplicateStepTypes?: boolean;
}

export class PluginRegistry {
  private plugins: Map<string, StepTypePlugin>;
  private stepTypeToPlugin: Map<string, string>;
  private pluginFactories: Map<string, StepTypePluginFactory>;
  private options: PluginRegistryOptions;

  constructor(options: PluginRegistryOptions = {}) {
    this.plugins = new Map();
    this.stepTypeToPlugin = new Map();
    this.pluginFactories = new Map();
    this.options = {
      enableSandboxing: false,
      maxPlugins: 50,
      allowDuplicateStepTypes: false,
      ...options
    };
  }

  async registerPlugin(plugin: StepTypePlugin): Promise<PluginRegistrationResult> {
    const result: PluginRegistrationResult = {
      success: false,
      errors: [],
      warnings: []
    };

    try {
      if (!plugin.isEnabled()) {
        result.warnings.push('Plugin is disabled and will not be registered');
        return result;
      }

      if (this.plugins.size >= (this.options.maxPlugins || 50)) {
        result.errors.push(`Maximum number of plugins (${this.options.maxPlugins}) exceeded`);
        return result;
      }

      const metadata = plugin.getMetadata();

      if (this.plugins.has(metadata.name)) {
        result.errors.push(`Plugin with name '${metadata.name}' is already registered`);
        return result;
      }

      const validationResult = await plugin.validatePluginIntegrity();
      if (!validationResult.valid) {
        result.errors.push(...validationResult.errors);
        return result;
      }

      const conflictingStepTypes: string[] = [];
      for (const stepType of plugin.getSupportedStepTypes()) {
        if (this.stepTypeToPlugin.has(stepType) && !this.options.allowDuplicateStepTypes) {
          conflictingStepTypes.push(stepType);
        }
      }

      if (conflictingStepTypes.length > 0) {
        result.errors.push(`Step types already registered by other plugins: ${conflictingStepTypes.join(', ')}`);
        return result;
      }

      await plugin.initialize();

      this.plugins.set(metadata.name, plugin);

      for (const stepType of plugin.getSupportedStepTypes()) {
        this.stepTypeToPlugin.set(stepType, metadata.name);
      }

      result.success = true;
      result.warnings.push(`Successfully registered plugin '${metadata.name}' v${metadata.version}`);

    } catch (error) {
      result.errors.push(`Failed to register plugin: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  async registerPluginFactory(factory: StepTypePluginFactory): Promise<PluginRegistrationResult> {
    const result: PluginRegistrationResult = {
      success: false,
      errors: [],
      warnings: []
    };

    try {
      if (this.pluginFactories.has(factory.name)) {
        result.errors.push(`Plugin factory with name '${factory.name}' is already registered`);
        return result;
      }

      this.pluginFactories.set(factory.name, factory);
      result.success = true;
      result.warnings.push(`Successfully registered plugin factory '${factory.name}' v${factory.version}`);

    } catch (error) {
      result.errors.push(`Failed to register plugin factory: ${error instanceof Error ? error.message : String(error)}`);
    }

    return result;
  }

  async createPluginFromFactory(factoryName: string, config?: Record<string, unknown>): Promise<StepTypePlugin | null> {
    const factory = this.pluginFactories.get(factoryName);
    if (!factory) {
      throw new Error(`Plugin factory '${factoryName}' not found`);
    }

    if (factory.validateConfig && config) {
      const validation = factory.validateConfig(config);
      if (!validation.valid) {
        throw new Error(`Invalid plugin configuration: ${validation.errors.join(', ')}`);
      }
    }

    return await factory.create(config);
  }

  async unregisterPlugin(pluginName: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return false;
    }

    try {
      await plugin.shutdown();

      for (const stepType of plugin.getSupportedStepTypes()) {
        this.stepTypeToPlugin.delete(stepType);
      }

      this.plugins.delete(pluginName);
      return true;

    } catch (error) {
      console.warn(`Error during plugin shutdown for '${pluginName}':`, error);
      return false;
    }
  }

  getPlugin(pluginName: string): StepTypePlugin | undefined {
    return this.plugins.get(pluginName);
  }

  getPluginForStepType(stepType: string): StepTypePlugin | undefined {
    const pluginName = this.stepTypeToPlugin.get(stepType);
    return pluginName ? this.plugins.get(pluginName) : undefined;
  }

  getRegisteredPlugins(): StepTypePluginMetadata[] {
    return Array.from(this.plugins.values()).map(plugin => plugin.getMetadata());
  }

  getSupportedStepTypes(): string[] {
    return Array.from(this.stepTypeToPlugin.keys());
  }

  canExecuteStepType(stepType: string): boolean {
    return this.stepTypeToPlugin.has(stepType);
  }

  createStepExecutor(stepType: string): StepExecutor | null {
    const plugin = this.getPluginForStepType(stepType);
    if (!plugin) {
      return null;
    }

    return plugin.createStepExecutor(stepType);
  }

  validateStep(step: WorkflowStep): { valid: boolean; errors: string[] } {
    const plugin = this.getPluginForStepType(step.type);
    if (!plugin) {
      return {
        valid: false,
        errors: [`No plugin registered for step type '${step.type}'`]
      };
    }

    return plugin.validateStepConfig(step);
  }

  async shutdown(): Promise<void> {
    const shutdownPromises = Array.from(this.plugins.values()).map(plugin => 
      plugin.shutdown().catch(error => 
        console.warn(`Error shutting down plugin '${plugin.getMetadata().name}':`, error)
      )
    );

    await Promise.all(shutdownPromises);
    
    this.plugins.clear();
    this.stepTypeToPlugin.clear();
    this.pluginFactories.clear();
  }

  getPluginStats(): {
    totalPlugins: number;
    enabledPlugins: number;
    supportedStepTypes: number;
    pluginsByStepType: Record<string, string>;
  } {
    const enabledPlugins = Array.from(this.plugins.values()).filter(p => p.isEnabled()).length;
    const pluginsByStepType: Record<string, string> = {};
    
    for (const [stepType, pluginName] of this.stepTypeToPlugin.entries()) {
      pluginsByStepType[stepType] = pluginName;
    }

    return {
      totalPlugins: this.plugins.size,
      enabledPlugins,
      supportedStepTypes: this.stepTypeToPlugin.size,
      pluginsByStepType
    };
  }
}