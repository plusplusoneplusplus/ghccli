/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowResult } from './types.js';
import { WorkflowStatus } from './WorkflowRunner.js';
import { WorkflowContext, LogEntry } from './WorkflowContext.js';

export interface StepStatus {
  stepId: string;
  stepName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  error?: string;
  output?: unknown;
}

export interface WorkflowExecutionReport {
  workflowId: string;
  workflowName: string;
  status: WorkflowStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  stepStatuses: StepStatus[];
  logs: LogEntry[];
  result?: WorkflowResult;
  error?: string;
}

/**
 * Tracks and reports workflow execution status
 */
export class WorkflowStatusReporter {
  private stepStatuses: Map<string, StepStatus> = new Map();
  private workflowStartTime: Date = new Date();
  private workflowEndTime: Date | undefined;
  private currentStatus: WorkflowStatus = WorkflowStatus.PENDING;
  private context: WorkflowContext | null = null;

  /**
   * Initialize reporter with workflow definition
   */
  initialize(workflow: WorkflowDefinition, context: WorkflowContext): void {
    this.context = context;
    this.workflowStartTime = new Date();
    this.currentStatus = WorkflowStatus.PENDING;
    this.stepStatuses.clear();

    // Initialize step statuses
    for (const step of workflow.steps) {
      this.stepStatuses.set(step.id, {
        stepId: step.id,
        stepName: step.name,
        status: 'pending'
      });
    }
  }

  /**
   * Update workflow status
   */
  updateWorkflowStatus(status: WorkflowStatus): void {
    this.currentStatus = status;
    
    if (status === WorkflowStatus.COMPLETED || 
        status === WorkflowStatus.FAILED || 
        status === WorkflowStatus.CANCELLED) {
      this.workflowEndTime = new Date();
    }
  }

  /**
   * Mark a step as started
   */
  markStepStarted(stepId: string): void {
    const stepStatus = this.stepStatuses.get(stepId);
    if (stepStatus) {
      stepStatus.status = 'running';
      stepStatus.startTime = new Date();
      this.stepStatuses.set(stepId, stepStatus);
    }
  }

  /**
   * Mark a step as completed
   */
  markStepCompleted(stepId: string, output?: unknown): void {
    const stepStatus = this.stepStatuses.get(stepId);
    if (stepStatus) {
      stepStatus.status = 'completed';
      stepStatus.endTime = new Date();
      stepStatus.output = output;
      
      if (stepStatus.startTime) {
        stepStatus.duration = stepStatus.endTime.getTime() - stepStatus.startTime.getTime();
      }
      
      this.stepStatuses.set(stepId, stepStatus);
    }
  }

  /**
   * Mark a step as failed
   */
  markStepFailed(stepId: string, error: string): void {
    const stepStatus = this.stepStatuses.get(stepId);
    if (stepStatus) {
      stepStatus.status = 'failed';
      stepStatus.endTime = new Date();
      stepStatus.error = error;
      
      if (stepStatus.startTime) {
        stepStatus.duration = stepStatus.endTime.getTime() - stepStatus.startTime.getTime();
      }
      
      this.stepStatuses.set(stepId, stepStatus);
    }
  }

  /**
   * Mark a step as skipped
   */
  markStepSkipped(stepId: string, reason?: string): void {
    const stepStatus = this.stepStatuses.get(stepId);
    if (stepStatus) {
      stepStatus.status = 'skipped';
      stepStatus.error = reason;
      this.stepStatuses.set(stepId, stepStatus);
    }
  }

  /**
   * Get current execution report
   */
  getExecutionReport(workflow: WorkflowDefinition, result?: WorkflowResult): WorkflowExecutionReport {
    const stepStatuses = Array.from(this.stepStatuses.values());
    const completedSteps = stepStatuses.filter(s => s.status === 'completed').length;
    const failedSteps = stepStatuses.filter(s => s.status === 'failed').length;
    const skippedSteps = stepStatuses.filter(s => s.status === 'skipped').length;

    return {
      workflowId: this.context?.getWorkflowId() || 'unknown',
      workflowName: workflow.name,
      status: this.currentStatus,
      startTime: this.workflowStartTime,
      endTime: this.workflowEndTime,
      duration: this.workflowEndTime ? 
        this.workflowEndTime.getTime() - this.workflowStartTime.getTime() : 
        Date.now() - this.workflowStartTime.getTime(),
      totalSteps: workflow.steps.length,
      completedSteps,
      failedSteps,
      skippedSteps,
      stepStatuses,
      logs: this.context?.getLogs() || [],
      result,
      error: result?.error
    };
  }

  /**
   * Get step status
   */
  getStepStatus(stepId: string): StepStatus | undefined {
    return this.stepStatuses.get(stepId);
  }

  /**
   * Get all step statuses
   */
  getAllStepStatuses(): StepStatus[] {
    return Array.from(this.stepStatuses.values());
  }

  /**
   * Get execution progress as percentage
   */
  getProgress(): number {
    const totalSteps = this.stepStatuses.size;
    if (totalSteps === 0) return 0;

    const completedSteps = Array.from(this.stepStatuses.values())
      .filter(s => s.status === 'completed' || s.status === 'failed' || s.status === 'skipped')
      .length;

    return Math.round((completedSteps / totalSteps) * 100);
  }

  /**
   * Generate a summary report as a formatted string
   */
  generateSummaryReport(workflow: WorkflowDefinition, result?: WorkflowResult): string {
    const report = this.getExecutionReport(workflow, result);
    const lines: string[] = [];

    lines.push(`Workflow Execution Report`);
    lines.push(`========================`);
    lines.push(`Workflow: ${report.workflowName}`);
    lines.push(`Status: ${report.status.toUpperCase()}`);
    lines.push(`Duration: ${this.formatDuration(report.duration || 0)}`);
    lines.push(`Progress: ${this.getProgress()}% (${report.completedSteps}/${report.totalSteps} steps)`);

    if (report.failedSteps > 0) {
      lines.push(`Failed Steps: ${report.failedSteps}`);
    }

    if (report.skippedSteps > 0) {
      lines.push(`Skipped Steps: ${report.skippedSteps}`);
    }

    lines.push('');
    lines.push('Step Details:');
    lines.push('-------------');

    for (const stepStatus of report.stepStatuses) {
      const statusIcon = this.getStatusIcon(stepStatus.status);
      const duration = stepStatus.duration ? ` (${this.formatDuration(stepStatus.duration)})` : '';
      lines.push(`${statusIcon} ${stepStatus.stepName} [${stepStatus.stepId}]${duration}`);
      
      if (stepStatus.error) {
        lines.push(`   Error: ${stepStatus.error}`);
      }
    }

    if (report.error) {
      lines.push('');
      lines.push(`Workflow Error: ${report.error}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate a detailed JSON report
   */
  generateDetailedReport(workflow: WorkflowDefinition, result?: WorkflowResult): string {
    const report = this.getExecutionReport(workflow, result);
    return JSON.stringify(report, null, 2);
  }

  /**
   * Get status icon for display
   */
  private getStatusIcon(status: StepStatus['status']): string {
    switch (status) {
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'running': return '🔄';
      case 'skipped': return '⏭️';
      case 'pending': return '⏳';
      default: return '❓';
    }
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    return remainingMinutes > 0 ? 
      `${hours}h ${remainingMinutes}m` : 
      `${hours}h`;
  }
}