/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TelemetryEvent,
  UserPromptEvent,
  ToolCallEvent,
  ApiRequestEvent,
  ApiResponseEvent,
  ApiErrorEvent
} from '../../telemetry/index.js';
import { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult } from '../types.js';
import { WorkflowExecutionMetrics, StepMetrics } from '../metrics.js';
import { ExecutionMonitor, MonitoringEvent, PerformanceAlert } from './ExecutionMonitor.js';
import { PerformanceProfile } from './PerformanceProfiler.js';

/**
 * Base interface for workflow telemetry events
 */
export interface WorkflowTelemetryEvent {
  type: string;
  timestamp: number;
  workflowId: string;
  workflowName: string;
}

export interface WorkflowStartedEvent extends WorkflowTelemetryEvent {
  type: 'workflow_started';
  totalSteps: number;
  estimatedDuration?: number;
  parallelEnabled: boolean;
}

export interface WorkflowCompletedEvent extends WorkflowTelemetryEvent {
  type: 'workflow_completed';
  success: boolean;
  duration: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  retriedSteps: number;
  metrics: WorkflowExecutionMetrics;
}

export interface StepExecutionEvent extends WorkflowTelemetryEvent {
  type: 'step_started' | 'step_completed' | 'step_failed' | 'step_retried' | 'step_skipped';
  stepId: string;
  stepName: string;
  stepType: string;
  duration?: number;
  success?: boolean;
  error?: string;
  retryAttempt?: number;
  parallelGroup?: number;
}

export interface PerformanceAlertEvent extends WorkflowTelemetryEvent {
  type: 'performance_alert';
  alertType: string;
  severity: string;
  stepId?: string;
  threshold: number;
  currentValue: number;
  message: string;
}

export interface WorkflowMetricsEvent extends WorkflowTelemetryEvent {
  type: 'workflow_metrics';
  metrics: {
    memoryUsage: number;
    cpuUsage: number;
    activeSteps: number;
    queuedSteps: number;
    errorRate: number;
    throughput: number;
  };
}

export interface TelemetryConfiguration {
  enabled: boolean;
  includeStepDetails: boolean;
  includePerformanceMetrics: boolean;
  includeDebugInfo: boolean;
  samplingRate: number; // 0.0 to 1.0
  bufferSize: number;
  flushInterval: number; // milliseconds
  customAttributes: Record<string, string>;
}

/**
 * Integrates workflow monitoring with existing telemetry system
 */
export class WorkflowTelemetryIntegration {
  private config: TelemetryConfiguration;
  private eventBuffer: WorkflowTelemetryEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private monitors: Map<string, ExecutionMonitor> = new Map();

  constructor(config: Partial<TelemetryConfiguration> = {}) {
    this.config = {
      enabled: true,
      includeStepDetails: true,
      includePerformanceMetrics: true,
      includeDebugInfo: false,
      samplingRate: 1.0,
      bufferSize: 100,
      flushInterval: 5000, // 5 seconds
      customAttributes: {},
      ...config
    };

    if (this.config.enabled) {
      this.startPeriodicFlush();
    }
  }

  /**
   * Register a workflow monitor for telemetry integration
   */
  registerMonitor(monitor: ExecutionMonitor, workflowId: string, workflowName: string): void {
    if (!this.config.enabled) return;

    this.monitors.set(workflowId, monitor);

    // Subscribe to all monitoring events
    monitor.on('workflow_started', (event: MonitoringEvent) => {
      this.handleWorkflowStarted(event, workflowId, workflowName);
    });

    monitor.on('workflow_completed', (event: MonitoringEvent) => {
      this.handleWorkflowCompleted(event, workflowId, workflowName);
    });

    monitor.on('workflow_failed', (event: MonitoringEvent) => {
      this.handleWorkflowCompleted(event, workflowId, workflowName);
    });

    monitor.on('step_started', (event: MonitoringEvent) => {
      this.handleStepExecution(event, workflowId, workflowName);
    });

    monitor.on('step_completed', (event: MonitoringEvent) => {
      this.handleStepExecution(event, workflowId, workflowName);
    });

    monitor.on('step_failed', (event: MonitoringEvent) => {
      this.handleStepExecution(event, workflowId, workflowName);
    });

    monitor.on('step_retried', (event: MonitoringEvent) => {
      this.handleStepExecution(event, workflowId, workflowName);
    });

    monitor.on('step_skipped', (event: MonitoringEvent) => {
      this.handleStepExecution(event, workflowId, workflowName);
    });

    monitor.on('performance_alert', (event: MonitoringEvent) => {
      this.handlePerformanceAlert(event, workflowId, workflowName);
    });

    monitor.on('metrics_updated', (event: MonitoringEvent) => {
      this.handleMetricsUpdate(event, workflowId, workflowName);
    });
  }

