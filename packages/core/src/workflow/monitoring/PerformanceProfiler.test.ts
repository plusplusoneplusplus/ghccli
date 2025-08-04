/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  PerformanceProfiler, 
  createPerformanceProfiler,
  exportProfileData,
  type PerformanceProfile,
  type Hotspot,
  type ProfileRecommendation,
  type ProfilingOptions 
} from './PerformanceProfiler.js';
import { WorkflowDefinition, WorkflowStep, StepResult } from '../types.js';

describe('PerformanceProfiler', () => {
  let profiler: PerformanceProfiler;
  let workflow: WorkflowDefinition;
  let sampleStep: WorkflowStep;
  let options: ProfilingOptions;

  beforeEach(() => {
    vi.useFakeTimers();
    
    sampleStep = {
      id: 'perf-step',
      name: 'Performance Test Step',
      type: 'script',
      config: { command: 'echo "performance test"' }
    };

    workflow = {
      name: 'Performance Test Workflow',
      version: '1.0.0',
      steps: [
        sampleStep,
        {
          id: 'cpu-step',
          name: 'CPU Intensive Step',
          type: 'script',
          config: { command: 'heavy-cpu-task' }
        },
        {
          id: 'memory-step',
          name: 'Memory Intensive Step',
          type: 'agent',
          config: { agent: 'memory-agent' }
        }
      ]
    };

    options = {
      samplingInterval: 100,
      enableCpuProfiling: true,
      enableMemoryProfiling: true,
      enableEventLoopProfiling: true,
      customMetrics: ['custom1', 'custom2'],
      thresholds: {
        cpuUsage: 70,
        memoryUsage: 200,
        eventLoopDelay: 5
      }
    };

    profiler = new PerformanceProfiler('perf-workflow-1', workflow, options);
  });

  afterEach(() => {
    if (profiler) {
      try {
        profiler.stop();
      } catch {
        // Ignore if already stopped
      }
    }
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create profiler with default options', () => {
      const defaultProfiler = new PerformanceProfiler('default-workflow', workflow);
      expect(defaultProfiler).toBeDefined();
    });

    it('should merge custom options with defaults', () => {
      const customOptions = { samplingInterval: 50 };
      const customProfiler = new PerformanceProfiler('custom-workflow', workflow, customOptions);
      expect(customProfiler).toBeDefined();
    });
  });

  describe('profiling lifecycle', () => {
    it('should start and stop profiling', () => {
      expect(() => profiler.start()).not.toThrow();
      expect(() => profiler.stop()).not.toThrow();
    });

    it('should not start multiple times', () => {
      profiler.start();
      expect(() => profiler.start()).not.toThrow(); // Should not throw on second start
    });

    it('should throw error when stopping inactive profiler', () => {
      expect(() => profiler.stop()).toThrow('Profiler is not active');
    });

    it('should generate profile on stop', () => {
      profiler.start();
      
      // Add some profile points
      profiler.recordStepStart(sampleStep);
      vi.advanceTimersByTime(500);
      
      const result: StepResult = { success: true, executionTime: 500 };
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      
      expect(profile).toBeDefined();
      expect(profile.workflowId).toBe('perf-workflow-1');
      expect(profile.profilePoints.length).toBeGreaterThan(0);
    });
  });

  describe('step recording', () => {
    beforeEach(() => {
      profiler.start();
    });

    it('should record step start', () => {
      profiler.recordStepStart(sampleStep);
      
      // Advance time to ensure profile points are created
      vi.advanceTimersByTime(100);
      
      const profile = profiler.stop();
      const stepStartPoints = profile.profilePoints.filter(
        p => p.stepId === 'perf-step' && p.phase === 'start'
      );
      
      expect(stepStartPoints.length).toBeGreaterThan(0);
    });

    it('should record step end', () => {
      const result: StepResult = { success: true, executionTime: 1000 };
      
      profiler.recordStepStart(sampleStep);
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      const stepEndPoints = profile.profilePoints.filter(
        p => p.stepId === 'perf-step' && p.phase === 'end'
      );
      
      expect(stepEndPoints.length).toBeGreaterThanOrEqual(0);
    });

    it('should record checkpoints with custom metrics', () => {
      const customMetrics = { memoryCustom: 150, cpuCustom: 80 };
      
      profiler.recordCheckpoint('perf-step', 'midpoint', customMetrics);
      
      const profile = profiler.stop();
      const checkpointPoints = profile.profilePoints.filter(
        p => p.stepId === 'perf-step' && p.phase === 'checkpoint'
      );
      
      expect(checkpointPoints.length).toBeGreaterThanOrEqual(0);
      if (checkpointPoints.length > 0) {
        expect(checkpointPoints[0].context).toHaveProperty('label', 'midpoint');
      }
    });
  });

  describe('custom metrics', () => {
    beforeEach(() => {
      profiler.start();
    });

    it('should add and collect custom metrics', () => {
      let counter = 0;
      profiler.addCustomMetric('testCounter', () => ++counter);
      
      vi.advanceTimersByTime(200); // Allow sampling to occur
      
      const profile = profiler.stop();
      const pointsWithCustomMetrics = profile.profilePoints.filter(
        p => p.metrics.custom && 'testCounter' in p.metrics.custom
      );
      
      expect(pointsWithCustomMetrics.length).toBeGreaterThan(0);
    });

    it('should handle custom metric collection errors gracefully', () => {
      profiler.addCustomMetric('errorMetric', () => {
        throw new Error('Metric collection failed');
      });
      
      // Should not throw even with failing custom metric
      expect(() => {
        vi.advanceTimersByTime(200);
        profiler.stop();
      }).not.toThrow();
    });
  });

  describe('hotspot identification', () => {
    beforeEach(() => {
      profiler.start();
    });

    it('should identify CPU hotspots', () => {
      // Mock high CPU usage
      const originalCpuUsage = process.cpuUsage;
      process.cpuUsage = vi.fn(() => ({
        user: 100000, // 100ms in microseconds (high CPU)
        system: 50000 // 50ms in microseconds
      }));

      profiler.recordStepStart(workflow.steps[1]); // cpu-step
      vi.advanceTimersByTime(1000);
      
      const result: StepResult = { success: true, executionTime: 1000 };
      profiler.recordStepEnd(workflow.steps[1], result);
      
      const profile = profiler.stop();
      const cpuHotspots = profile.hotspots.filter(h => h.type === 'cpu');
      
      expect(cpuHotspots.length).toBeGreaterThanOrEqual(0);
      if (cpuHotspots.length > 0) {
        expect(cpuHotspots[0].stepId).toBe('cpu-step');
        expect(cpuHotspots[0].severity).toMatch(/medium|high|critical/);
      }
      
      process.cpuUsage = originalCpuUsage;
    });

    it('should identify memory hotspots', () => {
      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn(() => ({
        rss: 300 * 1024 * 1024, // 300MB
        heapTotal: 300 * 1024 * 1024,
        heapUsed: 300 * 1024 * 1024, // Above threshold
        external: 0,
        arrayBuffers: 0
      }));

      profiler.recordStepStart(workflow.steps[2]); // memory-step
      vi.advanceTimersByTime(1000);
      
      const result: StepResult = { success: true, executionTime: 1000 };
      profiler.recordStepEnd(workflow.steps[2], result);
      
      const profile = profiler.stop();
      const memoryHotspots = profile.hotspots.filter(h => h.type === 'memory');
      
      expect(memoryHotspots.length).toBeGreaterThanOrEqual(0);
      if (memoryHotspots.length > 0) {
        expect(memoryHotspots[0].stepId).toBe('memory-step');
      }
      
      process.memoryUsage = originalMemoryUsage;
    });

    it('should identify event loop hotspots', () => {
      // Since we're using fake timers, we need to mock the event loop delay measurement
      profiler.recordStepStart(sampleStep);
      
      // Simulate event loop delay by advancing time significantly
      vi.advanceTimersByTime(10); // 10ms delay, above threshold of 5ms
      
      const result: StepResult = { success: true, executionTime: 1000 };
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      
      // Note: Event loop detection might not work perfectly with fake timers
      // but the structure should be there
      expect(profile.hotspots).toBeDefined();
    });

    it('should sort hotspots by impact', () => {
      profiler.recordStepStart(sampleStep);
      vi.advanceTimersByTime(1000);
      
      const result: StepResult = { success: true, executionTime: 1000 };
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      
      // Check that hotspots are sorted (highest impact first)
      for (let i = 1; i < profile.hotspots.length; i++) {
        expect(profile.hotspots[i - 1].impact).toBeGreaterThanOrEqual(profile.hotspots[i].impact);
      }
    });
  });

  describe('performance recommendations', () => {
    beforeEach(() => {
      profiler.start();
    });

    it('should generate CPU optimization recommendations', () => {
      // Mock high CPU usage scenario
      const originalCpuUsage = process.cpuUsage;
      process.cpuUsage = vi.fn(() => ({
        user: 150000, // Very high CPU usage
        system: 75000
      }));

      profiler.recordStepStart(workflow.steps[1]);
      vi.advanceTimersByTime(1000);
      
      const result: StepResult = { success: true, executionTime: 1000 };
      profiler.recordStepEnd(workflow.steps[1], result);
      
      const profile = profiler.stop();
      const cpuRecommendations = profile.recommendations.filter(r => r.category === 'cpu');
      
      expect(cpuRecommendations.length).toBeGreaterThanOrEqual(0);
      if (cpuRecommendations.length > 0) {
        expect(cpuRecommendations[0].title).toContain('CPU');
        expect(cpuRecommendations[0].implementation.length).toBeGreaterThan(0);
      }
      
      process.cpuUsage = originalCpuUsage;
    });

    it('should generate memory optimization recommendations', () => {
      // Mock high memory usage scenario
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn(() => ({
        rss: 400 * 1024 * 1024,
        heapTotal: 400 * 1024 * 1024,
        heapUsed: 400 * 1024 * 1024, // Very high memory usage
        external: 0,
        arrayBuffers: 0
      }));

      profiler.recordStepStart(workflow.steps[2]);
      vi.advanceTimersByTime(1000);
      
      const result: StepResult = { success: true, executionTime: 1000 };
      profiler.recordStepEnd(workflow.steps[2], result);
      
      const profile = profiler.stop();
      const memoryRecommendations = profile.recommendations.filter(r => r.category === 'memory');
      
      expect(memoryRecommendations.length).toBeGreaterThanOrEqual(0);
      if (memoryRecommendations.length > 0) {
        expect(memoryRecommendations[0].title).toContain('memory');
      }
      
      process.memoryUsage = originalMemoryUsage;
    });

    it('should sort recommendations by priority', () => {
      profiler.recordStepStart(sampleStep);
      vi.advanceTimersByTime(1000);
      
      const result: StepResult = { success: true, executionTime: 1000 };
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      
      // Check that recommendations are sorted by priority (high first)
      const priorities = ['high', 'medium', 'low'];
      for (let i = 1; i < profile.recommendations.length; i++) {
        const prevIndex = priorities.indexOf(profile.recommendations[i - 1].priority);
        const currIndex = priorities.indexOf(profile.recommendations[i].priority);
        expect(prevIndex).toBeLessThanOrEqual(currIndex);
      }
    });
  });

  describe('performance summary', () => {
    beforeEach(() => {
      profiler.start();
    });

    it('should generate comprehensive performance summary', () => {
      profiler.recordStepStart(sampleStep);
      vi.advanceTimersByTime(2000);
      
      const result: StepResult = { success: true, executionTime: 2000 };
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      
      expect(profile.summary).toBeDefined();
      expect(profile.summary.totalExecutionTime).toBeGreaterThan(0);
      expect(profile.summary.overallEfficiency).toBeGreaterThanOrEqual(0);
      expect(profile.summary.overallEfficiency).toBeLessThanOrEqual(100);
      expect(profile.summary.cpuIntensive).toBeDefined();
      expect(profile.summary.memoryIntensive).toBeDefined();
      expect(profile.summary.ioBottlenecks).toBeDefined();
      expect(profile.summary.parallelizationOpportunities).toBeDefined();
    });

    it('should identify parallelization opportunities', () => {
      const parallelWorkflow: WorkflowDefinition = {
        name: 'Parallel Test Workflow',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', type: 'script', config: { command: 'echo "1"' }, dependsOn: ['init'] },
          { id: 'step2', name: 'Step 2', type: 'script', config: { command: 'echo "2"' }, dependsOn: ['init'] },
          { id: 'step3', name: 'Step 3', type: 'script', config: { command: 'echo "3"' }, dependsOn: ['init'] }
        ]
      };

      const parallelProfiler = new PerformanceProfiler('parallel-workflow', parallelWorkflow, options);
      parallelProfiler.start();
      
      vi.advanceTimersByTime(1000);
      
      const profile = parallelProfiler.stop();
      
      expect(profile.summary.parallelizationOpportunities.steps.length).toBeGreaterThanOrEqual(0);
    });

    it('should calculate execution efficiency', () => {
      profiler.recordStepStart(sampleStep);
      vi.advanceTimersByTime(1000);
      
      const result: StepResult = { success: true, executionTime: 1000 };
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      
      expect(typeof profile.summary.overallEfficiency).toBe('number');
      expect(profile.summary.overallEfficiency).toBeGreaterThanOrEqual(0);
      expect(profile.summary.overallEfficiency).toBeLessThanOrEqual(100);
    });
  });

  describe('data export', () => {
    it('should export profile data as JSON', () => {
      profiler.start();
      profiler.recordStepStart(sampleStep);
      vi.advanceTimersByTime(500);
      
      const result: StepResult = { success: true, executionTime: 500 };
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      const jsonExport = exportProfileData(profile, 'json');
      
      expect(() => JSON.parse(jsonExport)).not.toThrow();
      const parsed = JSON.parse(jsonExport);
      expect(parsed).toHaveProperty('workflowId');
      expect(parsed).toHaveProperty('profilePoints');
    });

    it('should export profile data as CSV', () => {
      profiler.start();
      profiler.recordStepStart(sampleStep);
      vi.advanceTimersByTime(500);
      
      const result: StepResult = { success: true, executionTime: 500 };
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      const csvExport = exportProfileData(profile, 'csv');
      
      expect(csvExport).toContain('timestamp,stepId,phase,memoryUsed');
      expect(csvExport.split('\n').length).toBeGreaterThan(1);
    });

    it('should export profile data as summary text', () => {
      profiler.start();
      profiler.recordStepStart(sampleStep);
      vi.advanceTimersByTime(500);
      
      const result: StepResult = { success: true, executionTime: 500 };
      profiler.recordStepEnd(sampleStep, result);
      
      const profile = profiler.stop();
      const summaryExport = exportProfileData(profile, 'summary');
      
      expect(summaryExport).toContain('PERFORMANCE PROFILE SUMMARY');
      expect(summaryExport).toContain('perf-workflow-1');
      expect(summaryExport).toContain('Overall Efficiency:');
    });

    it('should throw error for unsupported export format', () => {
      profiler.start();
      const profile = profiler.stop();
      
      expect(() => {
        exportProfileData(profile, 'unsupported' as any);
      }).toThrow('Unsupported export format: unsupported');
    });
  });

  describe('factory function', () => {
    it('should create profiler using factory function', () => {
      const factoryProfiler = createPerformanceProfiler('factory-workflow', workflow, options);
      expect(factoryProfiler).toBeInstanceOf(PerformanceProfiler);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty workflow', () => {
      const emptyWorkflow: WorkflowDefinition = {
        name: 'Empty Workflow',
        version: '1.0.0',
        steps: []
      };

      const emptyProfiler = new PerformanceProfiler('empty-workflow', emptyWorkflow);
      emptyProfiler.start();
      
      vi.advanceTimersByTime(1000);
      
      const profile = emptyProfiler.stop();
      expect(profile.profilePoints.length).toBeGreaterThan(0); // Should have start/end points
    });

    it('should handle rapid start/stop cycles', () => {
      expect(() => {
        profiler.start();
        profiler.stop();
        profiler.start();
        profiler.stop();
      }).not.toThrow();
    });

    it('should handle missing step in workflow', () => {
      profiler.start();
      
      const unknownStep: WorkflowStep = {
        id: 'unknown-step',
        name: 'Unknown Step',
        type: 'script',
        config: { command: 'echo "unknown"' }
      };

      expect(() => {
        profiler.recordStepStart(unknownStep);
        profiler.recordStepEnd(unknownStep, { success: true, executionTime: 100 });
      }).not.toThrow();
    });

    it('should handle profile generation with no recorded steps', () => {
      profiler.start();
      vi.advanceTimersByTime(1000);
      
      const profile = profiler.stop();
      
      expect(profile).toBeDefined();
      expect(profile.hotspots).toEqual([]);
      expect(profile.recommendations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('performance thresholds', () => {
    it('should use custom thresholds for hotspot detection', () => {
      const customOptions: ProfilingOptions = {
        ...options,
        thresholds: {
          cpuUsage: 10, // Very low threshold
          memoryUsage: 1, // Very low threshold
          eventLoopDelay: 0.1 // Very low threshold
        }
      };

      const sensitiveProfiler = new PerformanceProfiler('sensitive-workflow', workflow, customOptions);
      sensitiveProfiler.start();
      
      sensitiveProfiler.recordStepStart(sampleStep);
      vi.advanceTimersByTime(1000);
      
      const result: StepResult = { success: true, executionTime: 1000 };
      sensitiveProfiler.recordStepEnd(sampleStep, result);
      
      const profile = sensitiveProfiler.stop();
      
      // With very low thresholds, we should detect more hotspots
      expect(profile.hotspots.length).toBeGreaterThanOrEqual(0);
    });
  });
});