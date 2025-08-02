/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult } from './types.js';
import { WorkflowError } from './errors.js';

export interface StepMetrics {
  stepId: string;
  stepName: string;
  stepType: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  retryCount: number;
  memoryUsage?: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  error?: WorkflowError;
  parallelGroup?: number;
  dependencyWaitTime?: number;
  resourceUtilization?: Record<string, number>;
}

export interface WorkflowExecutionMetrics {
  workflowId: string;
  workflowName: string;
  version: string;
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  stepMetrics: Map<string, StepMetrics>;
  parallelGroups: number;
  maxConcurrentSteps: number;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  retriedSteps: number;
  resourceUtilization: Record<string, number[]>; // Track over time
  memoryPeak: number;
  averageCpuUsage: number;
  overallSuccess: boolean;
  errorCount: number;
  warningCount: number;
}

export interface PerformanceSnapshot {
  timestamp: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  activeSteps: number;
  queuedSteps: number;
}

/**
 * Performance metrics collector for workflows
 */
export class WorkflowMetricsCollector {
  private metrics: WorkflowExecutionMetrics;
  private performanceSnapshots: PerformanceSnapshot[] = [];
  private snapshotInterval: NodeJS.Timeout | null = null;
  private baselineCpuUsage: NodeJS.CpuUsage;

  constructor(workflow: WorkflowDefinition, workflowId: string) {
    this.baselineCpuUsage = process.cpuUsage();
    
    this.metrics = {
      workflowId,
      workflowName: workflow.name,
      version: workflow.version,
      startTime: Date.now(),
      stepMetrics: new Map(),
      parallelGroups: 0,
      maxConcurrentSteps: 0,
      totalSteps: workflow.steps.length,
      completedSteps: 0,
      failedSteps: 0,
      skippedSteps: 0,
      retriedSteps: 0,
      resourceUtilization: {},
      memoryPeak: 0,
      averageCpuUsage: 0,
      overallSuccess: false,
      errorCount: 0,
      warningCount: 0
    };

    // Initialize step metrics
    for (const step of workflow.steps) {
      this.metrics.stepMetrics.set(step.id, {
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        startTime: 0,
        success: false,
        retryCount: 0
      });
    }

    this.startPerformanceMonitoring();
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    this.snapshotInterval = setInterval(() => {
      this.takePerformanceSnapshot();
    }, 1000); // Take snapshot every second
  }

  /**
   * Stop performance monitoring
   */
  private stopPerformanceMonitoring(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
  }

  /**
   * Take a performance snapshot
   */
  private takePerformanceSnapshot(): void {
    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(this.baselineCpuUsage),
      activeSteps: this.getActiveStepsCount(),
      queuedSteps: this.getQueuedStepsCount()
    };

    this.performanceSnapshots.push(snapshot);

    // Update memory peak
    const totalMemory = snapshot.memoryUsage.heapUsed + snapshot.memoryUsage.external;
    if (totalMemory > this.metrics.memoryPeak) {
      this.metrics.memoryPeak = totalMemory;
    }

