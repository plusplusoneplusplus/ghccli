/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowStep, StepResult } from '../types.js';
import { WorkflowExecutionMetrics, StepMetrics, PerformanceSnapshot } from '../metrics.js';

export interface ProfilePoint {
  timestamp: number;
  stepId?: string;
  phase: 'start' | 'end' | 'checkpoint';
  metrics: {
    memory: NodeJS.MemoryUsage;
    cpu: NodeJS.CpuUsage;
    eventLoop: {
      delay: number;
      utilization?: number;
    };
    custom?: Record<string, number>;
  };
  context?: Record<string, unknown>;
}

export interface PerformanceProfile {
  workflowId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  profilePoints: ProfilePoint[];
  hotspots: Hotspot[];
  recommendations: ProfileRecommendation[];
  summary: ProfileSummary;
}

export interface Hotspot {
  stepId: string;
  stepName: string;
  type: 'cpu' | 'memory' | 'io' | 'eventloop';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  impact: number; // 0-100 scale
  timeRange: {
    start: number;
    end: number;
    duration: number;
  };
  metrics: {
    maxValue: number;
    avgValue: number;
    threshold: number;
  };
}

export interface ProfileRecommendation {
  type: 'optimization' | 'configuration' | 'architecture';
  priority: 'low' | 'medium' | 'high';
  category: 'memory' | 'cpu' | 'io' | 'parallelization' | 'general';
  title: string;
  description: string;
  implementation: string[];
  estimatedImpact: 'small' | 'medium' | 'large';
}

export interface ProfileSummary {
  totalExecutionTime: number;
  cpuIntensive: {
    steps: string[];
    totalTime: number;
    percentage: number;
  };
  memoryIntensive: {
    steps: string[];
    peakUsage: number;
    averageUsage: number;
  };
  ioBottlenecks: {
    steps: string[];
    totalWaitTime: number;
    percentage: number;
  };
  parallelizationOpportunities: {
    steps: string[][];
    potentialTimeSaving: number;
  };
  overallEfficiency: number; // 0-100 scale
}

export interface ProfilingOptions {
  samplingInterval: number; // milliseconds
  enableCpuProfiling: boolean;
  enableMemoryProfiling: boolean;
  enableEventLoopProfiling: boolean;
  customMetrics: string[];
  thresholds: {
    cpuUsage: number; // percentage
    memoryUsage: number; // MB
    eventLoopDelay: number; // ms
  };
}

/**
 * Advanced performance profiling for workflow execution
 */
export class PerformanceProfiler {
  private workflowId: string;
  private workflow: WorkflowDefinition;
  private options: ProfilingOptions;
  private profilePoints: ProfilePoint[] = [];
  private samplingTimer: NodeJS.Timeout | null = null;
  private baselineCpu: NodeJS.CpuUsage;
  private isActive: boolean = false;
  private stepStartTimes: Map<string, number> = new Map();
  private customMetricsCollectors: Map<string, () => number> = new Map();

  constructor(
    workflowId: string,
    workflow: WorkflowDefinition,
    options: Partial<ProfilingOptions> = {}
  ) {
    this.workflowId = workflowId;
    this.workflow = workflow;
    this.baselineCpu = process.cpuUsage();
    
    this.options = {
      samplingInterval: 100, // 100ms
      enableCpuProfiling: true,
      enableMemoryProfiling: true,
      enableEventLoopProfiling: true,
      customMetrics: [],
      thresholds: {
        cpuUsage: 80,
        memoryUsage: 512,
        eventLoopDelay: 10
      },
      ...options
    };
  }

  /**
   * Start performance profiling
   */
  start(): void {
    if (this.isActive) return;
    
    this.isActive = true;
    this.profilePoints = [];
    this.baselineCpu = process.cpuUsage();
    
    // Record initial profile point
    this.recordProfilePoint({
      phase: 'start',
      context: {
        workflowName: this.workflow.name,
        totalSteps: this.workflow.steps.length
      }
    });

    // Start continuous sampling
    this.startSampling();
  }

