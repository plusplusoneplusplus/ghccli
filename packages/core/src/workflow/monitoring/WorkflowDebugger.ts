/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowStep, StepResult, WorkflowResult } from '../types.js';
import { WorkflowError } from '../errors.js';
import { WorkflowExecutionMetrics, StepMetrics } from '../metrics.js';
import { WorkflowExecutionReport, StepStatus } from '../WorkflowStatusReporter.js';
import { WorkflowContext, LogEntry } from '../WorkflowContext.js';

export interface DebugInfo {
  stepId: string;
  stepName: string;
  stepType: string;
  status: string;
  error?: WorkflowError;
  errorStack?: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  environment: Record<string, string>;
  dependencies: string[];
  dependents: string[];
  executionContext: {
    workflowId: string;
    variables: Record<string, unknown>;
    startTime: number;
    endTime?: number;
    duration?: number;
    retryCount: number;
    parallelGroup?: number;
  };
  systemInfo: {
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage?: NodeJS.CpuUsage;
    processInfo: {
      pid: number;
      platform: string;
      nodeVersion: string;
      workingDirectory: string;
    };
  };
  logs: LogEntry[];
}

export interface FailureAnalysis {
  stepId: string;
  failureType: 'timeout' | 'dependency_failure' | 'configuration_error' | 'runtime_error' | 'resource_exhaustion' | 'unknown';
  rootCause: string;
  possibleSolutions: string[];
  relatedFailures: string[];
  criticality: 'low' | 'medium' | 'high' | 'critical';
  impact: {
    affectedSteps: string[];
    workflowCanContinue: boolean;
    dataIntegrity: 'intact' | 'compromised' | 'unknown';
  };
}

export interface DebuggingReport {
  workflowId: string;
  workflowName: string;
  generateTime: number;
  executionSummary: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    overallDuration: number;
    overallSuccess: boolean;
  };
  failures: FailureAnalysis[];
  debugInfo: Map<string, DebugInfo>;
  recommendations: string[];
  troubleshootingSteps: string[];
}

/**
 * Comprehensive debugging tools for workflow failures
 */
export class WorkflowDebugger {
  private workflow: WorkflowDefinition;
  private context: WorkflowContext;
  private debugSessions: Map<string, DebugInfo> = new Map();

  constructor(workflow: WorkflowDefinition, context: WorkflowContext) {
    this.workflow = workflow;
    this.context = context;
  }

  /**
   * Capture debug information when a step starts
   */
  captureStepStart(step: WorkflowStep, inputs: Record<string, unknown>): void {
    const debugInfo: DebugInfo = {
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      status: 'running',
      inputs,
      environment: Object.fromEntries(
        Object.entries(process.env).filter(([, value]) => value !== undefined)
      ) as Record<string, string>,
      dependencies: step.dependsOn || [],
      dependents: this.findStepDependents(step.id),
      executionContext: {
        workflowId: this.context.getWorkflowId(),
        variables: { ...this.context.getVariables() },
        startTime: Date.now(),
        retryCount: 0
      },
      systemInfo: {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        processInfo: {
          pid: process.pid,
          platform: process.platform,
          nodeVersion: process.version,
          workingDirectory: process.cwd()
        }
      },
      logs: this.context.getLogs().filter(log => log.stepId === step.id)
    };

    this.debugSessions.set(step.id, debugInfo);
  }

  /**
   * Capture debug information when a step completes
   */
  captureStepComplete(step: WorkflowStep, result: StepResult): void {
    const debugInfo = this.debugSessions.get(step.id);
    if (debugInfo) {
      debugInfo.status = result.success ? 'completed' : 'failed';
      debugInfo.outputs = { output: result.output };
      debugInfo.executionContext.endTime = Date.now();
      debugInfo.executionContext.duration = result.executionTime;
      debugInfo.logs = this.context.getLogs().filter(log => log.stepId === step.id);
      
      if (!result.success && result.error) {
        debugInfo.error = {
          message: result.error,
          code: 'STEP_EXECUTION_ERROR',
          stepId: step.id
        } as WorkflowError;
      }
    }
  }

  /**
   * Capture debug information when a step fails
   */
  captureStepFailure(step: WorkflowStep, error: WorkflowError, duration?: number): void {
    const debugInfo = this.debugSessions.get(step.id) || this.createEmptyDebugInfo(step);
    
    debugInfo.status = 'failed';
    debugInfo.error = error;
    debugInfo.errorStack = error.stack;
    debugInfo.executionContext.endTime = Date.now();
    debugInfo.executionContext.duration = duration;
    debugInfo.systemInfo.memoryUsage = process.memoryUsage();
    debugInfo.logs = this.context.getLogs().filter(log => log.stepId === step.id);

    this.debugSessions.set(step.id, debugInfo);
  }

