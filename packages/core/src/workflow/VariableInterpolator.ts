/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowContext } from './WorkflowContext.js';
import { BuiltinFunctions } from './BuiltinFunctions.js';

export interface InterpolationOptions {
  /**
   * Whether to throw errors on undefined variables (default: false)
   */
  strictMode?: boolean;
  
  /**
   * Custom functions available for interpolation
   */
  customFunctions?: Record<string, Function>;
  
  /**
   * Maximum recursion depth for nested interpolation (default: 10)
   */
  maxDepth?: number;
}

export interface InterpolationResult {
  success: boolean;
  value: unknown;
  errors: string[];
}

/**
 * Variable interpolation system for workflow configuration
 * Supports syntax: {{variable.path}}, {{steps.stepId.output}}, {{env.VAR_NAME}}, {{functions.name(args)}}
 */
export class VariableInterpolator {
  private static readonly INTERPOLATION_REGEX = /\{\{([^}]+)\}\}/g;
  private static readonly FUNCTION_REGEX = /^(\w+)\((.*)\)$/;
  private static readonly ARRAY_INDEX_REGEX = /^(.+)\[(\d+)\]$/;
  
  private builtinFunctions: BuiltinFunctions;
  
  constructor() {
    this.builtinFunctions = new BuiltinFunctions();
  }
  
  /**
   * Interpolate variables in a string value
   */
  interpolateString(
    value: string,
    context: WorkflowContext,
    options: InterpolationOptions = {}
  ): InterpolationResult {
    const { strictMode = false, customFunctions = {}, maxDepth = 10 } = options;
    const errors: string[] = [];
    let depth = 0;
    
    try {
      const result = this.processString(value, context, {
        strictMode,
        customFunctions,
        maxDepth,
        currentDepth: depth,
        errors
      });
      
      return {
        success: errors.length === 0,
        value: result,
        errors
      };
    } catch (error) {
      errors.push(`Interpolation failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        value: value,
        errors
      };
    }
  }
  
  /**
   * Interpolate variables in any value (string, object, array)
   */
  interpolateValue(
    value: unknown,
    context: WorkflowContext,
    options: InterpolationOptions = {}
  ): InterpolationResult {
    if (typeof value === 'string') {
      return this.interpolateString(value, context, options);
    }
    
    if (Array.isArray(value)) {
      return this.interpolateArray(value, context, options);
    }
    
    if (value && typeof value === 'object') {
      return this.interpolateObject(value as Record<string, unknown>, context, options);
    }
    
    // Return non-interpolable values as-is
    return {
      success: true,
      value,
      errors: []
    };
  }
  
  /**
   * Interpolate variables in an object
   */
  private interpolateObject(
    obj: Record<string, unknown>,
    context: WorkflowContext,
    options: InterpolationOptions
  ): InterpolationResult {
    const result: Record<string, unknown> = {};
    const allErrors: string[] = [];
    let allSuccess = true;
    
    for (const [key, value] of Object.entries(obj)) {
      const interpolationResult = this.interpolateValue(value, context, options);
      result[key] = interpolationResult.value;
      
      if (!interpolationResult.success) {
        allSuccess = false;
        allErrors.push(...interpolationResult.errors);
      }
    }
    
    return {
      success: allSuccess,
      value: result,
      errors: allErrors
    };
  }
  
  /**
   * Interpolate variables in an array
   */
  private interpolateArray(
    arr: unknown[],
    context: WorkflowContext,
    options: InterpolationOptions
  ): InterpolationResult {
    const result: unknown[] = [];
    const allErrors: string[] = [];
    let allSuccess = true;
    
    for (const item of arr) {
      const interpolationResult = this.interpolateValue(item, context, options);
      result.push(interpolationResult.value);
      
      if (!interpolationResult.success) {
        allSuccess = false;
        allErrors.push(...interpolationResult.errors);
      }
    }
    
    return {
      success: allSuccess,
      value: result,
      errors: allErrors
    };
  }
  
  /**
   * Process string interpolation with recursion tracking
   */
  private processString(
    value: string,
    context: WorkflowContext,
    options: InterpolationOptions & {
      currentDepth: number;
      errors: string[];
    }
  ): string {
    if (options.currentDepth >= (options.maxDepth || 10)) {
      options.errors.push(`Maximum interpolation depth (${options.maxDepth}) exceeded`);
      return value;
    }
    
    return value.replace(VariableInterpolator.INTERPOLATION_REGEX, (match, expression) => {
      try {
        const resolvedValue = this.resolveExpression(
          expression.trim(),
          context,
          options
        );
        
        // Convert resolved value to string
        if (resolvedValue === null || resolvedValue === undefined) {
          if (options.strictMode) {
            options.errors.push(`Undefined variable in expression: ${expression}`);
            return match; // Return original if strict mode
          }
          return '';
        }
        
        // Handle string values that might contain further interpolation
        if (typeof resolvedValue === 'string' && resolvedValue.includes('{{')) {
          return this.processString(resolvedValue, context, {
            ...options,
            currentDepth: options.currentDepth + 1
          });
        }
        
        // Handle objects and arrays by converting to JSON
        if (typeof resolvedValue === 'object') {
          try {
            return JSON.stringify(resolvedValue);
          } catch {
            return String(resolvedValue);
          }
        }
        
        return String(resolvedValue);
      } catch (error) {
        const errorMsg = `Failed to resolve expression "${expression}": ${error instanceof Error ? error.message : String(error)}`;
        options.errors.push(errorMsg);
        
        if (options.strictMode) {
          throw new Error(errorMsg);
        }
        
        return match; // Return original expression on error
      }
    });
  }
  
  /**
   * Resolve a single expression
   */
  private resolveExpression(
    expression: string,
    context: WorkflowContext,
    options: InterpolationOptions & { errors: string[] }
  ): unknown {
    // Handle function calls
    const functionMatch = expression.match(VariableInterpolator.FUNCTION_REGEX);
    if (functionMatch) {
      const [, functionName, argsStr] = functionMatch;
      return this.callFunction(functionName, argsStr, context, options);
    }
    
    // Handle variable references
    return this.resolveVariableReference(expression, context, options);
  }
  
  /**
   * Resolve variable reference with support for nested access and array indexing
   */
  private resolveVariableReference(
    reference: string,
    context: WorkflowContext,
    options: InterpolationOptions & { errors: string[] }
  ): unknown {
    // Check for array indexing
    const arrayMatch = reference.match(VariableInterpolator.ARRAY_INDEX_REGEX);
    if (arrayMatch) {
      const [, basePath, indexStr] = arrayMatch;
      const index = parseInt(indexStr, 10);
      const baseValue = this.resolveVariableReference(basePath, context, options);
      
      if (Array.isArray(baseValue)) {
        return baseValue[index];
      } else {
        options.errors.push(`Cannot index non-array value at path: ${basePath}`);
        return undefined;
      }
    }
    
    // Handle different variable scopes
    if (reference.startsWith('variables.')) {
      const varPath = reference.substring('variables.'.length);
      return this.getNestedValue(context.getVariables(), varPath);
    }
    
    if (reference.startsWith('steps.')) {
      const stepPath = reference.substring('steps.'.length);
      const [stepId, ...propertyPath] = stepPath.split('.');
      const stepOutput = context.getStepOutput(stepId);
      
      if (propertyPath.length === 0) {
        return stepOutput;
      }
      
      return this.getNestedValue(stepOutput, propertyPath.join('.'));
    }
    
    if (reference.startsWith('env.')) {
      const envVar = reference.substring('env.'.length);
      return context.getEnvironmentVariables()[envVar] || process.env[envVar];
    }
    
    if (reference.startsWith('workflow.')) {
      const workflowProp = reference.substring('workflow.'.length);
      switch (workflowProp) {
        case 'id':
          return context.getWorkflowId();
        case 'currentStepId':
          return context.getCurrentStepId();
        case 'startTime':
          return context.getStartTime().toISOString();
        case 'executionTime':
          return context.getExecutionDuration();
        default:
          options.errors.push(`Unknown workflow property: ${workflowProp}`);
          return undefined;
      }
    }
    
    // Default variable lookup (shorthand for variables.X)
    if (!reference.includes('.')) {
      return context.getVariable(reference);
    }
    
    // Try as nested variable path
    return this.getNestedValue(context.getVariables(), reference);
  }
  
  /**
   * Call a function with arguments
   */
  private callFunction(
    functionName: string,
    argsStr: string,
    context: WorkflowContext,
    options: InterpolationOptions & { errors: string[] }
  ): unknown {
    try {
      // Parse arguments (simple implementation)
      const args = this.parseArguments(argsStr, context, options);
      
      // Check custom functions first
      if (options.customFunctions && options.customFunctions[functionName]) {
        return options.customFunctions[functionName](...args);
      }
      
      // Check builtin functions
      if (this.builtinFunctions.hasFunction(functionName)) {
        return this.builtinFunctions.callFunction(functionName, args, context);
      }
      
      throw new Error(`Unknown function: ${functionName}`);
    } catch (error) {
      options.errors.push(`Function call failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }
  
  /**
   * Parse function arguments
   */
  private parseArguments(
    argsStr: string,
    context: WorkflowContext,
    options: InterpolationOptions & { errors: string[] }
  ): unknown[] {
    if (!argsStr.trim()) {
      return [];
    }
    
    // Simple argument parsing (could be improved for more complex cases)
    const args: unknown[] = [];
    const argStrings = this.splitArguments(argsStr);
    
    for (const argStr of argStrings) {
      const trimmed = argStr.trim();
      
      // Handle string literals
      if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        args.push(trimmed.slice(1, -1));
        continue;
      }
      
      // Handle numbers
      if (/^\d+(\.\d+)?$/.test(trimmed)) {
        args.push(parseFloat(trimmed));
        continue;
      }
      
      // Handle booleans
      if (trimmed === 'true' || trimmed === 'false') {
        args.push(trimmed === 'true');
        continue;
      }
      
      // Handle variable references
      args.push(this.resolveVariableReference(trimmed, context, options));
    }
    
    return args;
  }
  
  /**
   * Split argument string by commas, respecting quotes
   */
  private splitArguments(argsStr: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      
      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        current += char;
      } else if (!inQuotes && char === ',') {
        args.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current) {
      args.push(current);
    }
    
    return args;
  }
  
  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    if (!obj || typeof obj !== 'object') {
      return undefined;
    }
    
    return path.split('.').reduce((current, key) => {
      if (current === null || current === undefined) {
        return undefined;
      }
      
      // Handle array indexing in nested paths
      const arrayMatch = key.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, arrayKey, indexStr] = arrayMatch;
        const index = parseInt(indexStr, 10);
        const arrayValue = current[arrayKey];
        
        if (Array.isArray(arrayValue)) {
          return arrayValue[index];
        }
        return undefined;
      }
      
      return current && typeof current === 'object' ? current[key] : undefined;
    }, obj);
  }
}