    // Keep only last 5 minutes of snapshots
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    this.performanceSnapshots = this.performanceSnapshots.filter(
      s => s.timestamp > fiveMinutesAgo
    );
  }

  /**
   * Record step start
   */
  recordStepStart(step: WorkflowStep, parallelGroup?: number): void {
    const stepMetrics = this.metrics.stepMetrics.get(step.id);
    if (stepMetrics) {
      stepMetrics.startTime = Date.now();
      stepMetrics.parallelGroup = parallelGroup;
      stepMetrics.memoryUsage = process.memoryUsage();
      stepMetrics.cpuUsage = process.cpuUsage();
    }

    this.updateConcurrentStepsCount();
  }

  /**
   * Record step completion
   */
  recordStepComplete(step: WorkflowStep, result: StepResult): void {
    const stepMetrics = this.metrics.stepMetrics.get(step.id);
    if (stepMetrics) {
      const endTime = Date.now();
      stepMetrics.endTime = endTime;
      stepMetrics.duration = endTime - stepMetrics.startTime;
      stepMetrics.success = result.success;

      if (result.success) {
        this.metrics.completedSteps++;
      } else {
        this.metrics.failedSteps++;
        this.metrics.errorCount++;
      }
    }

    this.updateConcurrentStepsCount();
  }

  /**
   * Record step failure
   */
  recordStepFailure(step: WorkflowStep, error: WorkflowError, duration?: number): void {
    const stepMetrics = this.metrics.stepMetrics.get(step.id);
    if (stepMetrics) {
      const endTime = Date.now();
      stepMetrics.endTime = endTime;
      stepMetrics.duration = duration || (endTime - stepMetrics.startTime);
      stepMetrics.success = false;
      stepMetrics.error = error;
    }

    this.metrics.failedSteps++;
    this.metrics.errorCount++;
    this.updateConcurrentStepsCount();
  }

  /**
   * Record step skip
   */
  recordStepSkipped(step: WorkflowStep, reason: string): void {
    const stepMetrics = this.metrics.stepMetrics.get(step.id);
    if (stepMetrics) {
      stepMetrics.endTime = Date.now();
      stepMetrics.duration = 0;
      stepMetrics.success = false;
    }

    this.metrics.skippedSteps++;
  }

  /**
   * Record step retry
   */
  recordStepRetry(step: WorkflowStep): void {
    const stepMetrics = this.metrics.stepMetrics.get(step.id);
    if (stepMetrics) {
      stepMetrics.retryCount++;
    }

    this.metrics.retriedSteps++;
    this.metrics.warningCount++;
  }

  /**
   * Record dependency wait time
   */
  recordDependencyWaitTime(step: WorkflowStep, waitTime: number): void {
    const stepMetrics = this.metrics.stepMetrics.get(step.id);
    if (stepMetrics) {
      stepMetrics.dependencyWaitTime = waitTime;
    }
  }

  /**
   * Record resource utilization
   */
  recordResourceUtilization(resource: string, utilization: number): void {
    if (!this.metrics.resourceUtilization[resource]) {
      this.metrics.resourceUtilization[resource] = [];
    }
    this.metrics.resourceUtilization[resource].push(utilization);
  }

  /**
   * Record parallel execution statistics
   */
  recordParallelStats(parallelGroups: number, maxConcurrentSteps: number): void {
    this.metrics.parallelGroups = parallelGroups;
    this.metrics.maxConcurrentSteps = Math.max(
      this.metrics.maxConcurrentSteps,
      maxConcurrentSteps
    );
  }

  /**
   * Complete workflow metrics collection
   */
  complete(result: WorkflowResult): WorkflowExecutionMetrics {
    this.stopPerformanceMonitoring();
    
    const endTime = Date.now();
    this.metrics.endTime = endTime;
    this.metrics.totalDuration = endTime - this.metrics.startTime;
    this.metrics.overallSuccess = result.success;

    // Calculate average CPU usage
    if (this.performanceSnapshots.length > 0) {
      const totalCpuTime = this.performanceSnapshots.reduce((sum, snapshot) => {
        return sum + snapshot.cpuUsage.user + snapshot.cpuUsage.system;
      }, 0);
      this.metrics.averageCpuUsage = totalCpuTime / this.performanceSnapshots.length;
    }

    return { ...this.metrics };
  }

  /**
   * Get current metrics snapshot
   */
  getCurrentMetrics(): WorkflowExecutionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get step metrics for a specific step
   */
  getStepMetrics(stepId: string): StepMetrics | undefined {
    return this.metrics.stepMetrics.get(stepId);
  }

  /**
   * Get performance snapshots
   */
  getPerformanceSnapshots(): PerformanceSnapshot[] {
    return [...this.performanceSnapshots];
  }

  /**
   * Calculate performance statistics
   */
  getPerformanceStats(): {
    avgMemoryUsage: number;
    peakMemoryUsage: number;
    avgCpuUsage: number;
    peakCpuUsage: number;
    executionEfficiency: number;
  } {
    if (this.performanceSnapshots.length === 0) {
      return {
        avgMemoryUsage: 0,
        peakMemoryUsage: 0,
        avgCpuUsage: 0,
        peakCpuUsage: 0,
        executionEfficiency: 0
      };
    }

    const avgMemoryUsage = this.performanceSnapshots.reduce(
      (sum, s) => sum + s.memoryUsage.heapUsed, 0
    ) / this.performanceSnapshots.length;

    const peakMemoryUsage = Math.max(
      ...this.performanceSnapshots.map(s => s.memoryUsage.heapUsed)
    );

    const avgCpuUsage = this.performanceSnapshots.reduce(
      (sum, s) => sum + s.cpuUsage.user + s.cpuUsage.system, 0
    ) / this.performanceSnapshots.length;

    const peakCpuUsage = Math.max(
      ...this.performanceSnapshots.map(s => s.cpuUsage.user + s.cpuUsage.system)
    );

    // Calculate execution efficiency (completed steps / total time)
    const totalDuration = this.metrics.totalDuration || (Date.now() - this.metrics.startTime);
    const executionEfficiency = this.metrics.completedSteps / (totalDuration / 1000); // steps per second

    return {
      avgMemoryUsage,
      peakMemoryUsage,
      avgCpuUsage,
      peakCpuUsage,
      executionEfficiency
    };
  }

  /**
   * Export metrics as JSON
   */
  exportMetrics(): string {
    return JSON.stringify({
      metrics: this.metrics,
      performanceSnapshots: this.performanceSnapshots,
      performanceStats: this.getPerformanceStats()
    }, null, 2);
  }

  /**
   * Get active steps count (steps currently running)
   */
  private getActiveStepsCount(): number {
    return Array.from(this.metrics.stepMetrics.values()).filter(
      step => step.startTime > 0 && !step.endTime
    ).length;
  }

  /**
   * Get queued steps count (steps waiting to start)
   */
  private getQueuedStepsCount(): number {
    return Array.from(this.metrics.stepMetrics.values()).filter(
      step => step.startTime === 0
    ).length;
  }

  /**
   * Update concurrent steps count
   */
  private updateConcurrentStepsCount(): void {
    const activeCount = this.getActiveStepsCount();
    if (activeCount > this.metrics.maxConcurrentSteps) {
      this.metrics.maxConcurrentSteps = activeCount;
    }
  }
}

