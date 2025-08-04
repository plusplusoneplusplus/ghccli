/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'events';
import { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult } from '../types.js';
import { WorkflowMetricsCollector, StepMetrics, WorkflowExecutionMetrics } from '../metrics.js';
import { WorkflowStatusReporter, StepStatus, WorkflowExecutionReport } from '../WorkflowStatusReporter.js';
import { WorkflowError } from '../errors.js';

export interface MonitoringEvent {
  type: 'workflow_started' | 'workflow_completed' | 'workflow_failed' | 'step_started' | 'step_completed' | 'step_failed' | 'step_retried' | 'step_skipped' | 'metrics_updated' | 'performance_alert';
  timestamp: number;
  workflowId: string;
  stepId?: string;
  data?: unknown;
}

export interface PerformanceAlert {
  id: string;
  type: 'memory_usage' | 'cpu_usage' | 'duration_exceeded' | 'error_rate' | 'resource_exhaustion';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  threshold: number;
  currentValue: number;
  stepId?: string;
  timestamp: number;
}

export interface MonitoringConfiguration {
  enableRealTimeUpdates: boolean;
  updateInterval: number; // milliseconds
  performanceThresholds: {
    maxMemoryUsageMB: number;
    maxCpuUsagePercent: number;
    maxStepDurationMs: number;
    maxErrorRate: number;
  };
  alerting: {
    enabled: boolean;
    channels: ('console' | 'file' | 'webhook')[];
    webhookUrl?: string;
    logFile?: string;
  };
  retention: {
    maxEvents: number;
    maxAgeMs: number;
  };
}

export interface ExecutionSnapshot {
  timestamp: number;
  workflowId: string;
  status: string;
  progress: number;
  activeSteps: string[];
  completedSteps: string[];
  failedSteps: string[];
  metrics: WorkflowExecutionMetrics;
  alerts: PerformanceAlert[];
}

/**
 * Real-time workflow execution monitoring system
 */
export class ExecutionMonitor extends EventEmitter {
  private workflowId: string;
  private workflow: WorkflowDefinition;
  private config: MonitoringConfiguration;
  private events: MonitoringEvent[] = [];
  private alerts: PerformanceAlert[] = [];
  private metricsCollector: WorkflowMetricsCollector;
  private statusReporter: WorkflowStatusReporter;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private startTime: number;
  private isActive: boolean = false;

  constructor(
    workflowId: string,
    workflow: WorkflowDefinition,
    config: Partial<MonitoringConfiguration> = {}
  ) {
    super();
    this.workflowId = workflowId;
    this.workflow = workflow;
    this.startTime = Date.now();
    
    // Set default configuration
    this.config = {
      enableRealTimeUpdates: true,
      updateInterval: 1000,
      performanceThresholds: {
        maxMemoryUsageMB: 512,
        maxCpuUsagePercent: 80,
        maxStepDurationMs: 300000, // 5 minutes
        maxErrorRate: 0.1 // 10%
      },
      alerting: {
        enabled: true,
        channels: ['console']
      },
      retention: {
        maxEvents: 1000,
        maxAgeMs: 24 * 60 * 60 * 1000 // 24 hours
      },
      ...config
    };

    this.metricsCollector = new WorkflowMetricsCollector(workflow, workflowId);
    this.statusReporter = new WorkflowStatusReporter();
  }

  /**
   * Start monitoring workflow execution
   */
  start(): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    this.emitEvent({
      type: 'workflow_started',
      timestamp: Date.now(),
      workflowId: this.workflowId,
      data: {
        workflowName: this.workflow.name,
        totalSteps: this.workflow.steps.length
      }
    });

    if (this.config.enableRealTimeUpdates) {
      this.startRealTimeUpdates();
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    this.stopRealTimeUpdates();
    
    this.emitEvent({
      type: 'workflow_completed',
      timestamp: Date.now(),
      workflowId: this.workflowId
    });
  }

  /**
   * Record step start
   */
  recordStepStart(step: WorkflowStep, parallelGroup?: number): void {
    this.statusReporter.markStepStarted(step.id);
    this.metricsCollector.recordStepStart(step, parallelGroup);

    this.emitEvent({
      type: 'step_started',
      timestamp: Date.now(),
      workflowId: this.workflowId,
      stepId: step.id,
      data: {
        stepName: step.name,
        stepType: step.type,
        parallelGroup
      }
    });

    this.checkPerformanceThresholds(step.id);
  }