  /**
   * Stop performance profiling
   */
  stop(): PerformanceProfile {
    if (!this.isActive) {
      throw new Error('Profiler is not active');
    }

    this.isActive = false;
    this.stopSampling();

    // Record final profile point
    this.recordProfilePoint({
      phase: 'end',
      context: {
        totalProfilePoints: this.profilePoints.length
      }
    });

    return this.generateProfile();
  }

  /**
   * Record step start for profiling
   */
  recordStepStart(step: WorkflowStep): void {
    if (!this.isActive) return;

    const timestamp = Date.now();
    this.stepStartTimes.set(step.id, timestamp);
    
    this.recordProfilePoint({
      stepId: step.id,
      phase: 'start',
      context: {
        stepName: step.name,
        stepType: step.type
      }
    });
  }

  /**
   * Record step end for profiling
   */
  recordStepEnd(step: WorkflowStep, result: StepResult): void {
    if (!this.isActive) return;

    this.recordProfilePoint({
      stepId: step.id,
      phase: 'end',
      context: {
        stepName: step.name,
        success: result.success,
        executionTime: result.executionTime
      }
    });

    this.stepStartTimes.delete(step.id);
  }

  /**
   * Record custom checkpoint
   */
  recordCheckpoint(stepId: string, label: string, customMetrics?: Record<string, number>): void {
    if (!this.isActive) return;

    const profilePoint: Partial<ProfilePoint> = {
      stepId,
      phase: 'checkpoint',
      context: { label }
    };
    
    this.recordProfilePoint(profilePoint, customMetrics);
  }

  /**
   * Add custom metric collector
   */
  addCustomMetric(name: string, collector: () => number): void {
    this.customMetricsCollectors.set(name, collector);
  }

  /**
   * Generate comprehensive performance profile
   */
  private generateProfile(): PerformanceProfile {
    const startTime = this.profilePoints[0]?.timestamp || Date.now();
    const endTime = this.profilePoints[this.profilePoints.length - 1]?.timestamp || Date.now();
    const duration = endTime - startTime;

    const hotspots = this.identifyHotspots();
    const recommendations = this.generateRecommendations(hotspots);
    const summary = this.generateSummary();

    return {
      workflowId: this.workflowId,
      startTime,
      endTime,
      duration,
      profilePoints: [...this.profilePoints],
      hotspots,
      recommendations,
      summary
    };
  }

