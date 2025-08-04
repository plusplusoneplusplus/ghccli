/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowStep } from './types.js';
import { 
  WorkflowTemplate,
  TemplateInstance,
  TemplateParameter,
  TemplateResolutionOptions,
  TemplateValidationResult,
  TemplateConflict,
  TemplateResolutionContext,
  TemplateInheritanceChain,
  WorkflowTemplateError,
  TemplateParameterError,
  TemplateInheritanceError
} from './WorkflowTemplate.js';
import { VariableInterpolator, InterpolationOptions } from './VariableInterpolator.js';
import { WorkflowContext } from './WorkflowContext.js';

export class TemplateResolver {
  private interpolator: VariableInterpolator;
  
  constructor() {
    this.interpolator = new VariableInterpolator();
  }

  /**
   * Resolve a template instance into a complete workflow definition
   */
  async resolveTemplate(
    instance: TemplateInstance,
    context: TemplateResolutionContext
  ): Promise<WorkflowDefinition> {
    const { templateId, parameters, name, overrides } = instance;
    const { templates, options } = context;
    
    // Get the template
    const template = templates.get(templateId);
    if (!template) {
      throw new WorkflowTemplateError(`Template not found: ${templateId}`, templateId);
    }

    // Validate parameters
    const validationResult = this.validateParameters(template, parameters, options.strictParameterValidation);
    if (!validationResult.valid) {
      throw new TemplateParameterError(
        `Parameter validation failed: ${validationResult.errors.join(', ')}`,
        '',
        templateId
      );
    }

    // Resolve inheritance chain
    const inheritanceChain = await this.resolveInheritanceChain(template, templates, options);
    
    // Merge template hierarchy
    const baseDefinition = this.mergeTemplateHierarchy(inheritanceChain, context);
    
    // Apply parameter substitution
    const resolvedDefinition = await this.applyParameterSubstitution(
      baseDefinition,
      parameters,
      options
    );

    // Apply instance overrides
    const finalDefinition = this.applyInstanceOverrides(
      resolvedDefinition,
      { name, overrides },
      template
    );

    return finalDefinition;
  }