  /**
   * Record step completion
   */
  recordStepComplete(step: WorkflowStep, result: StepResult): void {
    this.statusReporter.markStepCompleted(step.id, result.output);
    this.metricsCollector.recordStepComplete(step, result);

    this.emitEvent({
      type: 'step_completed',
      timestamp: Date.now(),
      workflowId: this.workflowId,
      stepId: step.id,
      data: {
        stepName: step.name,
        success: result.success,
        executionTime: result.executionTime,
        output: result.output
      }
    });

    this.checkPerformanceThresholds(step.id);
  }

  /**
   * Record step failure
   */
  recordStepFailure(step: WorkflowStep, error: WorkflowError, duration?: number): void {
    this.statusReporter.markStepFailed(step.id, error.message);
    this.metricsCollector.recordStepFailure(step, error, duration);

    this.emitEvent({
      type: 'step_failed',
      timestamp: Date.now(),
      workflowId: this.workflowId,
      stepId: step.id,
      data: {
        stepName: step.name,
        error: error.message,
        errorType: error.code,
        duration
      }
    });

    // Generate error rate alert
    this.checkErrorRate();
  }

  /**
   * Record step retry
   */
  recordStepRetry(step: WorkflowStep, attempt: number, reason: string): void {
    this.metricsCollector.recordStepRetry(step);

    this.emitEvent({
      type: 'step_retried',
      timestamp: Date.now(),
      workflowId: this.workflowId,
      stepId: step.id,
      data: {
        stepName: step.name,
        attempt,
        reason
      }
    });
  }

  /**
   * Record step skip
   */
  recordStepSkipped(step: WorkflowStep, reason: string): void {
    this.statusReporter.markStepSkipped(step.id, reason);
    this.metricsCollector.recordStepSkipped(step, reason);

    this.emitEvent({
      type: 'step_skipped',
      timestamp: Date.now(),
      workflowId: this.workflowId,
      stepId: step.id,
      data: {
        stepName: step.name,
        reason
      }
    });
  }

  /**
   * Complete workflow monitoring
   */
  complete(result: WorkflowResult): WorkflowExecutionMetrics {
    const metrics = this.metricsCollector.complete(result);
    
    this.emitEvent({
      type: result.success ? 'workflow_completed' : 'workflow_failed',
      timestamp: Date.now(),
      workflowId: this.workflowId,
      data: {
        success: result.success,
        executionTime: result.executionTime,
        error: result.error,
        metrics
      }
    });

    this.stop();
    return metrics;
  }

  /**
   * Get current execution snapshot
   */
  getSnapshot(): ExecutionSnapshot {
    const report = this.statusReporter.getExecutionReport(this.workflow);
    const metrics = this.metricsCollector.getCurrentMetrics();

    return {
      timestamp: Date.now(),
      workflowId: this.workflowId,
      status: report.status,
      progress: this.statusReporter.getProgress(),
      activeSteps: report.stepStatuses.filter(s => s.status === 'running').map(s => s.stepId),
      completedSteps: report.stepStatuses.filter(s => s.status === 'completed').map(s => s.stepId),
      failedSteps: report.stepStatuses.filter(s => s.status === 'failed').map(s => s.stepId),
      metrics,
      alerts: [...this.alerts]
    };
  }

  /**
   * Get execution history
   */
  getExecutionHistory(): MonitoringEvent[] {
    return [...this.events];
  }

  /**
   * Get current alerts
   */
  getAlerts(): PerformanceAlert[] {
    return [...this.alerts];
  }

  /**
   * Get step metrics
   */
  getStepMetrics(stepId: string): StepMetrics | undefined {
    return this.metricsCollector.getStepMetrics(stepId);
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    avgMemoryUsage: number;
    peakMemoryUsage: number;
    avgCpuUsage: number;
    peakCpuUsage: number;
    executionEfficiency: number;
  } {
    return this.metricsCollector.getPerformanceStats();
  }

