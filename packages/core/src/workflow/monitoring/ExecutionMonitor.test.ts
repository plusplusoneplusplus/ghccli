/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  ExecutionMonitor, 
  MultiWorkflowMonitor,
  createExecutionMonitor,
  type MonitoringConfiguration 
} from './ExecutionMonitor.js';
import { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult } from '../types.js';
import { WorkflowStepError } from '../errors.js';

describe('ExecutionMonitor', () => {
  let monitor: ExecutionMonitor;
  let sampleWorkflow: WorkflowDefinition;
  let sampleStep: WorkflowStep;
  let config: Partial<MonitoringConfiguration>;

  beforeEach(() => {
    vi.useFakeTimers();
    
    sampleStep = {
      id: 'test-step',
      name: 'Test Step',
      type: 'script',
      config: { command: 'echo "test"' }
    };

    sampleWorkflow = {
      name: 'Test Workflow',
      version: '1.0.0',
      steps: [sampleStep]
    };

    config = {
      enableRealTimeUpdates: false, // Disable for simpler testing
      performanceThresholds: {
        maxMemoryUsageMB: 100,
        maxCpuUsagePercent: 50,
        maxStepDurationMs: 5000,
        maxErrorRate: 0.1
      },
      alerting: {
        enabled: true,
        channels: ['console']
      }
    };

    monitor = new ExecutionMonitor('test-workflow-1', sampleWorkflow, config);
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create monitor with default configuration', () => {
      const defaultMonitor = new ExecutionMonitor('test-id', sampleWorkflow);
      expect(defaultMonitor).toBeDefined();
      defaultMonitor.stop();
    });

    it('should merge custom configuration with defaults', () => {
      const customConfig = { enableRealTimeUpdates: false };
      const customMonitor = new ExecutionMonitor('test-id', sampleWorkflow, customConfig);
      expect(customMonitor).toBeDefined();
      customMonitor.stop();
    });
  });

  describe('lifecycle management', () => {
    it('should start and stop monitoring', () => {
      expect(() => monitor.start()).not.toThrow();
      expect(() => monitor.stop()).not.toThrow();
    });

    it('should not start multiple times', () => {
      monitor.start();
      expect(() => monitor.start()).not.toThrow();
    });

    it('should not stop if not active', () => {
      expect(() => monitor.stop()).not.toThrow();
    });
  });

  describe('step recording', () => {
    beforeEach(() => {
      monitor.start();
    });

    it('should record step start', () => {
      expect(() => monitor.recordStepStart(sampleStep)).not.toThrow();
      
      const history = monitor.getExecutionHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history.some(event => event.type === 'step_started')).toBe(true);
    });

    it('should record step completion', () => {
      const result: StepResult = {
        success: true,
        output: 'test output',
        executionTime: 1000
      };

      monitor.recordStepStart(sampleStep);
      expect(() => monitor.recordStepComplete(sampleStep, result)).not.toThrow();
      
      const history = monitor.getExecutionHistory();
      expect(history.some(event => event.type === 'step_completed')).toBe(true);
    });

    it('should record step failure', () => {
      const error = new WorkflowStepError('Test error', 'STEP_ERROR', 'test-workflow-1', 'test-step');

      monitor.recordStepStart(sampleStep);
      expect(() => monitor.recordStepFailure(sampleStep, error)).not.toThrow();
      
      const history = monitor.getExecutionHistory();
      expect(history.some(event => event.type === 'step_failed')).toBe(true);
    });

    it('should record step retry', () => {
      expect(() => monitor.recordStepRetry(sampleStep, 2, 'Timeout exceeded')).not.toThrow();
      
      const history = monitor.getExecutionHistory();
      expect(history.some(event => event.type === 'step_retried')).toBe(true);
    });

    it('should record step skip', () => {
      expect(() => monitor.recordStepSkipped(sampleStep, 'Condition not met')).not.toThrow();
      
      const history = monitor.getExecutionHistory();
      expect(history.some(event => event.type === 'step_skipped')).toBe(true);
    });
  });

  describe('data collection', () => {
    beforeEach(() => {
      monitor.start();
    });

    it('should track execution history', () => {
      monitor.recordStepStart(sampleStep);
      
      const history = monitor.getExecutionHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history.some(event => event.type === 'workflow_started')).toBe(true);
      expect(history.some(event => event.type === 'step_started')).toBe(true);
    });

    it('should provide current execution snapshot', () => {
      const snapshot = monitor.getSnapshot();
      expect(snapshot).toHaveProperty('workflowId', 'test-workflow-1');
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('activeSteps');
      expect(snapshot).toHaveProperty('metrics');
    });

    it('should track alerts', () => {
      const alerts = monitor.getAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });

    it('should provide step metrics', () => {
      monitor.recordStepStart(sampleStep);
      
      const stepMetrics = monitor.getStepMetrics('test-step');
      expect(stepMetrics).toBeDefined();
      expect(stepMetrics?.stepId).toBe('test-step');
    });

    it('should provide performance statistics', () => {
      const stats = monitor.getPerformanceStats();
      expect(stats).toHaveProperty('avgMemoryUsage');
      expect(stats).toHaveProperty('peakMemoryUsage');
      expect(stats).toHaveProperty('avgCpuUsage');
      expect(stats).toHaveProperty('executionEfficiency');
    });
  });

  describe('workflow completion', () => {
    it('should complete workflow monitoring successfully', () => {
      monitor.start();
      monitor.recordStepStart(sampleStep);
      
      const result: WorkflowResult = {
        success: true,
        stepResults: {
          'test-step': { success: true, executionTime: 1000 }
        },
        executionTime: 1000
      };
      
      const metrics = monitor.complete(result);
      expect(metrics).toBeDefined();
      expect(metrics.overallSuccess).toBe(true);
    });

    it('should complete workflow monitoring with failures', () => {
      monitor.start();
      monitor.recordStepStart(sampleStep);
      
      const error = new WorkflowStepError('Test error', 'STEP_ERROR', 'test-workflow-1', 'test-step');
      monitor.recordStepFailure(sampleStep, error);
      
      const result: WorkflowResult = {
        success: false,
        stepResults: {
          'test-step': { success: false, error: 'Test error', executionTime: 1000 }
        },
        executionTime: 1000,
        error: 'Workflow failed'
      };
      
      const metrics = monitor.complete(result);
      expect(metrics).toBeDefined();
      expect(metrics.overallSuccess).toBe(false);
    });
  });

  describe('data export', () => {
    it('should export complete monitoring data', () => {
      monitor.start();
      monitor.recordStepStart(sampleStep);
      
      const exportData = monitor.exportData();
      expect(exportData).toHaveProperty('workflowId', 'test-workflow-1');
      expect(exportData).toHaveProperty('workflow');
      expect(exportData).toHaveProperty('events');
      expect(exportData).toHaveProperty('alerts');
      expect(exportData).toHaveProperty('metrics');
      expect(exportData).toHaveProperty('snapshot');
    });
  });

  describe('factory function', () => {
    it('should create monitor using factory function', () => {
      const factoryMonitor = createExecutionMonitor('factory-workflow', sampleWorkflow, config);
      expect(factoryMonitor).toBeInstanceOf(ExecutionMonitor);
      factoryMonitor.stop();
    });
  });
});

