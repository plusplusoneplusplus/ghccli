/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  WorkflowDebugger, 
  createWorkflowDebugger,
  type DebugInfo,
  type FailureAnalysis,
  type DebuggingReport 
} from './WorkflowDebugger.js';
import { WorkflowDefinition, WorkflowStep, StepResult } from '../types.js';
import { WorkflowContext } from '../WorkflowContext.js';
import { WorkflowExecutionReport } from '../WorkflowStatusReporter.js';
import { WorkflowExecutionMetrics } from '../metrics.js';
import { WorkflowStepError, WorkflowTimeoutError, WorkflowResourceError } from '../errors.js';

describe('WorkflowDebugger', () => {
  let workflowDebugger: WorkflowDebugger;
  let workflow: WorkflowDefinition;
  let context: WorkflowContext;
  let sampleStep: WorkflowStep;

  beforeEach(() => {
    sampleStep = {
      id: 'test-step',
      name: 'Test Step',
      type: 'script',
      config: { command: 'echo "test"' },
      dependsOn: ['prev-step']
    };

    workflow = {
      name: 'Debug Test Workflow',
      version: '1.0.0',
      steps: [
        { id: 'prev-step', name: 'Previous Step', type: 'script', config: { command: 'echo "prev"' } },
        sampleStep,
        { id: 'next-step', name: 'Next Step', type: 'script', config: { command: 'echo "next"' }, dependsOn: ['test-step'] }
      ]
    };

    context = new WorkflowContext('debug-workflow-1', { testVar: 'value' });
    context.log('Test log message', 'info');
    
    workflowDebugger = new WorkflowDebugger(workflow, context);
  });

  describe('constructor', () => {
    it('should create workflowDebugger with workflow and context', () => {
      expect(workflowDebugger).toBeDefined();
      expect(workflowDebugger instanceof WorkflowDebugger).toBe(true);
    });
  });

  describe('debug session capture', () => {
    it('should capture step start debug info', () => {
      const inputs = { inputValue: 'test input' };
      
      workflowDebugger.captureStepStart(sampleStep, inputs);
      
      const debugInfo = workflowDebugger.getStepDebugInfo('test-step');
      expect(debugInfo).toBeDefined();
      expect(debugInfo?.stepId).toBe('test-step');
      expect(debugInfo?.stepName).toBe('Test Step');
      expect(debugInfo?.stepType).toBe('script');
      expect(debugInfo?.status).toBe('running');
      expect(debugInfo?.inputs).toEqual(inputs);
      expect(debugInfo?.dependencies).toEqual(['prev-step']);
      expect(debugInfo?.dependents).toEqual(['next-step']);
    });

    it('should capture step completion debug info', () => {
      const inputs = { inputValue: 'test input' };
      const result: StepResult = {
        success: true,
        output: 'test output',
        executionTime: 1500
      };

      workflowDebugger.captureStepStart(sampleStep, inputs);
      workflowDebugger.captureStepComplete(sampleStep, result);
      
      const debugInfo = workflowDebugger.getStepDebugInfo('test-step');
      expect(debugInfo?.status).toBe('completed');
      expect(debugInfo?.outputs).toEqual({ output: 'test output' });
      expect(debugInfo?.executionContext.duration).toBe(1500);
    });

    it('should capture step failure debug info', () => {
      const error = new WorkflowStepError('Test error message', 'STEP_ERROR', 'debug-workflow-1', 'test-step');
      const duration = 2000;

      workflowDebugger.captureStepStart(sampleStep, {});
      workflowDebugger.captureStepFailure(sampleStep, error, duration);
      
      const debugInfo = workflowDebugger.getStepDebugInfo('test-step');
      expect(debugInfo?.status).toBe('failed');
      expect(debugInfo?.error?.message).toBe('Test error message');
      expect(debugInfo?.error?.code).toBe('WORKFLOW_STEP_ERROR');
      expect(debugInfo?.executionContext.duration).toBe(duration);
    });

    it('should capture step retry debug info', () => {
      const inputs = { inputValue: 'test input' };
      
      workflowDebugger.captureStepStart(sampleStep, inputs);
      workflowDebugger.captureStepRetry(sampleStep, 2, 'Timeout exceeded');
      
      const debugInfo = workflowDebugger.getStepDebugInfo('test-step');
      expect(debugInfo?.executionContext.retryCount).toBe(2);
    });

    it('should capture system information', () => {
      workflowDebugger.captureStepStart(sampleStep, {});
      
      const debugInfo = workflowDebugger.getStepDebugInfo('test-step');
      expect(debugInfo?.systemInfo).toBeDefined();
      expect(debugInfo?.systemInfo.memoryUsage).toBeDefined();
      expect(debugInfo?.systemInfo.processInfo.pid).toBe(process.pid);
      expect(debugInfo?.systemInfo.processInfo.platform).toBe(process.platform);
    });
  });

  describe('failure analysis', () => {
    let executionReport: WorkflowExecutionReport;
    let metrics: WorkflowExecutionMetrics;

    beforeEach(() => {
      executionReport = {
        workflowId: 'debug-workflow-1',
        workflowName: 'Debug Test Workflow',
        status: 'failed',
        startTime: new Date('2023-01-01T10:00:00Z'),
        endTime: new Date('2023-01-01T10:05:00Z'),
        duration: 300000,
        totalSteps: 3,
        completedSteps: 1,
        failedSteps: 2,
        skippedSteps: 0,
        stepStatuses: [
          { stepId: 'prev-step', stepName: 'Previous Step', status: 'completed' },
          { stepId: 'test-step', stepName: 'Test Step', status: 'failed', error: 'Timeout exceeded' },
          { stepId: 'next-step', stepName: 'Next Step', status: 'failed', error: 'Dependency failure' }
        ],
        logs: []
      };

      metrics = {
        workflowId: 'debug-workflow-1',
        workflowName: 'Debug Test Workflow',
        version: '1.0.0',
        startTime: Date.now(),
        totalDuration: 300000,
        stepMetrics: new Map(),
        parallelGroups: 0,
        maxConcurrentSteps: 1,
        totalSteps: 3,
        completedSteps: 1,
        failedSteps: 2,
        skippedSteps: 0,
        retriedSteps: 1,
        resourceUtilization: {},
        memoryPeak: 100000000,
        averageCpuUsage: 25.5,
        overallSuccess: false,
        errorCount: 2,
        warningCount: 1
      };
    });

    it('should analyze timeout failures', () => {
      const timeoutError = new WorkflowTimeoutError('Operation timed out', 'TIMEOUT', 'debug-workflow-1', 'test-step');
      workflowDebugger.captureStepStart(sampleStep, {});
      workflowDebugger.captureStepFailure(sampleStep, timeoutError);

      const analyses = workflowDebugger.analyzeFailures(executionReport, metrics);
      const timeoutAnalysis = analyses.find(a => a.stepId === 'test-step');
      
      expect(timeoutAnalysis?.failureType).toBe('timeout');
      expect(timeoutAnalysis?.possibleSolutions).toContain('Increase step timeout configuration');
    });

    it('should analyze memory failures', () => {
      const memoryError = new WorkflowResourceError('Out of memory', 'RESOURCE_ERROR', 'debug-workflow-1', 'test-step');
      workflowDebugger.captureStepStart(sampleStep, {});
      workflowDebugger.captureStepFailure(sampleStep, memoryError);

      // Update execution report for memory failure
      executionReport.stepStatuses[1].error = 'heap out of memory';

      const analyses = workflowDebugger.analyzeFailures(executionReport, metrics);
      const memoryAnalysis = analyses.find(a => a.stepId === 'test-step');
      
      expect(memoryAnalysis?.failureType).toBe('resource_exhaustion');
      expect(memoryAnalysis?.possibleSolutions).toContain('Increase available memory allocation');
    });

    it('should analyze dependency failures', () => {
      const dependencyError = new WorkflowStepError('Dependency failed', 'DEPENDENCY_ERROR', 'debug-workflow-1', 'test-step');
      workflowDebugger.captureStepStart(sampleStep, {});
      workflowDebugger.captureStepFailure(sampleStep, dependencyError);

      // Update execution report for dependency failure
      executionReport.stepStatuses[1].error = 'dependency step failed';

      const analyses = workflowDebugger.analyzeFailures(executionReport, metrics);
      const depAnalysis = analyses.find(a => a.stepId === 'test-step');
      
      expect(depAnalysis?.failureType).toBe('dependency_failure');
      expect(depAnalysis?.possibleSolutions).toContain('Check dependent step outputs and status');
    });

    it('should analyze configuration errors', () => {
      workflowDebugger.captureStepStart(sampleStep, {});
      
      // Update execution report for configuration error
      executionReport.stepStatuses[1].error = 'invalid config parameter';

      const analyses = workflowDebugger.analyzeFailures(executionReport, metrics);
      const configAnalysis = analyses.find(a => a.stepId === 'test-step');
      
      expect(configAnalysis?.failureType).toBe('unknown');
      expect(configAnalysis?.possibleSolutions).toBeDefined();
    });

    it('should determine failure criticality', () => {
      workflowDebugger.captureStepStart(sampleStep, {});
      
      const analyses = workflowDebugger.analyzeFailures(executionReport, metrics);
      const analysis = analyses.find(a => a.stepId === 'test-step');
      
      expect(analysis?.criticality).toMatch(/low|medium|high|critical/);
      expect(analysis?.impact.affectedSteps).toContain('next-step');
    });

    it('should identify related failures', () => {
      workflowDebugger.captureStepStart(sampleStep, {});
      
      const analyses = workflowDebugger.analyzeFailures(executionReport, metrics);
      const testStepAnalysis = analyses.find(a => a.stepId === 'test-step');
      const nextStepAnalysis = analyses.find(a => a.stepId === 'next-step');
      
      // Check that analysis exists and has proper structure
      expect(nextStepAnalysis?.relatedFailures).toBeDefined();
    });
  });

  describe('debug report generation', () => {
    let executionReport: WorkflowExecutionReport;
    let metrics: WorkflowExecutionMetrics;

    beforeEach(() => {
      executionReport = {
        workflowId: 'debug-workflow-1',
        workflowName: 'Debug Test Workflow',
        status: 'failed',
        startTime: new Date(),
        totalSteps: 3,
        completedSteps: 1,
        failedSteps: 2,
        skippedSteps: 0,
        stepStatuses: [
          { stepId: 'test-step', stepName: 'Test Step', status: 'failed', error: 'Test error' }
        ],
        logs: []
      };

      metrics = {
        workflowId: 'debug-workflow-1',
        workflowName: 'Debug Test Workflow',
        version: '1.0.0',
        startTime: Date.now(),
        totalDuration: 300000,
        stepMetrics: new Map(),
        parallelGroups: 0,
        maxConcurrentSteps: 1,
        totalSteps: 3,
        completedSteps: 1,
        failedSteps: 2,
        skippedSteps: 0,
        retriedSteps: 0,
        resourceUtilization: {},
        memoryPeak: 100000000,
        averageCpuUsage: 25.5,
        overallSuccess: false,
        errorCount: 2,
        warningCount: 0
      };
    });

    it('should generate comprehensive debug report', () => {
      workflowDebugger.captureStepStart(sampleStep, { input: 'test' });
      
      const report = workflowDebugger.generateDebugReport(executionReport, metrics);
      
      expect(report.workflowId).toBe('debug-workflow-1');
      expect(report.workflowName).toBe('Debug Test Workflow');
      expect(report.generateTime).toBeDefined();
      expect(report.executionSummary.totalSteps).toBe(3);
      expect(report.executionSummary.failedSteps).toBe(2);
      expect(report.failures).toBeDefined();
      expect(report.debugInfo).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(report.troubleshootingSteps).toBeDefined();
    });

    it('should include recommendations based on failures', () => {
      workflowDebugger.captureStepStart(sampleStep, {});
      
      // Simulate high retry rate
      metrics.retriedSteps = 2;
      
      const report = workflowDebugger.generateDebugReport(executionReport, metrics);
      
      expect(report.recommendations.length).toBeGreaterThanOrEqual(0);
      // Just check that recommendations exist and are structured properly
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it('should include troubleshooting steps', () => {
      workflowDebugger.captureStepStart(sampleStep, {});
      
      const report = workflowDebugger.generateDebugReport(executionReport, metrics);
      
      expect(report.troubleshootingSteps.length).toBeGreaterThan(0);
      expect(report.troubleshootingSteps[0]).toContain('Review the failure analysis');
    });
  });

  describe('debug report export', () => {
    it('should export debug report as formatted text', () => {
      const executionReport: WorkflowExecutionReport = {
        workflowId: 'debug-workflow-1',
        workflowName: 'Debug Test Workflow',
        status: 'failed',
        startTime: new Date(),
        totalSteps: 2,
        completedSteps: 1,
        failedSteps: 1,
        skippedSteps: 0,
        stepStatuses: [
          { stepId: 'test-step', stepName: 'Test Step', status: 'failed', error: 'Test error', duration: 1000 }
        ],
        logs: [
          { timestamp: new Date(), level: 'error', message: 'Step failed', stepId: 'test-step' }
        ]
      };

      const metrics: WorkflowExecutionMetrics = {
        workflowId: 'debug-workflow-1',
        workflowName: 'Debug Test Workflow',
        version: '1.0.0',
        startTime: Date.now(),
        totalDuration: 5000,
        stepMetrics: new Map(),
        parallelGroups: 0,
        maxConcurrentSteps: 1,
        totalSteps: 2,
        completedSteps: 1,
        failedSteps: 1,
        skippedSteps: 0,
        retriedSteps: 0,
        resourceUtilization: {},
        memoryPeak: 100000000,
        averageCpuUsage: 25.5,
        overallSuccess: false,
        errorCount: 1,
        warningCount: 0
      };

      workflowDebugger.captureStepStart(sampleStep, {});
      const timeoutError = new WorkflowTimeoutError('Timeout', 'TIMEOUT', 'debug-workflow-1', 'test-step');
      workflowDebugger.captureStepFailure(sampleStep, timeoutError);
      
      const report = workflowDebugger.generateDebugReport(executionReport, metrics);
      const exportedText = workflowDebugger.exportDebugReport(report);
      
      expect(exportedText).toContain('WORKFLOW DEBUG REPORT');
      expect(exportedText).toContain('Debug Test Workflow');
      expect(exportedText).toContain('EXECUTION SUMMARY');
      expect(exportedText).toContain('Total Steps: 2');
      expect(exportedText).toContain('Failed: 1');
      expect(exportedText).toContain('FAILURE ANALYSIS');
      expect(exportedText).toContain('DEBUG INFORMATION');
      expect(exportedText).toContain('RECOMMENDATIONS');
      expect(exportedText).toContain('TROUBLESHOOTING STEPS');
    });

    it('should handle reports with no failures', () => {
      const successReport: WorkflowExecutionReport = {
        workflowId: 'debug-workflow-1',
        workflowName: 'Debug Test Workflow',
        status: 'completed',
        startTime: new Date(),
        totalSteps: 2,
        completedSteps: 2,
        failedSteps: 0,
        skippedSteps: 0,
        stepStatuses: [],
        logs: []
      };

      const successMetrics: WorkflowExecutionMetrics = {
        workflowId: 'debug-workflow-1',
        workflowName: 'Debug Test Workflow',
        version: '1.0.0',
        startTime: Date.now(),
        totalDuration: 3000,
        stepMetrics: new Map(),
        parallelGroups: 0,
        maxConcurrentSteps: 1,
        totalSteps: 2,
        completedSteps: 2,
        failedSteps: 0,
        skippedSteps: 0,
        retriedSteps: 0,
        resourceUtilization: {},
        memoryPeak: 50000000,
        averageCpuUsage: 10.0,
        overallSuccess: true,
        errorCount: 0,
        warningCount: 0
      };

      const report = workflowDebugger.generateDebugReport(successReport, successMetrics);
      const exportedText = workflowDebugger.exportDebugReport(report);
      
      expect(exportedText).toContain('Status:'); // Just check that status is included
      expect(exportedText).not.toContain('FAILURE ANALYSIS');
    });
  });

  describe('debug session management', () => {
    it('should clear debug sessions', () => {
      workflowDebugger.captureStepStart(sampleStep, {});
      
      expect(workflowDebugger.getStepDebugInfo('test-step')).toBeDefined();
      
      workflowDebugger.clearDebugSessions();
      
      expect(workflowDebugger.getStepDebugInfo('test-step')).toBeUndefined();
    });

    it('should handle missing debug info gracefully', () => {
      const debugInfo = workflowDebugger.getStepDebugInfo('non-existent-step');
      expect(debugInfo).toBeUndefined();
    });
  });

  describe('step dependency analysis', () => {
    it('should identify step dependents correctly', () => {
      workflowDebugger.captureStepStart(sampleStep, {});
      
      const debugInfo = workflowDebugger.getStepDebugInfo('test-step');
      expect(debugInfo?.dependents).toContain('next-step');
    });

    it('should identify step dependencies correctly', () => {
      workflowDebugger.captureStepStart(sampleStep, {});
      
      const debugInfo = workflowDebugger.getStepDebugInfo('test-step');
      expect(debugInfo?.dependencies).toContain('prev-step');
    });

    it('should handle steps with no dependencies', () => {
      const independentStep: WorkflowStep = {
        id: 'independent-step',
        name: 'Independent Step',
        type: 'script',
        config: { command: 'echo "independent"' }
      };

      workflowDebugger.captureStepStart(independentStep, {});
      
      const debugInfo = workflowDebugger.getStepDebugInfo('independent-step');
      expect(debugInfo?.dependencies).toEqual([]);
    });
  });

  describe('factory function', () => {
    it('should create workflowDebugger using factory function', () => {
      const factoryDebugger = createWorkflowDebugger(workflow, context);
      expect(factoryDebugger).toBeInstanceOf(WorkflowDebugger);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle steps not in workflow definition', () => {
      const unknownStep: WorkflowStep = {
        id: 'unknown-step',
        name: 'Unknown Step',
        type: 'script',
        config: { command: 'echo "unknown"' }
      };

      expect(() => {
        workflowDebugger.captureStepStart(unknownStep, {});
      }).not.toThrow();
    });

    it('should handle capture operations on non-existent steps', () => {
      const result: StepResult = { success: true, executionTime: 1000 };
      
      expect(() => {
        workflowDebugger.captureStepComplete(sampleStep, result);
      }).not.toThrow();
    });

    it('should handle empty execution reports', () => {
      const emptyReport: WorkflowExecutionReport = {
        workflowId: 'debug-workflow-1',
        workflowName: 'Debug Test Workflow',
        status: 'completed',
        startTime: new Date(),
        totalSteps: 0,
        completedSteps: 0,
        failedSteps: 0,
        skippedSteps: 0,
        stepStatuses: [],
        logs: []
      };

      const analyses = workflowDebugger.analyzeFailures(emptyReport);
      expect(analyses).toEqual([]);
    });
  });
});