  /**
   * Capture debug information when a step is retried
   */
  captureStepRetry(step: WorkflowStep, attempt: number, reason: string): void {
    const debugInfo = this.debugSessions.get(step.id);
    if (debugInfo) {
      debugInfo.executionContext.retryCount = attempt;
      debugInfo.logs = this.context.getLogs().filter(log => log.stepId === step.id);
      
      // Add retry information to logs
      this.context.log(`Step retry attempt ${attempt}: ${reason}`, 'warn', step.id);
    }
  }

  /**
   * Analyze step failures and provide detailed diagnosis
   */
  analyzeFailures(
    executionReport: WorkflowExecutionReport,
    metrics?: WorkflowExecutionMetrics
  ): FailureAnalysis[] {
    const analyses: FailureAnalysis[] = [];
    const failedSteps = executionReport.stepStatuses.filter(s => s.status === 'failed');

    for (const stepStatus of failedSteps) {
      const analysis = this.analyzeStepFailure(stepStatus, executionReport, metrics);
      analyses.push(analysis);
    }

    return analyses;
  }

  /**
   * Generate comprehensive debugging report
   */
  generateDebugReport(
    executionReport: WorkflowExecutionReport,
    metrics: WorkflowExecutionMetrics
  ): DebuggingReport {
    const failures = this.analyzeFailures(executionReport, metrics);
    
    const report: DebuggingReport = {
      workflowId: executionReport.workflowId,
      workflowName: executionReport.workflowName,
      generateTime: Date.now(),
      executionSummary: {
        totalSteps: executionReport.totalSteps,
        completedSteps: executionReport.completedSteps,
        failedSteps: executionReport.failedSteps,
        skippedSteps: executionReport.skippedSteps,
        overallDuration: executionReport.duration || 0,
        overallSuccess: executionReport.result?.success || false
      },
      failures,
      debugInfo: new Map(this.debugSessions),
      recommendations: this.generateRecommendations(failures, metrics),
      troubleshootingSteps: this.generateTroubleshootingSteps(failures)
    };

    return report;
  }