  /**
   * Record a profile point with current system metrics
   */
  private recordProfilePoint(point: Partial<ProfilePoint>, customMetrics?: Record<string, number>): void {
    const timestamp = Date.now();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage(this.baselineCpu);
    
    // Measure event loop delay
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const delay = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms
      
      const profilePoint: ProfilePoint = {
        timestamp,
        stepId: point.stepId,
        phase: point.phase || 'checkpoint',
        metrics: {
          memory,
          cpu,
          eventLoop: { delay },
          custom: customMetrics || this.collectCustomMetrics()
        },
        context: point.context,
        ...point
      };

      this.profilePoints.push(profilePoint);
    });
  }

  /**
   * Start continuous sampling
   */
  private startSampling(): void {
    this.samplingTimer = setInterval(() => {
      this.recordProfilePoint({ phase: 'checkpoint' });
    }, this.options.samplingInterval);
  }

  /**
   * Stop continuous sampling
   */
  private stopSampling(): void {
    if (this.samplingTimer) {
      clearInterval(this.samplingTimer);
      this.samplingTimer = null;
    }
  }

  /**
   * Collect custom metrics
   */
  private collectCustomMetrics(): Record<string, number> {
    const metrics: Record<string, number> = {};
    
    for (const [name, collector] of this.customMetricsCollectors) {
      try {
        metrics[name] = collector();
      } catch (error) {
        console.warn(`Failed to collect custom metric '${name}':`, error);
      }
    }
    
    return metrics;
  }

  /**
   * Identify performance hotspots
   */
  private identifyHotspots(): Hotspot[] {
    const hotspots: Hotspot[] = [];
    const stepGroups = this.groupProfilePointsByStep();

    for (const [stepId, points] of stepGroups) {
      const step = this.workflow.steps.find(s => s.id === stepId);
      if (!step || points.length < 2) continue;

      const startPoint = points.find(p => p.phase === 'start');
      const endPoint = points.find(p => p.phase === 'end');
      
      if (!startPoint || !endPoint) continue;

      const duration = endPoint.timestamp - startPoint.timestamp;
      const timeRange = {
        start: startPoint.timestamp,
        end: endPoint.timestamp,
        duration
      };

      // Check CPU hotspots
      const cpuUsages = points.map(p => p.metrics.cpu.user + p.metrics.cpu.system);
      const maxCpuUsage = Math.max(...cpuUsages);
      const avgCpuUsage = cpuUsages.reduce((sum, val) => sum + val, 0) / cpuUsages.length;

      if (maxCpuUsage > this.options.thresholds.cpuUsage * 1000) { // Convert to microseconds
        hotspots.push({
          stepId,
          stepName: step.name,
          type: 'cpu',
          severity: this.calculateSeverity(maxCpuUsage, this.options.thresholds.cpuUsage * 1000),
          description: `High CPU usage detected: ${(maxCpuUsage / 1000).toFixed(2)}ms`,
          impact: this.calculateImpact(duration, maxCpuUsage),
          timeRange,
          metrics: {
            maxValue: maxCpuUsage,
            avgValue: avgCpuUsage,
            threshold: this.options.thresholds.cpuUsage * 1000
          }
        });
      }

      // Check memory hotspots
      const memoryUsages = points.map(p => p.metrics.memory.heapUsed / (1024 * 1024)); // Convert to MB
      const maxMemoryUsage = Math.max(...memoryUsages);
      const avgMemoryUsage = memoryUsages.reduce((sum, val) => sum + val, 0) / memoryUsages.length;

      if (maxMemoryUsage > this.options.thresholds.memoryUsage) {
        hotspots.push({
          stepId,
          stepName: step.name,
          type: 'memory',
          severity: this.calculateSeverity(maxMemoryUsage, this.options.thresholds.memoryUsage),
          description: `High memory usage detected: ${maxMemoryUsage.toFixed(2)}MB`,
          impact: this.calculateImpact(duration, maxMemoryUsage),
          timeRange,
          metrics: {
            maxValue: maxMemoryUsage,
            avgValue: avgMemoryUsage,
            threshold: this.options.thresholds.memoryUsage
          }
        });
      }

      // Check event loop hotspots
      const eventLoopDelays = points.map(p => p.metrics.eventLoop.delay);
      const maxEventLoopDelay = Math.max(...eventLoopDelays);
      const avgEventLoopDelay = eventLoopDelays.reduce((sum, val) => sum + val, 0) / eventLoopDelays.length;

      if (maxEventLoopDelay > this.options.thresholds.eventLoopDelay) {
        hotspots.push({
          stepId,
          stepName: step.name,
          type: 'eventloop',
          severity: this.calculateSeverity(maxEventLoopDelay, this.options.thresholds.eventLoopDelay),
          description: `Event loop delay detected: ${maxEventLoopDelay.toFixed(2)}ms`,
          impact: this.calculateImpact(duration, maxEventLoopDelay),
          timeRange,
          metrics: {
            maxValue: maxEventLoopDelay,
            avgValue: avgEventLoopDelay,
            threshold: this.options.thresholds.eventLoopDelay
          }
        });
      }
    }

    return hotspots.sort((a, b) => b.impact - a.impact);
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(hotspots: Hotspot[]): ProfileRecommendation[] {
    const recommendations: ProfileRecommendation[] = [];
    const hotspotsbyType = new Map<string, Hotspot[]>();

    // Group hotspots by type
    for (const hotspot of hotspots) {
      if (!hotspotsbyType.has(hotspot.type)) {
        hotspotsbyType.set(hotspot.type, []);
      }
      hotspotsbyType.get(hotspot.type)!.push(hotspot);
    }

    // CPU recommendations
    const cpuHotspots = hotspotsbyType.get('cpu') || [];
    if (cpuHotspots.length > 0) {
      recommendations.push({
        type: 'optimization',
        priority: 'high',
        category: 'cpu',
        title: 'Optimize CPU-intensive operations',
        description: `${cpuHotspots.length} steps show high CPU usage. Consider optimization or parallelization.`,
        implementation: [
          'Profile individual step implementations for optimization opportunities',
          'Consider breaking down CPU-intensive steps into smaller chunks',
          'Implement parallel processing where possible',
          'Use worker threads for CPU-bound operations'
        ],
        estimatedImpact: 'large'
      });
    }

    // Memory recommendations
    const memoryHotspots = hotspotsbyType.get('memory') || [];
    if (memoryHotspots.length > 0) {
      recommendations.push({
        type: 'optimization',
        priority: 'medium',
        category: 'memory',
        title: 'Optimize memory usage',
        description: `${memoryHotspots.length} steps show high memory usage. Memory optimization needed.`,
        implementation: [
          'Implement streaming processing for large data sets',
          'Add explicit garbage collection triggers after memory-intensive steps',
          'Consider using memory-mapped files for large data processing',
          'Implement data pagination and lazy loading'
        ],
        estimatedImpact: 'medium'
      });
    }

    // Event loop recommendations
    const eventLoopHotspots = hotspotsbyType.get('eventloop') || [];
    if (eventLoopHotspots.length > 0) {
      recommendations.push({
        type: 'architecture',
        priority: 'high',
        category: 'io',
        title: 'Address event loop blocking',
        description: `${eventLoopHotspots.length} steps are blocking the event loop. Async optimization needed.`,
        implementation: [
          'Convert synchronous operations to asynchronous where possible',
          'Use setImmediate() or process.nextTick() to yield control',
          'Implement proper async/await patterns',
          'Consider using worker threads for blocking operations'
        ],
        estimatedImpact: 'large'
      });
    }

    // Parallelization recommendations
    const parallelizationOpportunities = this.identifyParallelizationOpportunities();
    if (parallelizationOpportunities.length > 0) {
      recommendations.push({
        type: 'architecture',
        priority: 'medium',
        category: 'parallelization',
        title: 'Enable parallel execution',
        description: `${parallelizationOpportunities.length} groups of steps could run in parallel.`,
        implementation: [
          'Configure parallel execution for independent steps',
          'Review and optimize dependency chains',
          'Implement resource pooling for parallel operations',
          'Consider step batching for better throughput'
        ],
        estimatedImpact: 'large'
      });
    }

    return recommendations.sort((a, b) => {
      const priorityWeight = { high: 3, medium: 2, low: 1 };
      return priorityWeight[b.priority] - priorityWeight[a.priority];
    });
  }

  /**
   * Generate performance summary
   */
  private generateSummary(): ProfileSummary {
    const stepGroups = this.groupProfilePointsByStep();
    const totalDuration = this.profilePoints[this.profilePoints.length - 1]?.timestamp - this.profilePoints[0]?.timestamp || 0;

    const cpuIntensiveSteps: string[] = [];
    const memoryIntensiveSteps: string[] = [];
    const ioBottleneckSteps: string[] = [];
    
    let totalCpuTime = 0;
    let peakMemoryUsage = 0;
    let totalMemoryUsage = 0;
    let totalMemoryMeasurements = 0;
    let totalIoWaitTime = 0;

    for (const [stepId, points] of stepGroups) {
      // Analyze CPU usage
      const cpuUsages = points.map(p => p.metrics.cpu.user + p.metrics.cpu.system);
      const maxCpuUsage = Math.max(...cpuUsages);
      const stepCpuTime = cpuUsages.reduce((sum, val) => sum + val, 0) / 1000; // Convert to ms
      
      totalCpuTime += stepCpuTime;
      
      if (maxCpuUsage > this.options.thresholds.cpuUsage * 1000) {
        cpuIntensiveSteps.push(stepId);
      }

      // Analyze memory usage
      const memoryUsages = points.map(p => p.metrics.memory.heapUsed);
      const maxMemoryUsage = Math.max(...memoryUsages);
      const avgMemoryUsage = memoryUsages.reduce((sum, val) => sum + val, 0) / memoryUsages.length;
      
      peakMemoryUsage = Math.max(peakMemoryUsage, maxMemoryUsage);
      totalMemoryUsage += avgMemoryUsage;
      totalMemoryMeasurements++;
      
      if (maxMemoryUsage > this.options.thresholds.memoryUsage * 1024 * 1024) {
        memoryIntensiveSteps.push(stepId);
      }

      // Analyze I/O bottlenecks (using event loop delay as proxy)
      const eventLoopDelays = points.map(p => p.metrics.eventLoop.delay);
      const maxEventLoopDelay = Math.max(...eventLoopDelays);
      const stepIoWait = eventLoopDelays.reduce((sum, val) => sum + val, 0);
      
      totalIoWaitTime += stepIoWait;
      
      if (maxEventLoopDelay > this.options.thresholds.eventLoopDelay) {
        ioBottleneckSteps.push(stepId);
      }
    }

    const parallelizationOpportunities = this.identifyParallelizationOpportunities();
    const potentialTimeSaving = parallelizationOpportunities.reduce((sum, group) => {
      return sum + Math.max(...group.map(stepId => this.getStepDuration(stepId))) - Math.min(...group.map(stepId => this.getStepDuration(stepId)));
    }, 0);

    // Calculate overall efficiency (0-100)
    const cpuEfficiency = Math.min(100, (totalCpuTime / totalDuration) * 100);
    const memoryEfficiency = peakMemoryUsage > 0 ? Math.max(0, 100 - (peakMemoryUsage / (1024 * 1024 * 1024))) : 100; // Penalty for high memory usage
    const ioEfficiency = Math.max(0, 100 - (totalIoWaitTime / totalDuration) * 100);
    const overallEfficiency = (cpuEfficiency + memoryEfficiency + ioEfficiency) / 3;

    return {
      totalExecutionTime: totalDuration,
      cpuIntensive: {
        steps: cpuIntensiveSteps,
        totalTime: totalCpuTime,
        percentage: (totalCpuTime / totalDuration) * 100
      },
      memoryIntensive: {
        steps: memoryIntensiveSteps,
        peakUsage: peakMemoryUsage / (1024 * 1024), // Convert to MB
        averageUsage: totalMemoryMeasurements > 0 ? (totalMemoryUsage / totalMemoryMeasurements) / (1024 * 1024) : 0
      },
      ioBottlenecks: {
        steps: ioBottleneckSteps,
        totalWaitTime: totalIoWaitTime,
        percentage: (totalIoWaitTime / totalDuration) * 100
      },
      parallelizationOpportunities: {
        steps: parallelizationOpportunities,
        potentialTimeSaving
      },
      overallEfficiency: Math.round(overallEfficiency)
    };
  }

  /**
   * Helper methods
   */
  private groupProfilePointsByStep(): Map<string, ProfilePoint[]> {
    const groups = new Map<string, ProfilePoint[]>();
    
    for (const point of this.profilePoints) {
      if (point.stepId) {
        if (!groups.has(point.stepId)) {
          groups.set(point.stepId, []);
        }
        groups.get(point.stepId)!.push(point);
      }
    }
    
    return groups;
  }

  private calculateSeverity(value: number, threshold: number): Hotspot['severity'] {
    const ratio = value / threshold;
    if (ratio > 3) return 'critical';
    if (ratio > 2) return 'high';
    if (ratio > 1.5) return 'medium';
    return 'low';
  }

  private calculateImpact(duration: number, value: number): number {
    // Simple impact calculation based on duration and severity
    const durationWeight = Math.min(100, (duration / 1000) * 10); // Duration in seconds, weighted
    const severityWeight = Math.min(100, value / 1000); // Normalize value
    return Math.round((durationWeight + severityWeight) / 2);
  }

  private identifyParallelizationOpportunities(): string[][] {
    const opportunities: string[][] = [];
    const stepDependencies = new Map<string, string[]>();
    
    // Build dependency map
    for (const step of this.workflow.steps) {
      stepDependencies.set(step.id, step.dependsOn || []);
    }

    // Find groups of steps that could run in parallel
    const independentGroups = this.findIndependentStepGroups(stepDependencies);
    
    return independentGroups.filter(group => group.length > 1);
  }

  private findIndependentStepGroups(dependencies: Map<string, string[]>): string[][] {
    const groups: string[][] = [];
    const processed = new Set<string>();
    
    for (const [stepId, deps] of dependencies) {
      if (processed.has(stepId)) continue;
      
      const group = [stepId];
      processed.add(stepId);
      
      // Find other steps with the same dependencies
      for (const [otherStepId, otherDeps] of dependencies) {
        if (processed.has(otherStepId)) continue;
        
        if (this.arraysEqual(deps, otherDeps)) {
          group.push(otherStepId);
          processed.add(otherStepId);
        }
      }
      
      groups.push(group);
    }
    
    return groups;
  }

  private arraysEqual(arr1: string[], arr2: string[]): boolean {
    if (arr1.length !== arr2.length) return false;
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    return sorted1.every((val, idx) => val === sorted2[idx]);
  }

  private getStepDuration(stepId: string): number {
    const points = this.profilePoints.filter(p => p.stepId === stepId);
    const startPoint = points.find(p => p.phase === 'start');
    const endPoint = points.find(p => p.phase === 'end');
    
    if (startPoint && endPoint) {
      return endPoint.timestamp - startPoint.timestamp;
    }
    
    return 0;
  }
}