  /**
   * Validate template parameters
   */
  validateParameters(
    template: WorkflowTemplate,
    parameters: Record<string, unknown>,
    strict = true
  ): TemplateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const param of template.parameters) {
      const value = parameters[param.name];
      
      // Check required parameters
      if (param.required && (value === undefined || value === null)) {
        if (param.default !== undefined) {
          parameters[param.name] = param.default;
          continue;
        }
        errors.push(`Required parameter missing: ${param.name}`);
        continue;
      }

      // Set default value for undefined optional parameters
      if (value === undefined && !param.required) {
        if (param.default !== undefined) {
          parameters[param.name] = param.default;
        }
        continue;
      }

      // Type validation
      if (!this.validateParameterType(value, param)) {
        errors.push(`Parameter ${param.name} has invalid type. Expected: ${param.type}, got: ${typeof value}`);
      }

      // Custom validation rules
      if (param.validation) {
        const validationErrors = this.validateParameterConstraints(value, param);
        errors.push(...validationErrors);
      }
    }

    // Check for unknown parameters in strict mode
    if (strict) {
      const knownParams = new Set(template.parameters.map(p => p.name));
      for (const paramName of Object.keys(parameters)) {
        if (!knownParams.has(paramName)) {
          warnings.push(`Unknown parameter: ${paramName}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Resolve template inheritance chain
   */
  private async resolveInheritanceChain(
    template: WorkflowTemplate,
    templates: Map<string, WorkflowTemplate>,
    options: TemplateResolutionOptions
  ): Promise<TemplateInheritanceChain> {
    const maxDepth = options.maxInheritanceDepth || 10;
    const visited = new Set<string>();
    const chain: WorkflowTemplate[] = [];
    
    await this.buildInheritanceChain(template, templates, chain, visited, maxDepth);
    
    return {
      base: chain[0],
      extensions: chain.slice(1),
      resolved: {} as WorkflowDefinition // Will be populated by mergeTemplateHierarchy
    };
  }

  /**
   * Build inheritance chain recursively
   */
  private async buildInheritanceChain(
    template: WorkflowTemplate,
    templates: Map<string, WorkflowTemplate>,
    chain: WorkflowTemplate[],
    visited: Set<string>,
    maxDepth: number
  ): Promise<void> {
    if (chain.length >= maxDepth) {
      throw new TemplateInheritanceError(
        `Maximum inheritance depth (${maxDepth}) exceeded`,
        Array.from(visited),
        template.metadata.id
      );
    }

    if (visited.has(template.metadata.id)) {
      throw new TemplateInheritanceError(
        `Circular inheritance detected`,
        Array.from(visited),
        template.metadata.id
      );
    }

    visited.add(template.metadata.id);
    
    // Add current template to chain
    chain.unshift(template);

    // Process parent templates
    if (template.extends) {
      const parents = Array.isArray(template.extends) ? template.extends : [template.extends];
      
      for (const parentId of parents) {
        const parentTemplate = templates.get(parentId);
        if (!parentTemplate) {
          throw new TemplateInheritanceError(
            `Parent template not found: ${parentId}`,
            Array.from(visited),
            template.metadata.id
          );
        }
        
        await this.buildInheritanceChain(parentTemplate, templates, chain, visited, maxDepth);
      }
    }
  }

  /**
   * Merge template hierarchy from base to most derived
   */
  private mergeTemplateHierarchy(
    inheritanceChain: TemplateInheritanceChain,
    context: TemplateResolutionContext
  ): WorkflowDefinition {
    const { base, extensions } = inheritanceChain;
    let merged = this.templateToWorkflowDefinition(base);

    for (const extension of extensions) {
      merged = this.mergeWorkflowDefinitions(merged, extension, context);
    }

    inheritanceChain.resolved = merged;
    return merged;
  }

  /**
   * Convert template to workflow definition
   */
  private templateToWorkflowDefinition(template: WorkflowTemplate): WorkflowDefinition {
    return {
      name: template.template.name || template.metadata.name,
      version: template.template.version || template.metadata.version,
      description: template.template.description || template.metadata.description,
      steps: template.template.steps || [],
      timeout: template.template.timeout,
      env: template.template.env,
      metadata: template.template.metadata,
      parallel: template.template.parallel
    };
  }

  /**
   * Merge two workflow definitions with conflict detection
   */
  private mergeWorkflowDefinitions(
    base: WorkflowDefinition,
    extension: WorkflowTemplate,
    context: TemplateResolutionContext
  ): WorkflowDefinition {
    const extDef = this.templateToWorkflowDefinition(extension);
    
    const merged: WorkflowDefinition = {
      ...base,
      name: extDef.name || base.name,
      version: extDef.version || base.version,
      description: extDef.description || base.description,
      timeout: extDef.timeout ?? base.timeout,
      env: this.mergeEnvironmentVariables(base.env, extDef.env, context),
      metadata: this.mergeMetadata(base.metadata, extDef.metadata, context),
      parallel: extDef.parallel || base.parallel,
      steps: this.mergeSteps(base.steps, extDef.steps, extension.overrides?.steps, context)
    };

    return merged;
  }

  /**
   * Merge environment variables with conflict detection
   */
  private mergeEnvironmentVariables(
    base: Record<string, string> | undefined,
    extension: Record<string, string> | undefined,
    context: TemplateResolutionContext
  ): Record<string, string> | undefined {
    if (!extension) return base;
    if (!base) return extension;

    const merged = { ...base };
    
    for (const [key, value] of Object.entries(extension)) {
      if (key in merged && merged[key] !== value) {
        context.conflicts.push({
          type: 'environment',
          path: `env.${key}`,
          baseValue: merged[key],
          extensionValue: value,
          resolution: 'override'
        });
      }
      merged[key] = value;
    }

    return merged;
  }

  /**
   * Merge metadata with conflict detection
   */
  private mergeMetadata(
    base: Record<string, unknown> | undefined,
    extension: Record<string, unknown> | undefined,
    context: TemplateResolutionContext
  ): Record<string, unknown> | undefined {
    if (!extension) return base;
    if (!base) return extension;

    const merged = { ...base };
    
    for (const [key, value] of Object.entries(extension)) {
      if (key in merged && JSON.stringify(merged[key]) !== JSON.stringify(value)) {
        context.conflicts.push({
          type: 'metadata',
          path: `metadata.${key}`,
          baseValue: merged[key],
          extensionValue: value,
          resolution: 'override'
        });
      }
      merged[key] = value;
    }

    return merged;
  }

  /**
   * Merge workflow steps with conflict detection and overrides
   */
  private mergeSteps(
    baseSteps: WorkflowStep[],
    extensionSteps: WorkflowStep[] = [],
    overrides: Partial<WorkflowStep>[] = [],
    context: TemplateResolutionContext
  ): WorkflowStep[] {
    const stepMap = new Map<string, WorkflowStep>();
    
    // Add base steps
    for (const step of baseSteps) {
      stepMap.set(step.id, { ...step });
    }

    // Add extension steps (may override base steps)
    for (const step of extensionSteps) {
      if (stepMap.has(step.id)) {
        context.conflicts.push({
          type: 'step',
          path: `steps.${step.id}`,
          baseValue: stepMap.get(step.id),
          extensionValue: step,
          resolution: 'override'
        });
      }
      stepMap.set(step.id, { ...step });
    }

    // Apply step overrides
    for (const override of overrides) {
      if (override.id && stepMap.has(override.id)) {
        const existing = stepMap.get(override.id)!;
        stepMap.set(override.id, {
          ...existing,
          ...override
        });
      }
    }

    return Array.from(stepMap.values());
  }

  /**
   * Apply parameter substitution to workflow definition
   */
  private async applyParameterSubstitution(
    definition: WorkflowDefinition,
    parameters: Record<string, unknown>,
    options: TemplateResolutionOptions
  ): Promise<WorkflowDefinition> {
    if (!options.enableParameterInterpolation) {
      return definition;
    }

    // Create a minimal workflow context for parameter interpolation
    const workflowContext = new WorkflowContext('template-resolution', parameters);
    
    const interpolationOptions: InterpolationOptions = {
      strictMode: options.strictParameterValidation ?? false,
      maxDepth: 5
    };

    // Interpolate the entire definition as a JSON object
    const result = this.interpolator.interpolateValue(
      definition,
      workflowContext,
      interpolationOptions
    );

    if (!result.success) {
      throw new WorkflowTemplateError(
        `Parameter interpolation failed: ${result.errors.join(', ')}`
      );
    }

    return result.value as WorkflowDefinition;
  }

  /**
   * Apply instance-specific overrides
   */
  private applyInstanceOverrides(
    definition: WorkflowDefinition,
    instance: { name?: string; overrides?: TemplateInstance['overrides'] },
    template: WorkflowTemplate
  ): WorkflowDefinition {
    const result = { ...definition };

    // Apply name override
    if (instance.name) {
      result.name = instance.name;
    }

    if (!instance.overrides) {
      return result;
    }

    // Apply step overrides
    if (instance.overrides.steps) {
      const stepMap = new Map(result.steps.map(step => [step.id, step]));
      
      for (const override of instance.overrides.steps) {
        if (override.id && stepMap.has(override.id)) {
          const existing = stepMap.get(override.id)!;
          stepMap.set(override.id, {
            ...existing,
            ...override
          });
        }
      }
      
      result.steps = Array.from(stepMap.values());
    }

    // Apply environment overrides
    if (instance.overrides.env) {
      result.env = {
        ...result.env,
        ...instance.overrides.env
      };
    }

    return result;
  }

  /**
   * Validate parameter type
   */
  private validateParameterType(value: unknown, param: TemplateParameter): boolean {
    switch (param.type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return false;
    }
  }

  /**
   * Validate parameter constraints
   */
  private validateParameterConstraints(value: unknown, param: TemplateParameter): string[] {
    const errors: string[] = [];
    const validation = param.validation!;

    if (param.type === 'string' && typeof value === 'string') {
      if (validation.pattern && !new RegExp(validation.pattern).test(value)) {
        errors.push(`Parameter ${param.name} does not match pattern: ${validation.pattern}`);
      }
      if (validation.minLength && value.length < validation.minLength) {
        errors.push(`Parameter ${param.name} is too short (minimum: ${validation.minLength})`);
      }
      if (validation.maxLength && value.length > validation.maxLength) {
        errors.push(`Parameter ${param.name} is too long (maximum: ${validation.maxLength})`);
      }
    }

    if (param.type === 'number' && typeof value === 'number') {
      if (validation.minimum !== undefined && value < validation.minimum) {
        errors.push(`Parameter ${param.name} is too small (minimum: ${validation.minimum})`);
      }
      if (validation.maximum !== undefined && value > validation.maximum) {
        errors.push(`Parameter ${param.name} is too large (maximum: ${validation.maximum})`);
      }
    }

    if (validation.enum && !validation.enum.includes(value)) {
      errors.push(`Parameter ${param.name} must be one of: ${validation.enum.join(', ')}`);
    }

    return errors;
  }
}