  /**
   * Unregister a workflow monitor
   */
  unregisterMonitor(workflowId: string): void {
    const monitor = this.monitors.get(workflowId);
    if (monitor) {
      monitor.removeAllListeners();
      this.monitors.delete(workflowId);
    }
  }

  /**
   * Log workflow execution as API request/response pattern
   */
  logWorkflowExecution(
    workflow: WorkflowDefinition,
    result: WorkflowResult,
    metrics: WorkflowExecutionMetrics
  ): void {
    if (!this.config.enabled || !this.shouldSample()) return;

    // Create custom logging events for workflow execution
    // In a real implementation, this would integrate with the actual telemetry system
    console.log(`[WORKFLOW_TELEMETRY] Workflow ${workflow.name} executed with result:`, {
      success: result.success,
      duration: metrics.totalDuration,
      completedSteps: metrics.completedSteps,
      failedSteps: metrics.failedSteps
    });
  }

  /**
   * Log step execution as tool call
   */
  logStepExecution(
    step: WorkflowStep,
    result: StepResult,
    stepMetrics?: StepMetrics
  ): void {
    if (!this.config.enabled || !this.shouldSample()) return;

    // Create custom logging events for step execution
    // In a real implementation, this would integrate with the actual telemetry system
    console.log(`[WORKFLOW_TELEMETRY] Step ${step.name} executed:`, {
      stepType: step.type,
      success: result.success,
      duration: result.executionTime || stepMetrics?.duration || 0,
      error: result.error
    });
  }

  /**
   * Export telemetry data for external systems
   */
  exportTelemetryData(workflowId: string): {
    events: WorkflowTelemetryEvent[];
    metrics: WorkflowExecutionMetrics | null;
    summary: {
      totalEvents: number;
      eventTypes: Record<string, number>;
      timeRange: { start: number; end: number };
    };
  } {
    const workflowEvents = this.eventBuffer.filter(e => e.workflowId === workflowId);
    const monitor = this.monitors.get(workflowId);
    const metrics = monitor?.getSnapshot()?.metrics || null;

    const eventTypes: Record<string, number> = {};
    let startTime = Infinity;
    let endTime = 0;

    for (const event of workflowEvents) {
      eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
      if (event.timestamp) {
        startTime = Math.min(startTime, event.timestamp);
        endTime = Math.max(endTime, event.timestamp);
      }
    }

    return {
      events: [...workflowEvents],
      metrics,
      summary: {
        totalEvents: workflowEvents.length,
        eventTypes,
        timeRange: { start: startTime === Infinity ? 0 : startTime, end: endTime }
      }
    };
  }