/**
 * Factory function to create performance profiler
 */
export function createPerformanceProfiler(
  workflowId: string,
  workflow: WorkflowDefinition,
  options?: Partial<ProfilingOptions>
): PerformanceProfiler {
  return new PerformanceProfiler(workflowId, workflow, options);
}

/**
 * Utility function to export profile data
 */
export function exportProfileData(profile: PerformanceProfile, format: 'json' | 'csv' | 'summary' = 'json'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(profile, null, 2);
    case 'csv':
      return convertProfileToCSV(profile);
    case 'summary':
      return generateProfileSummaryText(profile);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

function convertProfileToCSV(profile: PerformanceProfile): string {
  const lines: string[] = [];
  lines.push('timestamp,stepId,phase,memoryUsed,cpuUser,cpuSystem,eventLoopDelay');
  
  for (const point of profile.profilePoints) {
    lines.push([
      point.timestamp,
      point.stepId || '',
      point.phase,
      point.metrics.memory.heapUsed,
      point.metrics.cpu.user,
      point.metrics.cpu.system,
      point.metrics.eventLoop.delay
    ].join(','));
  }
  
  return lines.join('\n');
}

function generateProfileSummaryText(profile: PerformanceProfile): string {
  const lines: string[] = [];
  
  lines.push('PERFORMANCE PROFILE SUMMARY');
  lines.push('===========================');
  lines.push(`Workflow: ${profile.workflowId}`);
  lines.push(`Duration: ${profile.duration}ms`);
  lines.push(`Profile Points: ${profile.profilePoints.length}`);
  lines.push('');
  
  if (profile.hotspots.length > 0) {
    lines.push('HOTSPOTS:');
    for (const hotspot of profile.hotspots.slice(0, 5)) {
      lines.push(`  ${hotspot.stepName} (${hotspot.type}): ${hotspot.description}`);
    }
    lines.push('');
  }
  
  if (profile.recommendations.length > 0) {
    lines.push('TOP RECOMMENDATIONS:');
    for (const rec of profile.recommendations.slice(0, 3)) {
      lines.push(`  ${rec.title}: ${rec.description}`);
    }
    lines.push('');
  }
  
  lines.push('SUMMARY:');
  lines.push(`  Overall Efficiency: ${profile.summary.overallEfficiency}%`);
  lines.push(`  CPU Intensive Steps: ${profile.summary.cpuIntensive.steps.length}`);
  lines.push(`  Memory Peak: ${profile.summary.memoryIntensive.peakUsage.toFixed(2)}MB`);
  lines.push(`  I/O Bottlenecks: ${profile.summary.ioBottlenecks.steps.length}`);
  
  return lines.join('\n');
}