  /**
   * Export monitoring data
   */
  exportData(): {
    workflowId: string;
    workflow: WorkflowDefinition;
    events: MonitoringEvent[];
    alerts: PerformanceAlert[];
    metrics: WorkflowExecutionMetrics;
    snapshot: ExecutionSnapshot;
  } {
    return {
      workflowId: this.workflowId,
      workflow: this.workflow,
      events: this.getExecutionHistory(),
      alerts: this.getAlerts(),
      metrics: this.metricsCollector.getCurrentMetrics(),
      snapshot: this.getSnapshot()
    };
  }

  /**
   * Start real-time updates
   */
  private startRealTimeUpdates(): void {
    this.monitoringInterval = setInterval(() => {
      this.performPeriodicCheck();
    }, this.config.updateInterval);
  }

  /**
   * Stop real-time updates
   */
  private stopRealTimeUpdates(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Perform periodic monitoring checks
   */
  private performPeriodicCheck(): void {
    this.checkPerformanceThresholds();
    this.cleanupOldData();
    
    this.emitEvent({
      type: 'metrics_updated',
      timestamp: Date.now(),
      workflowId: this.workflowId,
      data: this.getSnapshot()
    });
  }

  /**
   * Check performance thresholds and generate alerts
   */
  private checkPerformanceThresholds(stepId?: string): void {
    const stats = this.getPerformanceStats();
    const now = Date.now();

    // Memory usage check
    const memoryUsageMB = stats.peakMemoryUsage / (1024 * 1024);
    if (memoryUsageMB > this.config.performanceThresholds.maxMemoryUsageMB) {
      this.generateAlert({
        id: `memory_${now}`,
        type: 'memory_usage',
        severity: memoryUsageMB > this.config.performanceThresholds.maxMemoryUsageMB * 1.5 ? 'critical' : 'high',
        message: `Memory usage exceeded threshold: ${memoryUsageMB.toFixed(2)}MB`,
        threshold: this.config.performanceThresholds.maxMemoryUsageMB,
        currentValue: memoryUsageMB,
        stepId,
        timestamp: now
      });
    }

    // CPU usage check
    if (stats.avgCpuUsage > this.config.performanceThresholds.maxCpuUsagePercent) {
      this.generateAlert({
        id: `cpu_${now}`,
        type: 'cpu_usage',
        severity: stats.avgCpuUsage > this.config.performanceThresholds.maxCpuUsagePercent * 1.2 ? 'critical' : 'high',
        message: `CPU usage exceeded threshold: ${stats.avgCpuUsage.toFixed(2)}%`,
        threshold: this.config.performanceThresholds.maxCpuUsagePercent,
        currentValue: stats.avgCpuUsage,
        stepId,
        timestamp: now
      });
    }

    // Step duration check
    if (stepId) {
      const stepMetrics = this.getStepMetrics(stepId);
      if (stepMetrics && stepMetrics.duration && stepMetrics.duration > this.config.performanceThresholds.maxStepDurationMs) {
        this.generateAlert({
          id: `duration_${stepId}_${now}`,
          type: 'duration_exceeded',
          severity: stepMetrics.duration > this.config.performanceThresholds.maxStepDurationMs * 2 ? 'critical' : 'medium',
          message: `Step duration exceeded threshold: ${stepMetrics.duration}ms`,
          threshold: this.config.performanceThresholds.maxStepDurationMs,
          currentValue: stepMetrics.duration,
          stepId,
          timestamp: now
        });
      }
    }
  }

  /**
   * Check error rate and generate alerts
   */
  private checkErrorRate(): void {
    const metrics = this.metricsCollector.getCurrentMetrics();
    const errorRate = metrics.totalSteps > 0 ? metrics.failedSteps / metrics.totalSteps : 0;

    if (errorRate > this.config.performanceThresholds.maxErrorRate) {
      this.generateAlert({
        id: `error_rate_${Date.now()}`,
        type: 'error_rate',
        severity: errorRate > this.config.performanceThresholds.maxErrorRate * 2 ? 'critical' : 'high',
        message: `Error rate exceeded threshold: ${(errorRate * 100).toFixed(2)}%`,
        threshold: this.config.performanceThresholds.maxErrorRate,
        currentValue: errorRate,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Generate and handle performance alerts
   */
  private generateAlert(alert: PerformanceAlert): void {
    this.alerts.push(alert);

    this.emitEvent({
      type: 'performance_alert',
      timestamp: alert.timestamp,
      workflowId: this.workflowId,
      stepId: alert.stepId,
      data: alert
    });

    // Handle alerting channels
    if (this.config.alerting.enabled) {
      this.handleAlert(alert);
    }
  }

  /**
   * Handle alert delivery
   */
  private handleAlert(alert: PerformanceAlert): void {
    for (const channel of this.config.alerting.channels) {
      switch (channel) {
        case 'console':
          console.warn(`[WORKFLOW ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`);
          break;
        case 'file':
          if (this.config.alerting.logFile) {
            // Implementation would write to file
          }
          break;
        case 'webhook':
          if (this.config.alerting.webhookUrl) {
            // Implementation would send HTTP request
          }
          break;
      }
    }
  }

  /**
   * Emit monitoring event
   */
  private emitEvent(event: MonitoringEvent): void {
    this.events.push(event);
    this.emit('monitoring_event', event);
    this.emit(event.type, event);
  }

  /**
   * Clean up old events and alerts
   */
  private cleanupOldData(): void {
    const cutoffTime = Date.now() - this.config.retention.maxAgeMs;
    
    // Clean up old events
    this.events = this.events.filter(event => event.timestamp > cutoffTime);
    if (this.events.length > this.config.retention.maxEvents) {
      this.events = this.events.slice(-this.config.retention.maxEvents);
    }

    // Clean up old alerts
    this.alerts = this.alerts.filter(alert => alert.timestamp > cutoffTime);
  }
}

/**
 * Factory function to create execution monitor
 */
export function createExecutionMonitor(
  workflowId: string,
  workflow: WorkflowDefinition,
  config?: Partial<MonitoringConfiguration>
): ExecutionMonitor {
  return new ExecutionMonitor(workflowId, workflow, config);
}

/**
 * Monitor multiple workflows simultaneously
 */
export class MultiWorkflowMonitor extends EventEmitter {
  private monitors: Map<string, ExecutionMonitor> = new Map();

  /**
   * Add workflow to monitoring
   */
  addWorkflow(
    workflowId: string,
    workflow: WorkflowDefinition,
    config?: Partial<MonitoringConfiguration>
  ): ExecutionMonitor {
    const monitor = createExecutionMonitor(workflowId, workflow, config);
    
    // Forward all events from individual monitors
    monitor.on('monitoring_event', (event) => {
      this.emit('monitoring_event', event);
      this.emit(event.type, event);
    });

    this.monitors.set(workflowId, monitor);
    return monitor;
  }

  /**
   * Remove workflow from monitoring
   */
  removeWorkflow(workflowId: string): void {
    const monitor = this.monitors.get(workflowId);
    if (monitor) {
      monitor.stop();
      monitor.removeAllListeners();
      this.monitors.delete(workflowId);
    }
  }

  /**
   * Get monitor for specific workflow
   */
  getMonitor(workflowId: string): ExecutionMonitor | undefined {
    return this.monitors.get(workflowId);
  }

  /**
   * Get all active monitors
   */
  getAllMonitors(): ExecutionMonitor[] {
    return Array.from(this.monitors.values());
  }

  /**
   * Get aggregated statistics
   */
  getAggregatedStats(): {
    totalWorkflows: number;
    activeWorkflows: number;
    completedWorkflows: number;
    failedWorkflows: number;
    totalAlerts: number;
    criticalAlerts: number;
  } {
    const monitors = this.getAllMonitors();
    
    return {
      totalWorkflows: monitors.length,
      activeWorkflows: monitors.filter(m => m.getSnapshot().status === 'running').length,
      completedWorkflows: monitors.filter(m => m.getSnapshot().status === 'completed').length,
      failedWorkflows: monitors.filter(m => m.getSnapshot().status === 'failed').length,
      totalAlerts: monitors.reduce((sum, m) => sum + m.getAlerts().length, 0),
      criticalAlerts: monitors.reduce((sum, m) => 
        sum + m.getAlerts().filter(a => a.severity === 'critical').length, 0
      )
    };
  }

  /**
   * Stop all monitoring
   */
  stopAll(): void {
    for (const monitor of this.monitors.values()) {
      monitor.stop();
    }
    this.monitors.clear();
  }
}