  /**
   * Generate performance insights from telemetry data
   */
  generatePerformanceInsights(workflowId: string): {
    efficiency: number;
    bottlenecks: string[];
    recommendations: string[];
    trends: {
      executionTime: { trend: 'improving' | 'degrading' | 'stable'; change: number };
      errorRate: { trend: 'improving' | 'degrading' | 'stable'; change: number };
      throughput: { trend: 'improving' | 'degrading' | 'stable'; change: number };
    };
  } {
    const data = this.exportTelemetryData(workflowId);
    const events = data.events;
    const metrics = data.metrics;

    if (!metrics || events.length === 0) {
      return {
        efficiency: 0,
        bottlenecks: [],
        recommendations: [],
        trends: {
          executionTime: { trend: 'stable', change: 0 },
          errorRate: { trend: 'stable', change: 0 },
          throughput: { trend: 'stable', change: 0 }
        }
      };
    }

    // Calculate efficiency
    const successRate = metrics.completedSteps / metrics.totalSteps;
    const timeEfficiency = metrics.totalSteps / ((metrics.totalDuration || 1) / 1000); // steps per second
    const resourceEfficiency = Math.max(0, 1 - (metrics.memoryPeak / (1024 * 1024 * 1024))); // Penalty for high memory
    const efficiency = Math.round((successRate * 0.5 + Math.min(timeEfficiency, 1) * 0.3 + resourceEfficiency * 0.2) * 100);

    // Identify bottlenecks
    const bottlenecks: string[] = [];
    const alertEvents = events.filter(e => e.type === 'performance_alert');
    const criticalAlerts = alertEvents.filter(e => (e as PerformanceAlertEvent).severity === 'critical');
    
    for (const alert of criticalAlerts) {
      const alertEvent = alert as PerformanceAlertEvent;
      bottlenecks.push(`${alertEvent.alertType} in step ${alertEvent.stepId}: ${alertEvent.message}`);
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (successRate < 0.9) {
      recommendations.push('Improve error handling and retry mechanisms');
    }
    if (timeEfficiency < 0.1) {
      recommendations.push('Optimize step execution performance');
    }
    if (metrics.memoryPeak > 512 * 1024 * 1024) {
      recommendations.push('Optimize memory usage to prevent resource exhaustion');
    }
    if (alertEvents.length > 0) {
      recommendations.push('Address performance alerts to improve stability');
    }

    return {
      efficiency,
      bottlenecks,
      recommendations,
      trends: {
        executionTime: { trend: 'stable', change: 0 }, // Would need historical data
        errorRate: { trend: 'stable', change: 0 },
        throughput: { trend: 'stable', change: 0 }
      }
    };
  }

  /**
   * Shutdown telemetry integration
   */
  shutdown(): void {
    this.stopPeriodicFlush();
    this.flushEvents();
    
    for (const monitor of this.monitors.values()) {
      monitor.removeAllListeners();
    }
    this.monitors.clear();
  }

  /**
   * Event handlers
   */
  private handleWorkflowStarted(event: MonitoringEvent, workflowId: string, workflowName: string): void {
    const telemetryEvent: WorkflowStartedEvent = {
      type: 'workflow_started',
      timestamp: event.timestamp,
      workflowId,
      workflowName,
      totalSteps: (event.data as any)?.totalSteps || 0,
      estimatedDuration: (event.data as any)?.estimatedDuration,
      parallelEnabled: (event.data as any)?.parallelEnabled || false
    };

    this.bufferEvent(telemetryEvent);
  }

  private handleWorkflowCompleted(event: MonitoringEvent, workflowId: string, workflowName: string): void {
    const eventData = event.data as any;
    const telemetryEvent: WorkflowCompletedEvent = {
      type: 'workflow_completed',
      timestamp: event.timestamp,
      workflowId,
      workflowName,
      success: eventData?.success || false,
      duration: eventData?.executionTime || 0,
      completedSteps: eventData?.metrics?.completedSteps || 0,
      failedSteps: eventData?.metrics?.failedSteps || 0,
      skippedSteps: eventData?.metrics?.skippedSteps || 0,
      retriedSteps: eventData?.metrics?.retriedSteps || 0,
      metrics: eventData?.metrics
    };

    this.bufferEvent(telemetryEvent);
  }

  private handleStepExecution(event: MonitoringEvent, workflowId: string, workflowName: string): void {
    const eventData = event.data as any;
    const telemetryEvent: StepExecutionEvent = {
      type: event.type as any,
      timestamp: event.timestamp,
      workflowId,
      workflowName,
      stepId: event.stepId || '',
      stepName: eventData?.stepName || '',
      stepType: eventData?.stepType || '',
      duration: eventData?.executionTime,
      success: eventData?.success,
      error: eventData?.error,
      retryAttempt: eventData?.attempt,
      parallelGroup: eventData?.parallelGroup
    };

    this.bufferEvent(telemetryEvent);
  }

  private handlePerformanceAlert(event: MonitoringEvent, workflowId: string, workflowName: string): void {
    const alertData = event.data as PerformanceAlert;
    const telemetryEvent: PerformanceAlertEvent = {
      type: 'performance_alert',
      timestamp: event.timestamp,
      workflowId,
      workflowName,
      alertType: alertData.type,
      severity: alertData.severity,
      stepId: alertData.stepId,
      threshold: alertData.threshold,
      currentValue: alertData.currentValue,
      message: alertData.message
    };

    this.bufferEvent(telemetryEvent);
  }

  private handleMetricsUpdate(event: MonitoringEvent, workflowId: string, workflowName: string): void {
    if (!this.config.includePerformanceMetrics) return;

    const snapshot = event.data as any;
    const telemetryEvent: WorkflowMetricsEvent = {
      type: 'workflow_metrics',
      timestamp: event.timestamp,
      workflowId,
      workflowName,
      metrics: {
        memoryUsage: snapshot?.metrics?.memoryPeak || 0,
        cpuUsage: snapshot?.metrics?.averageCpuUsage || 0,
        activeSteps: snapshot?.activeSteps?.length || 0,
        queuedSteps: snapshot?.metrics?.totalSteps - snapshot?.metrics?.completedSteps - snapshot?.metrics?.failedSteps || 0,
        errorRate: snapshot?.metrics?.totalSteps > 0 ? snapshot?.metrics?.failedSteps / snapshot?.metrics?.totalSteps : 0,
        throughput: snapshot?.metrics?.totalDuration > 0 ? snapshot?.metrics?.completedSteps / (snapshot?.metrics?.totalDuration / 1000) : 0
      }
    };

    this.bufferEvent(telemetryEvent);
  }

  /**
   * Helper methods
   */
  private bufferEvent(event: WorkflowTelemetryEvent): void {
    if (!this.shouldSample()) return;

    this.eventBuffer.push(event);

    if (this.eventBuffer.length >= this.config.bufferSize) {
      this.flushEvents();
    }
  }

  private shouldSample(): boolean {
    return Math.random() < this.config.samplingRate;
  }

  private startPeriodicFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flushEvents();
    }, this.config.flushInterval);
  }

  private stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private flushEvents(): void {
    if (this.eventBuffer.length === 0) return;

    // In a real implementation, this would send events to the telemetry backend
    // For now, we'll just log them
    if (this.config.includeDebugInfo) {
      console.log(`[TELEMETRY] Flushing ${this.eventBuffer.length} workflow events`);
    }

    this.eventBuffer = [];
  }
}

/**
 * Factory function to create telemetry integration
 */
export function createWorkflowTelemetryIntegration(
  config?: Partial<TelemetryConfiguration>
): WorkflowTelemetryIntegration {
  return new WorkflowTelemetryIntegration(config);
}

/**
 * Global telemetry integration instance
 */
let globalTelemetryIntegration: WorkflowTelemetryIntegration | null = null;

/**
 * Initialize global workflow telemetry
 */
export function initializeWorkflowTelemetry(config?: Partial<TelemetryConfiguration>): void {
  if (globalTelemetryIntegration) {
    globalTelemetryIntegration.shutdown();
  }
  globalTelemetryIntegration = createWorkflowTelemetryIntegration(config);
}

/**
 * Get global telemetry integration instance
 */
export function getWorkflowTelemetry(): WorkflowTelemetryIntegration | null {
  return globalTelemetryIntegration;
}

/**
 * Shutdown global workflow telemetry
 */
export function shutdownWorkflowTelemetry(): void {
  if (globalTelemetryIntegration) {
    globalTelemetryIntegration.shutdown();
    globalTelemetryIntegration = null;
  }
}