/**
 * Factory function to create a metrics collector
 */
export function createWorkflowMetricsCollector(
  workflow: WorkflowDefinition,
  workflowId: string
): WorkflowMetricsCollector {
  return new WorkflowMetricsCollector(workflow, workflowId);
}

/**
 * Utility functions for metrics analysis
 */
export class WorkflowMetricsAnalyzer {
  /**
   * Analyze workflow performance bottlenecks
   */
  static analyzeBottlenecks(metrics: WorkflowExecutionMetrics): {
    slowestSteps: StepMetrics[];
    resourceBottlenecks: string[];
    efficiencyScore: number;
    recommendations: string[];
  } {
    const stepMetricsArray = Array.from(metrics.stepMetrics.values());
    
    // Find slowest steps
    const slowestSteps = stepMetricsArray
      .filter(step => step.duration && step.duration > 0)
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, 5);

    // Identify resource bottlenecks
    const resourceBottlenecks: string[] = [];
    for (const [resource, values] of Object.entries(metrics.resourceUtilization)) {
      const avgUtilization = values.reduce((sum, val) => sum + val, 0) / values.length;
      if (avgUtilization > 0.8) {
        resourceBottlenecks.push(resource);
      }
    }

    // Calculate efficiency score (0-100)
    const successRate = metrics.completedSteps / metrics.totalSteps;
    const parallelEfficiency = metrics.maxConcurrentSteps / metrics.totalSteps;
    const timeEfficiency = metrics.totalSteps / ((metrics.totalDuration || 1) / 1000);
    const efficiencyScore = Math.round((successRate * 0.5 + parallelEfficiency * 0.3 + Math.min(timeEfficiency, 1) * 0.2) * 100);

    // Generate recommendations
    const recommendations: string[] = [];
    if (successRate < 0.9) {
      recommendations.push('Consider adding more robust error handling and retry logic');
    }
    if (parallelEfficiency < 0.3) {
      recommendations.push('Consider enabling parallel execution for independent steps');
    }
    if (resourceBottlenecks.length > 0) {
      recommendations.push(`Consider optimizing resource usage for: ${resourceBottlenecks.join(', ')}`);
    }
    if (slowestSteps.length > 0 && slowestSteps[0].duration! > 60000) {
      recommendations.push('Consider breaking down long-running steps into smaller chunks');
    }

    return {
      slowestSteps,
      resourceBottlenecks,
      efficiencyScore,
      recommendations
    };
  }

  /**
   * Compare metrics between workflow runs
   */
  static compareMetrics(
    current: WorkflowExecutionMetrics,
    previous: WorkflowExecutionMetrics
  ): {
    durationChange: number;
    successRateChange: number;
    performanceChange: 'improved' | 'degraded' | 'similar';
    improvements: string[];
    regressions: string[];
  } {
    const durationChange = ((current.totalDuration || 0) - (previous.totalDuration || 0)) / (previous.totalDuration || 1);
    const currentSuccessRate = current.completedSteps / current.totalSteps;
    const previousSuccessRate = previous.completedSteps / previous.totalSteps;
    const successRateChange = currentSuccessRate - previousSuccessRate;

    let performanceChange: 'improved' | 'degraded' | 'similar' = 'similar';
    if (durationChange < -0.1 && successRateChange >= 0) {
      performanceChange = 'improved';
    } else if (durationChange > 0.1 || successRateChange < -0.05) {
      performanceChange = 'degraded';
    }

    const improvements: string[] = [];
    const regressions: string[] = [];

    if (durationChange < -0.1) {
      improvements.push(`Execution time improved by ${Math.abs(durationChange * 100).toFixed(1)}%`);
    } else if (durationChange > 0.1) {
      regressions.push(`Execution time increased by ${(durationChange * 100).toFixed(1)}%`);
    }

    if (successRateChange > 0.05) {
      improvements.push(`Success rate improved by ${(successRateChange * 100).toFixed(1)}%`);
    } else if (successRateChange < -0.05) {
      regressions.push(`Success rate decreased by ${Math.abs(successRateChange * 100).toFixed(1)}%`);
    }

    return {
      durationChange,
      successRateChange,
      performanceChange,
      improvements,
      regressions
    };
  }
}