/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorkflowContext } from './WorkflowContext.js';

describe('WorkflowContext', () => {
  let context: WorkflowContext;

  beforeEach(() => {
    context = new WorkflowContext('test-workflow', { testVar: 'test' }, { NODE_ENV: 'test' });
  });

  describe('constructor', () => {
    it('should initialize with provided values', () => {
      expect(context.getWorkflowId()).toBe('test-workflow');
      expect(context.getVariable('testVar')).toBe('test');
      expect(context.getEnvironmentVariables()).toEqual({ NODE_ENV: 'test' });
    });
  });

  describe('variable management', () => {
    it('should get and set variables', () => {
      context.setVariable('newVar', 'newValue');
      expect(context.getVariable('newVar')).toBe('newValue');
    });

    it('should set multiple variables', () => {
      context.setVariables({ var1: 'value1', var2: 'value2' });
      
      expect(context.getVariable('var1')).toBe('value1');
      expect(context.getVariable('var2')).toBe('value2');
    });

    it('should return all variables', () => {
      context.setVariable('additionalVar', 'additionalValue');
      
      const variables = context.getVariables();
      expect(variables).toEqual({
        testVar: 'test',
        additionalVar: 'additionalValue'
      });
    });

    it('should return undefined for non-existent variables', () => {
      expect(context.getVariable('nonExistent')).toBeUndefined();
    });
  });

  describe('environment variable management', () => {
    it('should get and set environment variables', () => {
      context.setEnvironmentVariable('NEW_ENV', 'newValue');
      
      const envVars = context.getEnvironmentVariables();
      expect(envVars.NEW_ENV).toBe('newValue');
      expect(envVars.NODE_ENV).toBe('test');
    });
  });

  describe('step output management', () => {
    it('should store and retrieve step outputs', () => {
      const output = { result: 'success', data: [1, 2, 3] };
      context.setStepOutput('step1', output);
      
      expect(context.getStepOutput('step1')).toEqual(output);
      expect(context.hasStepOutput('step1')).toBe(true);
      expect(context.hasStepOutput('step2')).toBe(false);
    });

    it('should return all step outputs', () => {
      context.setStepOutput('step1', 'output1');
      context.setStepOutput('step2', 'output2');
      
      const outputs = context.getAllStepOutputs();
      expect(outputs).toEqual({
        step1: 'output1',
        step2: 'output2'
      });
    });
  });

  describe('step tracking', () => {
    it('should track current step', () => {
      expect(context.getCurrentStepId()).toBeNull();
      
      context.setCurrentStepId('step1');
      expect(context.getCurrentStepId()).toBe('step1');
      
      context.setCurrentStepId(null);
      expect(context.getCurrentStepId()).toBeNull();
    });
  });

  describe('logging', () => {
    beforeEach(() => {
      // Mock console methods to avoid actual console output during tests
      vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.spyOn(console, 'debug').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should log messages with different levels', () => {
      context.log('Info message', 'info');
      context.log('Debug message', 'debug');
      context.log('Warning message', 'warn');
      context.log('Error message', 'error');
      
      const logs = context.getLogs();
      expect(logs).toHaveLength(4);
      expect(logs[0].level).toBe('info');
      expect(logs[1].level).toBe('debug');
      expect(logs[2].level).toBe('warn');
      expect(logs[3].level).toBe('error');
    });

    it('should default to info level', () => {
      context.log('Default message');
      
      const logs = context.getLogs();
      expect(logs[0].level).toBe('info');
    });

    it('should associate logs with steps', () => {
      context.log('Step message', 'info', 'step1');
      
      const logs = context.getLogs();
      expect(logs[0].stepId).toBe('step1');
    });

    it('should use current step for logs when no step specified', () => {
      context.setCurrentStepId('currentStep');
      context.log('Current step message');
      
      const logs = context.getLogs();
      expect(logs[0].stepId).toBe('currentStep');
    });

    it('should filter logs by level', () => {
      context.log('Info message', 'info');
      context.log('Error message', 'error');
      context.log('Another info message', 'info');
      
      const infoLogs = context.getLogsByLevel('info');
      const errorLogs = context.getLogsByLevel('error');
      
      expect(infoLogs).toHaveLength(2);
      expect(errorLogs).toHaveLength(1);
    });

    it('should filter logs by step', () => {
      context.log('Step1 message', 'info', 'step1');
      context.log('Step2 message', 'info', 'step2');
      context.log('Another step1 message', 'info', 'step1');
      
      const step1Logs = context.getLogsForStep('step1');
      const step2Logs = context.getLogsForStep('step2');
      
      expect(step1Logs).toHaveLength(2);
      expect(step2Logs).toHaveLength(1);
    });

    it('should clear logs', () => {
      context.log('Message 1');
      context.log('Message 2');
      
      expect(context.getLogs()).toHaveLength(2);
      
      context.clearLogs();
      expect(context.getLogs()).toHaveLength(0);
    });
  });

  describe('timing', () => {
    it('should track start time and execution duration', () => {
      const startTime = context.getStartTime();
      expect(startTime).toBeInstanceOf(Date);
      
      // Duration should be positive (even if very small)
      const duration = context.getExecutionDuration();
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('snapshots', () => {
    it('should create and restore snapshots', () => {
      // Set up context state
      context.setVariable('testVar', 'modifiedValue');
      context.setStepOutput('step1', 'output1');
      context.setCurrentStepId('currentStep');
      context.log('Test log message');
      
      // Create snapshot
      const snapshot = context.createSnapshot();
      
      expect(snapshot.workflowId).toBe('test-workflow');
      expect(snapshot.currentStepId).toBe('currentStep');
      expect(snapshot.variables.testVar).toBe('modifiedValue');
      expect(snapshot.stepOutputs.step1).toBe('output1');
      expect(snapshot.logs).toHaveLength(1);
      
      // Modify context
      context.setVariable('testVar', 'newValue');
      context.setCurrentStepId('newStep');
      context.clearLogs();
      
      // Restore from snapshot
      context.restoreFromSnapshot(snapshot);
      
      expect(context.getCurrentStepId()).toBe('currentStep');
      expect(context.getVariable('testVar')).toBe('modifiedValue');
      expect(context.getStepOutput('step1')).toBe('output1');
      expect(context.getLogs()).toHaveLength(1);
    });
  });

  describe('expression evaluation', () => {
    beforeEach(() => {
      context.setVariable('testValue', 'hello');
      context.setVariable('nested', { prop: 'world' });
      context.setStepOutput('step1', { result: 'success' });
      context.setEnvironmentVariable('TEST_ENV', 'env_value');
    });

    it('should evaluate variable expressions', () => {
      expect(context.evaluateExpression('variables.testValue')).toBe('hello');
      expect(context.evaluateExpression('variables.nested.prop')).toBe('world');
    });

    it('should evaluate step output expressions', () => {
      expect(context.evaluateExpression('steps.step1.result')).toBe('success');
      expect(context.evaluateExpression('steps.step1')).toEqual({ result: 'success' });
    });

    it('should evaluate environment expressions', () => {
      expect(context.evaluateExpression('env.TEST_ENV')).toBe('env_value');
    });

    it('should return expression as-is for unrecognized patterns', () => {
      expect(context.evaluateExpression('unknown.pattern')).toBe('unknown.pattern');
    });

    it('should return undefined for non-existent paths', () => {
      expect(context.evaluateExpression('variables.nonExistent')).toBeUndefined();
      expect(context.evaluateExpression('steps.nonExistent.prop')).toBeUndefined();
    });
  });
});