  /**
   * Export debug report as formatted text
   */
  exportDebugReport(report: DebuggingReport): string {
    const lines: string[] = [];

    lines.push('WORKFLOW DEBUG REPORT');
    lines.push('===================');
    lines.push(`Workflow: ${report.workflowName} (${report.workflowId})`);
    lines.push(`Generated: ${new Date(report.generateTime).toISOString()}`);
    lines.push('');

    // Execution Summary
    lines.push('EXECUTION SUMMARY');
    lines.push('-----------------');
    const summary = report.executionSummary;
    lines.push(`Total Steps: ${summary.totalSteps}`);
    lines.push(`Completed: ${summary.completedSteps} (${Math.round(summary.completedSteps / summary.totalSteps * 100)}%)`);
    lines.push(`Failed: ${summary.failedSteps}`);
    lines.push(`Skipped: ${summary.skippedSteps}`);
    lines.push(`Duration: ${this.formatDuration(summary.overallDuration)}`);
    lines.push(`Status: ${summary.overallSuccess ? 'SUCCESS' : 'FAILED'}`);
    lines.push('');

    // Failure Analysis
    if (report.failures.length > 0) {
      lines.push('FAILURE ANALYSIS');
      lines.push('----------------');
      
      for (const failure of report.failures) {
        lines.push(`Step: ${failure.stepId} (${failure.failureType.toUpperCase()})`);
        lines.push(`Criticality: ${failure.criticality.toUpperCase()}`);
        lines.push(`Root Cause: ${failure.rootCause}`);
        
        if (failure.impact.affectedSteps.length > 0) {
          lines.push(`Affected Steps: ${failure.impact.affectedSteps.join(', ')}`);
        }
        
        if (failure.possibleSolutions.length > 0) {
          lines.push('Possible Solutions:');
          for (const solution of failure.possibleSolutions) {
            lines.push(`  - ${solution}`);
          }
        }
        
        lines.push('');
      }
    }

    // Debug Information
    lines.push('DEBUG INFORMATION');
    lines.push('-----------------');
    
    for (const [stepId, debugInfo] of report.debugInfo) {
      if (debugInfo.status === 'failed') {
        lines.push(`Step: ${debugInfo.stepName} [${stepId}]`);
        lines.push(`Type: ${debugInfo.stepType}`);
        lines.push(`Status: ${debugInfo.status.toUpperCase()}`);
        
        if (debugInfo.error) {
          lines.push(`Error: ${debugInfo.error.message}`);
          lines.push(`Error Type: ${debugInfo.error.code}`);
        }
        
        if (debugInfo.executionContext.duration) {
          lines.push(`Duration: ${this.formatDuration(debugInfo.executionContext.duration)}`);
        }
        
        lines.push(`Retry Count: ${debugInfo.executionContext.retryCount}`);
        
        if (debugInfo.dependencies.length > 0) {
          lines.push(`Dependencies: ${debugInfo.dependencies.join(', ')}`);
        }
        
        if (debugInfo.logs.length > 0) {
          lines.push('Recent Logs:');
          for (const log of debugInfo.logs.slice(-5)) {
            lines.push(`  [${log.level.toUpperCase()}] ${log.message}`);
          }
        }
        
        lines.push('');
      }
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      lines.push('RECOMMENDATIONS');
      lines.push('---------------');
      for (const recommendation of report.recommendations) {
        lines.push(`• ${recommendation}`);
      }
      lines.push('');
    }

    // Troubleshooting Steps
    if (report.troubleshootingSteps.length > 0) {
      lines.push('TROUBLESHOOTING STEPS');
      lines.push('--------------------');
      for (let i = 0; i < report.troubleshootingSteps.length; i++) {
        lines.push(`${i + 1}. ${report.troubleshootingSteps[i]}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get debug information for a specific step
   */
  getStepDebugInfo(stepId: string): DebugInfo | undefined {
    return this.debugSessions.get(stepId);
  }

  /**
   * Clear debug sessions
   */
  clearDebugSessions(): void {
    this.debugSessions.clear();
  }

  /**
   * Analyze individual step failure
   */
  private analyzeStepFailure(
    stepStatus: StepStatus,
    executionReport: WorkflowExecutionReport,
    metrics?: WorkflowExecutionMetrics
  ): FailureAnalysis {
    const debugInfo = this.debugSessions.get(stepStatus.stepId);
    const step = this.workflow.steps.find(s => s.id === stepStatus.stepId);
    
    let failureType: FailureAnalysis['failureType'] = 'unknown';
    let rootCause = stepStatus.error || 'Unknown error';
    const possibleSolutions: string[] = [];
    
    // Analyze failure type based on error patterns and context
    if (debugInfo?.error) {
      const errorMessage = debugInfo.error.message.toLowerCase();
      
      if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        failureType = 'timeout';
        possibleSolutions.push('Increase step timeout configuration');
        possibleSolutions.push('Optimize step execution for better performance');
      } else if (errorMessage.includes('memory') || errorMessage.includes('heap')) {
        failureType = 'resource_exhaustion';
        possibleSolutions.push('Increase available memory allocation');
        possibleSolutions.push('Optimize memory usage in step implementation');
      } else if (errorMessage.includes('dependency') || errorMessage.includes('depends')) {
        failureType = 'dependency_failure';
        possibleSolutions.push('Check dependent step outputs and status');
        possibleSolutions.push('Review dependency chain configuration');
      } else if (errorMessage.includes('config') || errorMessage.includes('parameter')) {
        failureType = 'configuration_error';
        possibleSolutions.push('Verify step configuration parameters');
        possibleSolutions.push('Check environment variables and inputs');
      } else {
        failureType = 'runtime_error';
        possibleSolutions.push('Review step implementation for bugs');
        possibleSolutions.push('Check input data validity and format');
      }
    }

    // Determine criticality
    const dependents = this.findStepDependents(stepStatus.stepId);
    let criticality: FailureAnalysis['criticality'] = 'medium';
    
    if (dependents.length === 0) {
      criticality = 'low';
    } else if (dependents.length > 3 || this.isInCriticalPath(stepStatus.stepId)) {
      criticality = 'high';
    }
    
    if (step?.continueOnError === false || failureType === 'resource_exhaustion') {
      criticality = 'critical';
    }

    // Find related failures
    const relatedFailures = executionReport.stepStatuses
      .filter(s => s.status === 'failed' && s.stepId !== stepStatus.stepId)
      .filter(s => this.areStepsRelated(stepStatus.stepId, s.stepId))
      .map(s => s.stepId);

    return {
      stepId: stepStatus.stepId,
      failureType,
      rootCause,
      possibleSolutions,
      relatedFailures,
      criticality,
      impact: {
        affectedSteps: dependents,
        workflowCanContinue: step?.continueOnError === true,
        dataIntegrity: this.assessDataIntegrity(stepStatus.stepId, failureType)
      }
    };
  }

  /**
   * Generate recommendations based on failure analysis
   */
  private generateRecommendations(failures: FailureAnalysis[], metrics: WorkflowExecutionMetrics): string[] {
    const recommendations: string[] = [];
    const failureTypes = new Set(failures.map(f => f.failureType));
    
    if (failureTypes.has('timeout')) {
      recommendations.push('Consider implementing progressive timeouts and step chunking for long-running operations');
    }
    
    if (failureTypes.has('resource_exhaustion')) {
      recommendations.push('Monitor and optimize resource usage, consider implementing resource pooling');
    }
    
    if (failureTypes.has('dependency_failure')) {
      recommendations.push('Implement better dependency validation and fallback mechanisms');
    }
    
    if (failures.filter(f => f.criticality === 'critical').length > 0) {
      recommendations.push('Review critical path steps and implement circuit breaker patterns');
    }
    
    if (metrics.retriedSteps > metrics.totalSteps * 0.2) {
      recommendations.push('High retry rate detected - review step reliability and retry strategies');
    }
    
    return recommendations;
  }

  /**
   * Generate troubleshooting steps
   */
  private generateTroubleshootingSteps(failures: FailureAnalysis[]): string[] {
    const steps: string[] = [
      'Review the failure analysis section for specific error details',
      'Check system resources (memory, CPU, disk space) during execution',
      'Verify all required dependencies and environment variables are configured',
      'Examine step logs for detailed error messages and stack traces',
      'Test individual failing steps in isolation to identify root causes'
    ];

    if (failures.some(f => f.failureType === 'configuration_error')) {
      steps.push('Validate workflow configuration against schema and requirements');
    }

    if (failures.some(f => f.failureType === 'dependency_failure')) {
      steps.push('Map and verify the complete dependency chain for failing steps');
    }

    return steps;
  }

  /**
   * Helper methods
   */
  private createEmptyDebugInfo(step: WorkflowStep): DebugInfo {
    return {
      stepId: step.id,
      stepName: step.name,
      stepType: step.type,
      status: 'unknown',
      inputs: {},
      environment: Object.fromEntries(
        Object.entries(process.env).filter(([, value]) => value !== undefined)
      ) as Record<string, string>,
      dependencies: step.dependsOn || [],
      dependents: this.findStepDependents(step.id),
      executionContext: {
        workflowId: this.context.getWorkflowId(),
        variables: { ...this.context.getVariables() },
        startTime: Date.now(),
        retryCount: 0
      },
      systemInfo: {
        memoryUsage: process.memoryUsage(),
        processInfo: {
          pid: process.pid,
          platform: process.platform,
          nodeVersion: process.version,
          workingDirectory: process.cwd()
        }
      },
      logs: []
    };
  }

  private findStepDependents(stepId: string): string[] {
    return this.workflow.steps
      .filter(step => step.dependsOn?.includes(stepId))
      .map(step => step.id);
  }

  private isInCriticalPath(stepId: string): boolean {
    // Simple heuristic: if more than 50% of remaining steps depend on this step
    const dependents = this.findStepDependents(stepId);
    const totalSteps = this.workflow.steps.length;
    return dependents.length > totalSteps * 0.5;
  }

  private areStepsRelated(stepId1: string, stepId2: string): boolean {
    const step1 = this.workflow.steps.find(s => s.id === stepId1);
    const step2 = this.workflow.steps.find(s => s.id === stepId2);
    
    if (!step1 || !step2) return false;
    
    // Steps are related if they share dependencies or one depends on the other
    const step1Deps = step1.dependsOn || [];
    const step2Deps = step2.dependsOn || [];
    
    return step1Deps.includes(stepId2) || 
           step2Deps.includes(stepId1) ||
           step1Deps.some(dep => step2Deps.includes(dep));
  }

  private assessDataIntegrity(stepId: string, failureType: FailureAnalysis['failureType']): 'intact' | 'compromised' | 'unknown' {
    if (failureType === 'configuration_error' || failureType === 'timeout') {
      return 'intact';
    } else if (failureType === 'runtime_error') {
      return 'compromised';
    }
    return 'unknown';
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  }
}

/**
 * Factory function to create workflow debugger
 */
export function createWorkflowDebugger(
  workflow: WorkflowDefinition,
  context: WorkflowContext
): WorkflowDebugger {
  return new WorkflowDebugger(workflow, context);
}