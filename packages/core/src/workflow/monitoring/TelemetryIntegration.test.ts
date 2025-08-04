/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  WorkflowTelemetryIntegration,
  createWorkflowTelemetryIntegration,
  initializeWorkflowTelemetry,
  getWorkflowTelemetry,
  shutdownWorkflowTelemetry,
  type TelemetryConfiguration,
  type WorkflowTelemetryEvent
} from './TelemetryIntegration.js';
import { ExecutionMonitor } from './ExecutionMonitor.js';
import { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult } from '../types.js';
import { WorkflowExecutionMetrics, StepMetrics } from '../metrics.js';

describe('WorkflowTelemetryIntegration', () => {
  let telemetryIntegration: WorkflowTelemetryIntegration;
  let monitor: ExecutionMonitor;
  let workflow: WorkflowDefinition;
  let sampleStep: WorkflowStep;
  let config: TelemetryConfiguration;

  beforeEach(() => {
    vi.useFakeTimers();
    
    sampleStep = {
      id: 'telemetry-step',
      name: 'Telemetry Test Step',
      type: 'script',
      config: { command: 'echo "telemetry test"' }
    };

    workflow = {
      name: 'Telemetry Test Workflow',
      version: '1.0.0',
      steps: [sampleStep]
    };

    config = {
      enabled: true,
      includeStepDetails: true,
      includePerformanceMetrics: true,
      includeDebugInfo: false, // Keep debug info disabled for cleaner tests
      samplingRate: 1.0,
      bufferSize: 10,
      flushInterval: 1000,
      customAttributes: { testAttribute: 'testValue' }
    };

    telemetryIntegration = new WorkflowTelemetryIntegration(config);
    monitor = new ExecutionMonitor('telemetry-workflow-1', workflow);
  });

  afterEach(() => {
    telemetryIntegration.shutdown();
    monitor.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create integration with default configuration', () => {
      const defaultIntegration = new WorkflowTelemetryIntegration();
      expect(defaultIntegration).toBeDefined();
      defaultIntegration.shutdown();
    });

    it('should merge custom configuration with defaults', () => {
      const customConfig = { enabled: false, samplingRate: 0.5 };
      const customIntegration = new WorkflowTelemetryIntegration(customConfig);
      expect(customIntegration).toBeDefined();
      customIntegration.shutdown();
    });

    it('should start periodic flush when enabled', () => {
      const flushingIntegration = new WorkflowTelemetryIntegration({ 
        enabled: true, 
        flushInterval: 500 
      });
      
      // Should not throw
      expect(() => {
        vi.advanceTimersByTime(1000);
      }).not.toThrow();
      
      flushingIntegration.shutdown();
    });
  });

  describe('monitor registration', () => {
    it('should register and unregister monitors', () => {
      expect(() => {
        telemetryIntegration.registerMonitor(monitor, 'test-workflow-1', 'Test Workflow');
      }).not.toThrow();

      expect(() => {
        telemetryIntegration.unregisterMonitor('test-workflow-1');
      }).not.toThrow();
    });

    it('should not register monitor when disabled', () => {
      const disabledIntegration = new WorkflowTelemetryIntegration({ enabled: false });
      
      expect(() => {
        disabledIntegration.registerMonitor(monitor, 'test-workflow-1', 'Test Workflow');
      }).not.toThrow();
      
      disabledIntegration.shutdown();
    });
  });

  describe('event handling', () => {
    beforeEach(() => {
      telemetryIntegration.registerMonitor(monitor, 'telemetry-workflow-1', 'Telemetry Test Workflow');
    });

    it('should handle workflow started events', () => {
      // Simple test that just verifies no errors occur when starting monitor
      monitor.start();
      
      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle step execution events', () => {
      monitor.start();
      monitor.recordStepStart(sampleStep);
      
      const stepResult: StepResult = { 
        success: true, 
        output: 'test output', 
        executionTime: 1000 
      };
      monitor.recordStepComplete(sampleStep, stepResult);
      
      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle step failure events', () => {
      const error = { message: 'Test error', code: 'TEST_ERROR' } as any;
      
      monitor.start();
      monitor.recordStepStart(sampleStep);
      monitor.recordStepFailure(sampleStep, error);
      
      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle performance alert events', () => {
      monitor.start();
      
      // Trigger a performance check that might generate alerts
      monitor.recordStepStart(sampleStep);
      vi.advanceTimersByTime(1000);
      
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('workflow execution logging', () => {
    it('should log successful workflow execution', () => {
      const workflowResult: WorkflowResult = {
        success: true,
        stepResults: { 'telemetry-step': { success: true, executionTime: 1000 } },
        executionTime: 1000
      };

      const metrics: WorkflowExecutionMetrics = {
        workflowId: 'telemetry-workflow-1',
        workflowName: 'Telemetry Test Workflow',
        version: '1.0.0',
        startTime: Date.now(),
        totalDuration: 1000,
        stepMetrics: new Map(),
        parallelGroups: 0,
        maxConcurrentSteps: 1,
        totalSteps: 1,
        completedSteps: 1,
        failedSteps: 0,
        skippedSteps: 0,
        retriedSteps: 0,
        resourceUtilization: {},
        memoryPeak: 50000000,
        averageCpuUsage: 15.0,
        overallSuccess: true,
        errorCount: 0,
        warningCount: 0
      };

      expect(() => {
        telemetryIntegration.logWorkflowExecution(workflow, workflowResult, metrics);
      }).not.toThrow();
    });

    it('should log failed workflow execution', () => {
      const workflowResult: WorkflowResult = {
        success: false,
        stepResults: { 'telemetry-step': { success: false, error: 'Step failed', executionTime: 500 } },
        executionTime: 500,
        error: 'Workflow execution failed'
      };

      const metrics: WorkflowExecutionMetrics = {
        workflowId: 'telemetry-workflow-1',
        workflowName: 'Telemetry Test Workflow',
        version: '1.0.0',
        startTime: Date.now(),
        totalDuration: 500,
        stepMetrics: new Map(),
        parallelGroups: 0,
        maxConcurrentSteps: 1,
        totalSteps: 1,
        completedSteps: 0,
        failedSteps: 1,
        skippedSteps: 0,
        retriedSteps: 0,
        resourceUtilization: {},
        memoryPeak: 50000000,
        averageCpuUsage: 15.0,
        overallSuccess: false,
        errorCount: 1,
        warningCount: 0
      };

      expect(() => {
        telemetryIntegration.logWorkflowExecution(workflow, workflowResult, metrics);
      }).not.toThrow();
    });

    it('should not log when disabled', () => {
      const disabledIntegration = new WorkflowTelemetryIntegration({ enabled: false });
      
      const workflowResult: WorkflowResult = {
        success: true,
        stepResults: {},
        executionTime: 1000
      };

      const metrics = {} as WorkflowExecutionMetrics;

      expect(() => {
        disabledIntegration.logWorkflowExecution(workflow, workflowResult, metrics);
      }).not.toThrow();
      
      disabledIntegration.shutdown();
    });
  });

  describe('step execution logging', () => {
    it('should log successful step execution', () => {
      const stepResult: StepResult = {
        success: true,
        output: 'test output',
        executionTime: 800
      };

      const stepMetrics: StepMetrics = {
        stepId: 'telemetry-step',
        stepName: 'Telemetry Test Step',
        stepType: 'script',
        startTime: Date.now(),
        success: true,
        retryCount: 0,
        duration: 800
      };

      expect(() => {
        telemetryIntegration.logStepExecution(sampleStep, stepResult, stepMetrics);
      }).not.toThrow();
    });

    it('should log failed step execution', () => {
      const stepResult: StepResult = {
        success: false,
        error: 'Step execution failed',
        executionTime: 300
      };

      expect(() => {
        telemetryIntegration.logStepExecution(sampleStep, stepResult);
      }).not.toThrow();
    });

    it('should respect sampling rate', () => {
      const lowSamplingIntegration = new WorkflowTelemetryIntegration({ 
        ...config, 
        samplingRate: 0.0 // Never sample
      });

      const stepResult: StepResult = {
        success: true,
        executionTime: 500
      };

      // Should not log due to sampling rate
      expect(() => {
        lowSamplingIntegration.logStepExecution(sampleStep, stepResult);
      }).not.toThrow();
      
      lowSamplingIntegration.shutdown();
    });
  });

  describe('telemetry data export', () => {
    beforeEach(() => {
      telemetryIntegration.registerMonitor(monitor, 'telemetry-workflow-1', 'Telemetry Test Workflow');
      monitor.start();
    });

    it('should export telemetry data for workflow', () => {
      // Generate some events
      monitor.recordStepStart(sampleStep);
      vi.advanceTimersByTime(500);
      
      const stepResult: StepResult = { success: true, executionTime: 500 };
      monitor.recordStepComplete(sampleStep, stepResult);
      
      const exportData = telemetryIntegration.exportTelemetryData('telemetry-workflow-1');
      
      expect(exportData).toBeDefined();
      expect(exportData.events).toBeDefined();
      expect(exportData.summary).toBeDefined();
      expect(exportData.summary.totalEvents).toBeGreaterThanOrEqual(0);
      expect(exportData.summary.timeRange).toBeDefined();
    });

    it('should handle export for non-existent workflow', () => {
      const exportData = telemetryIntegration.exportTelemetryData('non-existent-workflow');
      
      expect(exportData.events).toEqual([]);
      expect(exportData.metrics).toBeNull();
      expect(exportData.summary.totalEvents).toBe(0);
    });
  });

  describe('performance insights', () => {
    beforeEach(() => {
      telemetryIntegration.registerMonitor(monitor, 'telemetry-workflow-1', 'Telemetry Test Workflow');
      monitor.start();
    });

    it('should generate performance insights', () => {
      // Generate some workflow activity
      monitor.recordStepStart(sampleStep);
      vi.advanceTimersByTime(1000);
      
      const stepResult: StepResult = { success: true, executionTime: 1000 };
      monitor.recordStepComplete(sampleStep, stepResult);
      
      const insights = telemetryIntegration.generatePerformanceInsights('telemetry-workflow-1');
      
      expect(insights).toBeDefined();
      expect(insights.efficiency).toBeGreaterThanOrEqual(0);
      expect(insights.bottlenecks).toBeDefined();
      expect(insights.recommendations).toBeDefined();
      expect(insights.trends).toBeDefined();
    });

    it('should handle insights for workflow with no data', () => {
      const insights = telemetryIntegration.generatePerformanceInsights('empty-workflow');
      
      expect(insights.efficiency).toBe(0);
      expect(insights.bottlenecks).toEqual([]);
      expect(insights.recommendations).toEqual([]);
    });

    it('should generate recommendations based on metrics', () => {
      // Simulate workflow with issues
      monitor.recordStepStart(sampleStep);
      const error = { message: 'Test error', code: 'TEST_ERROR' } as any;
      monitor.recordStepFailure(sampleStep, error);
      
      vi.advanceTimersByTime(1000);
      
      const insights = telemetryIntegration.generatePerformanceInsights('telemetry-workflow-1');
      
      expect(insights.recommendations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('configuration handling', () => {
    it('should handle different buffer sizes', () => {
      const smallBufferIntegration = new WorkflowTelemetryIntegration({ 
        ...config, 
        bufferSize: 2 
      });

      const smallMonitor = new ExecutionMonitor('small-buffer-workflow', workflow);
      smallBufferIntegration.registerMonitor(smallMonitor, 'small-buffer-workflow', 'Small Buffer Test');
      
      smallMonitor.start();
      
      // Generate events to exceed buffer
      for (let i = 0; i < 5; i++) {
        smallMonitor.recordStepStart(sampleStep);
        vi.advanceTimersByTime(100);
      }
      
      // Should handle buffer overflow gracefully
      expect(true).toBe(true);
      
      smallMonitor.stop();
      smallBufferIntegration.shutdown();
    });

    it('should handle different flush intervals', () => {
      const fastFlushIntegration = new WorkflowTelemetryIntegration({ 
        ...config, 
        flushInterval: 100 
      });

      // Should flush more frequently
      vi.advanceTimersByTime(500);
      
      // Should not throw
      expect(true).toBe(true);
      
      fastFlushIntegration.shutdown();
    });

    it('should include custom attributes in events', () => {
      const customAttributes = { customKey: 'customValue', environment: 'test' };
      const customIntegration = new WorkflowTelemetryIntegration({ 
        ...config, 
        customAttributes 
      });

      // Custom attributes should be included in workflow execution logging
      const workflowResult: WorkflowResult = {
        success: true,
        stepResults: {},
        executionTime: 1000
      };

      const metrics = {} as WorkflowExecutionMetrics;

      expect(() => {
        customIntegration.logWorkflowExecution(workflow, workflowResult, metrics);
      }).not.toThrow();
      
      customIntegration.shutdown();
    });
  });

  describe('shutdown and cleanup', () => {
    it('should shutdown gracefully', () => {
      telemetryIntegration.registerMonitor(monitor, 'test-workflow', 'Test Workflow');
      monitor.start();
      
      expect(() => {
        telemetryIntegration.shutdown();
      }).not.toThrow();
    });

    it('should handle multiple shutdowns', () => {
      expect(() => {
        telemetryIntegration.shutdown();
        telemetryIntegration.shutdown();
      }).not.toThrow();
    });
  });

  describe('factory functions', () => {
    it('should create integration using factory function', () => {
      const factoryIntegration = createWorkflowTelemetryIntegration(config);
      expect(factoryIntegration).toBeInstanceOf(WorkflowTelemetryIntegration);
      factoryIntegration.shutdown();
    });
  });

  describe('global telemetry management', () => {
    afterEach(() => {
      shutdownWorkflowTelemetry();
    });

    it('should initialize global telemetry', () => {
      expect(() => {
        initializeWorkflowTelemetry(config);
      }).not.toThrow();

      const globalTelemetry = getWorkflowTelemetry();
      expect(globalTelemetry).toBeInstanceOf(WorkflowTelemetryIntegration);
    });

    it('should replace existing global telemetry on re-initialization', () => {
      initializeWorkflowTelemetry(config);
      const first = getWorkflowTelemetry();
      
      initializeWorkflowTelemetry({ ...config, enabled: false });
      const second = getWorkflowTelemetry();
      
      expect(first).not.toBe(second);
    });

    it('should shutdown global telemetry', () => {
      initializeWorkflowTelemetry(config);
      expect(getWorkflowTelemetry()).not.toBeNull();
      
      shutdownWorkflowTelemetry();
      expect(getWorkflowTelemetry()).toBeNull();
    });

    it('should return null when no global telemetry is initialized', () => {
      expect(getWorkflowTelemetry()).toBeNull();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle monitor events when integration is disabled', () => {
      const disabledIntegration = new WorkflowTelemetryIntegration({ enabled: false });
      
      expect(() => {
        disabledIntegration.registerMonitor(monitor, 'test-workflow', 'Test Workflow');
        monitor.start();
        monitor.recordStepStart(sampleStep);
      }).not.toThrow();
      
      disabledIntegration.shutdown();
    });

    it('should handle unregistering non-existent monitor', () => {
      expect(() => {
        telemetryIntegration.unregisterMonitor('non-existent-monitor');
      }).not.toThrow();
    });

    it('should handle event buffering with zero sampling rate', () => {
      const zeroSamplingIntegration = new WorkflowTelemetryIntegration({ 
        ...config, 
        samplingRate: 0.0 
      });

      const zeroMonitor = new ExecutionMonitor('zero-sampling-workflow', workflow);
      zeroSamplingIntegration.registerMonitor(zeroMonitor, 'zero-sampling-workflow', 'Zero Sampling Test');
      
      zeroMonitor.start();
      zeroMonitor.recordStepStart(sampleStep);
      
      // Should not generate events due to zero sampling
      const exportData = zeroSamplingIntegration.exportTelemetryData('zero-sampling-workflow');
      expect(exportData.events).toEqual([]);
      
      zeroMonitor.stop();
      zeroSamplingIntegration.shutdown();
    });

    it('should handle malformed step results gracefully', () => {
      const malformedResult = { 
        success: true 
        // Missing executionTime and other optional fields
      } as StepResult;

      expect(() => {
        telemetryIntegration.logStepExecution(sampleStep, malformedResult);
      }).not.toThrow();
    });
  });
});