describe('MultiWorkflowMonitor', () => {
  let multiMonitor: MultiWorkflowMonitor;
  let workflow1: WorkflowDefinition;
  let workflow2: WorkflowDefinition;

  beforeEach(() => {
    vi.useFakeTimers();
    
    workflow1 = {
      name: 'Workflow 1',
      version: '1.0.0',
      steps: [{ id: 'step1', name: 'Step 1', type: 'script', config: { command: 'echo "1"' } }]
    };

    workflow2 = {
      name: 'Workflow 2',
      version: '1.0.0',
      steps: [{ id: 'step2', name: 'Step 2', type: 'script', config: { command: 'echo "2"' } }]
    };

    multiMonitor = new MultiWorkflowMonitor();
  });

  afterEach(() => {
    multiMonitor.stopAll();
    vi.useRealTimers();
  });

  describe('workflow management', () => {
    it('should add and remove workflows', () => {
      const monitor1 = multiMonitor.addWorkflow('workflow-1', workflow1);
      const monitor2 = multiMonitor.addWorkflow('workflow-2', workflow2);

      expect(monitor1).toBeInstanceOf(ExecutionMonitor);
      expect(monitor2).toBeInstanceOf(ExecutionMonitor);
      expect(multiMonitor.getAllMonitors()).toHaveLength(2);

      multiMonitor.removeWorkflow('workflow-1');
      expect(multiMonitor.getAllMonitors()).toHaveLength(1);
    });

    it('should get specific monitor', () => {
      multiMonitor.addWorkflow('workflow-1', workflow1);
      
      const monitor = multiMonitor.getMonitor('workflow-1');
      expect(monitor).toBeInstanceOf(ExecutionMonitor);
      
      const nonExistent = multiMonitor.getMonitor('non-existent');
      expect(nonExistent).toBeUndefined();
    });

    it('should get all monitors', () => {
      multiMonitor.addWorkflow('workflow-1', workflow1);
      multiMonitor.addWorkflow('workflow-2', workflow2);
      
      const allMonitors = multiMonitor.getAllMonitors();
      expect(allMonitors).toHaveLength(2);
      expect(allMonitors.every(m => m instanceof ExecutionMonitor)).toBe(true);
    });
  });

  describe('aggregated statistics', () => {
    it('should provide aggregated stats for multiple workflows', () => {
      const monitor1 = multiMonitor.addWorkflow('workflow-1', workflow1);
      const monitor2 = multiMonitor.addWorkflow('workflow-2', workflow2);
      
      monitor1.start();
      monitor2.start();
      
      const stats = multiMonitor.getAggregatedStats();
      expect(stats).toHaveProperty('totalWorkflows', 2);
      expect(stats).toHaveProperty('activeWorkflows');
      expect(stats).toHaveProperty('completedWorkflows');
      expect(stats).toHaveProperty('failedWorkflows');
      expect(stats).toHaveProperty('totalAlerts');
      expect(stats).toHaveProperty('criticalAlerts');
    });

    it('should handle empty monitor list', () => {
      const stats = multiMonitor.getAggregatedStats();
      expect(stats.totalWorkflows).toBe(0);
      expect(stats.activeWorkflows).toBe(0);
    });
  });

  describe('lifecycle management', () => {
    it('should stop all workflows', () => {
      const monitor1 = multiMonitor.addWorkflow('workflow-1', workflow1);
      const monitor2 = multiMonitor.addWorkflow('workflow-2', workflow2);
      
      monitor1.start();
      monitor2.start();
      
      expect(() => multiMonitor.stopAll()).not.toThrow();
      expect(multiMonitor.getAllMonitors()).toHaveLength(0);
    });
  });
});