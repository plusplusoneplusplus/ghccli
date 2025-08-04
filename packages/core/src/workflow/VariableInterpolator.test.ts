/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { VariableInterpolator } from './VariableInterpolator.js';
import { WorkflowContext } from './WorkflowContext.js';

describe('VariableInterpolator', () => {
  let interpolator: VariableInterpolator;
  let context: WorkflowContext;

  beforeEach(() => {
    interpolator = new VariableInterpolator();
    context = new WorkflowContext('test-workflow', {
      name: 'John',
      config: {
        timeout: 5000,
        settings: {
          debug: true
        }
      },
      items: ['apple', 'banana', 'cherry']
    });
    
    // Set environment variables
    context.setEnvironmentVariable('NODE_ENV', 'test');
    context.setEnvironmentVariable('API_KEY', 'secret123');
    
    // Set step outputs
    context.setStepOutput('fetch-data', {
      status: 'success',
      data: {
        count: 42,
        results: ['item1', 'item2']
      }
    });
    
    context.setCurrentStepId('current-step');
  });

  describe('Basic string interpolation', () => {
    test('should interpolate simple variables', () => {
      const result = interpolator.interpolateString('Hello {{name}}!', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Hello John!');
      expect(result.errors).toHaveLength(0);
    });

    test('should handle multiple variables in one string', () => {
      const result = interpolator.interpolateString(
        'User {{name}} has {{config.timeout}}ms timeout', 
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('User John has 5000ms timeout');
    });

    test('should handle variables with variables prefix', () => {
      const result = interpolator.interpolateString('{{variables.name}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('John');
    });
  });

  describe('Nested object access', () => {
    test('should access nested object properties', () => {
      const result = interpolator.interpolateString('Debug: {{config.settings.debug}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Debug: true');
    });

    test('should handle non-existent nested properties gracefully', () => {
      const result = interpolator.interpolateString('Missing: {{config.missing.property}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Missing: ');
    });
  });

  describe('Array indexing', () => {
    test('should access array elements by index', () => {
      const result = interpolator.interpolateString('First item: {{items[0]}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('First item: apple');
    });

    test('should access nested array elements', () => {
      const result = interpolator.interpolateString('Result: {{steps.fetch-data.data.results[1]}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Result: item2');
    });

    test('should handle out-of-bounds array access', () => {
      const result = interpolator.interpolateString('Missing: {{items[10]}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Missing: ');
    });
  });

  describe('Step outputs', () => {
    test('should access step outputs', () => {
      const result = interpolator.interpolateString('Status: {{steps.fetch-data.status}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Status: success');
    });

    test('should access entire step output', () => {
      const result = interpolator.interpolateString('{{steps.fetch-data}}', context);
      
      expect(result.success).toBe(true);
      expect(JSON.parse(result.value as string)).toEqual({
        status: 'success',
        data: {
          count: 42,
          results: ['item1', 'item2']
        }
      });
    });
  });

  describe('Environment variables', () => {
    test('should access environment variables', () => {
      const result = interpolator.interpolateString('Environment: {{env.NODE_ENV}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Environment: test');
    });

    test('should handle missing environment variables', () => {
      const result = interpolator.interpolateString('Missing env: {{env.MISSING_VAR}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Missing env: ');
    });
  });

  describe('Workflow properties', () => {
    test('should access workflow ID', () => {
      const result = interpolator.interpolateString('Workflow: {{workflow.id}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Workflow: test-workflow');
    });

    test('should access current step ID', () => {
      const result = interpolator.interpolateString('Step: {{workflow.currentStepId}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Step: current-step');
    });

    test('should access start time', () => {
      const result = interpolator.interpolateString('Started: {{workflow.startTime}}', context);
      
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
      expect((result.value as string).includes('T')).toBe(true); // ISO format
    });
  });

  describe('Built-in functions', () => {
    test('should call string manipulation functions', () => {
      const result = interpolator.interpolateString('{{upper(name)}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('JOHN');
    });

    test('should call date functions', () => {
      const result = interpolator.interpolateString('Today: {{date()}}', context);
      
      expect(result.success).toBe(true);
      expect(typeof result.value).toBe('string');
      expect((result.value as string).includes('-')).toBe(true);
    });

    test('should call functions with multiple arguments', () => {
      const result = interpolator.interpolateString('{{replace(name, "John", "Jane")}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Jane');
    });

    test('should call math functions', () => {
      const result = interpolator.interpolateString('Total: {{add(10, 32)}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Total: 42');
    });

    test('should call utility functions', () => {
      const result = interpolator.interpolateString('Length: {{length(items)}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Length: 3');
    });

    test('should handle function errors gracefully', () => {
      const result = interpolator.interpolateString('{{divide(10, 0)}}', context);
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Division by zero');
    });
  });

  describe('Object and array interpolation', () => {
    test('should interpolate object values', () => {
      const input = {
        message: 'Hello {{name}}!',
        timeout: '{{config.timeout}}',
        items: ['{{items[0]}}', 'static']
      };
      
      const result = interpolator.interpolateValue(input, context);
      
      expect(result.success).toBe(true);
      expect(result.value).toEqual({
        message: 'Hello John!',
        timeout: '5000',
        items: ['apple', 'static']
      });
    });

    test('should interpolate array values', () => {
      const input = ['Hello {{name}}', '{{config.timeout}}', 'static'];
      
      const result = interpolator.interpolateValue(input, context);
      
      expect(result.success).toBe(true);
      expect(result.value).toEqual(['Hello John', '5000', 'static']);
    });

    test('should handle nested objects and arrays', () => {
      const input = {
        user: {
          greeting: 'Hello {{name}}',
          settings: {
            timeout: '{{config.timeout}}'
          }
        },
        items: ['{{items[0]}}', '{{items[1]}}']
      };
      
      const result = interpolator.interpolateValue(input, context);
      
      expect(result.success).toBe(true);
      expect(result.value).toEqual({
        user: {
          greeting: 'Hello John',
          settings: {
            timeout: '5000'
          }
        },
        items: ['apple', 'banana']
      });
    });
  });

  describe('Recursive interpolation', () => {
    test('should handle recursive interpolation', () => {
      context.setVariable('template', 'Hello {{name}}!');
      
      const result = interpolator.interpolateString('{{template}}', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Hello John!');
    });

    test('should prevent infinite recursion', () => {
      context.setVariable('recursive', '{{recursive}}');
      
      const result = interpolator.interpolateString('{{recursive}}', context, { maxDepth: 3 });
      
      expect(result.success).toBe(false);
      expect(result.errors.some(error => error.includes('Maximum interpolation depth'))).toBe(true);
    });
  });

  describe('Strict mode', () => {
    test('should handle undefined variables in strict mode', () => {
      const result = interpolator.interpolateString(
        'Missing: {{missing.variable}}', 
        context, 
        { strictMode: true }
      );
      
      expect(result.success).toBe(false);
      expect(result.errors.some(error => error.includes('Undefined variable'))).toBe(true);
    });

    test('should not fail in non-strict mode', () => {
      const result = interpolator.interpolateString(
        'Missing: {{missing.variable}}', 
        context, 
        { strictMode: false }
      );
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Missing: ');
    });
  });

  describe('Custom functions', () => {
    test('should use custom functions', () => {
      const customFunctions = {
        customGreeting: (name: string) => `Custom hello ${name}!`
      };
      
      const result = interpolator.interpolateString(
        '{{customGreeting(name)}}', 
        context, 
        { customFunctions }
      );
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Custom hello John!');
    });
  });

  describe('Error handling', () => {
    test('should collect multiple errors', () => {
      const result = interpolator.interpolateString(
        '{{missing1}} and {{missing2}} and {{divide(1, 0)}}', 
        context, 
        { strictMode: true }
      );
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    test('should handle malformed expressions', () => {
      const result = interpolator.interpolateString('{{unclosed', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('{{unclosed'); // Should return as-is
    });
  });

  describe('Edge cases', () => {
    test('should handle null and undefined values', () => {
      context.setVariable('nullValue', null);
      context.setVariable('undefinedValue', undefined);
      
      const result = interpolator.interpolateString(
        'Null: {{nullValue}}, Undefined: {{undefinedValue}}', 
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Null: , Undefined: ');
    });

    test('should handle boolean and number values', () => {
      context.setVariable('boolValue', true);
      context.setVariable('numValue', 42);
      
      const result = interpolator.interpolateString(
        'Bool: {{boolValue}}, Num: {{numValue}}', 
        context
      );
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Bool: true, Num: 42');
    });

    test('should handle empty strings', () => {
      const result = interpolator.interpolateString('', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('');
    });

    test('should handle strings without interpolation', () => {
      const result = interpolator.interpolateString('Plain text', context);
      
      expect(result.success).toBe(true);
      expect(result.value).toBe('Plain text');
    });
  });
});