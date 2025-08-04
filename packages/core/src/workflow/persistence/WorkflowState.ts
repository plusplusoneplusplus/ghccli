/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowResult, StepResult } from '../types.js';
import { WorkflowContextSnapshot } from '../WorkflowContext.js';
import { WorkflowStatus } from '../WorkflowRunner.js';

export enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  PARTIAL = 'partial'
}

export interface PersistedStepState {
  stepId: string;
  status: StepStatus;
  result?: StepResult;
  startTime?: Date;
  endTime?: Date;
  attemptCount: number;
  partialData?: Record<string, unknown>;
}

export interface WorkflowStateSnapshot {
  workflowId: string;
  workflowName: string;
  workflowVersion: string;
  status: WorkflowStatus;
  definition: WorkflowDefinition;
  context: WorkflowContextSnapshot;
  stepStates: Record<string, PersistedStepState>;
  executionOrder: string[];
  currentStepIndex: number;
  startTime: Date;
  lastUpdateTime: Date;
  resumeCount: number;
  executionMetadata: {
    originalStartTime: Date;
    totalPausedDuration: number;
    lastResumeTime?: Date;
    resumeReasons: string[];
  };
}

export class WorkflowState {
  private snapshot: WorkflowStateSnapshot;

  constructor(
    workflowId: string,
    definition: WorkflowDefinition,
    contextSnapshot: WorkflowContextSnapshot,
    executionOrder: string[]
  ) {
    this.snapshot = {
      workflowId,
      workflowName: definition.name,
      workflowVersion: definition.version,
      status: WorkflowStatus.PENDING,
      definition,
      context: contextSnapshot,
      stepStates: {},
      executionOrder,
      currentStepIndex: 0,
      startTime: new Date(),
      lastUpdateTime: new Date(),
      resumeCount: 0,
      executionMetadata: {
        originalStartTime: new Date(),
        totalPausedDuration: 0,
        resumeReasons: []
      }
    };

    // Initialize step states
    for (const stepId of executionOrder) {
      this.snapshot.stepStates[stepId] = {
        stepId,
        status: StepStatus.PENDING,
        attemptCount: 0
      };
    }
  }

  /**
   * Create WorkflowState from existing snapshot
   */
  static fromSnapshot(snapshot: WorkflowStateSnapshot): WorkflowState {
    const state = Object.create(WorkflowState.prototype);
    
    // Ensure dates are properly restored as Date objects
    const restoredSnapshot = {
      ...snapshot,
      startTime: snapshot.startTime instanceof Date ? snapshot.startTime : new Date(snapshot.startTime),
      lastUpdateTime: new Date(),
      executionMetadata: {
        ...snapshot.executionMetadata,
        originalStartTime: snapshot.executionMetadata.originalStartTime instanceof Date ? 
          snapshot.executionMetadata.originalStartTime : 
          new Date(snapshot.executionMetadata.originalStartTime),
        lastResumeTime: snapshot.executionMetadata.lastResumeTime ? 
          (snapshot.executionMetadata.lastResumeTime instanceof Date ? 
            snapshot.executionMetadata.lastResumeTime : 
            new Date(snapshot.executionMetadata.lastResumeTime)) : 
          undefined
      },
      context: {
        ...snapshot.context,
        startTime: snapshot.context.startTime instanceof Date ? 
          snapshot.context.startTime : 
          new Date(snapshot.context.startTime),
        snapshotTime: snapshot.context.snapshotTime instanceof Date ? 
          snapshot.context.snapshotTime : 
          new Date(snapshot.context.snapshotTime)
      }
    };
    
    state.snapshot = restoredSnapshot;
    return state;
  }

  /**
   * Get the current workflow state snapshot
   */
  getSnapshot(): WorkflowStateSnapshot {
    return {
      ...this.snapshot,
      lastUpdateTime: new Date()
    };
  }

  /**
   * Update workflow status
   */
  updateWorkflowStatus(status: WorkflowStatus): void {
    this.snapshot.status = status;
    this.snapshot.lastUpdateTime = new Date();
  }

  /**
   * Update step status and result
   */
  updateStepState(
    stepId: string, 
    status: StepStatus, 
    result?: StepResult, 
    partialData?: Record<string, unknown>
  ): void {
    const stepState = this.snapshot.stepStates[stepId];
    if (!stepState) {
      throw new Error(`Step ${stepId} not found in workflow state`);
    }

    const now = new Date();
    
    if (status === StepStatus.RUNNING && stepState.status === StepStatus.PENDING) {
      stepState.startTime = now;
      stepState.attemptCount++;
    }
    
    if (status === StepStatus.COMPLETED || status === StepStatus.FAILED) {
      stepState.endTime = now;
    }

    stepState.status = status;
    stepState.result = result;
    stepState.partialData = partialData;
    this.snapshot.lastUpdateTime = now;
  }

  /**
   * Update context snapshot
   */
  updateContext(contextSnapshot: WorkflowContextSnapshot): void {
    this.snapshot.context = contextSnapshot;
    this.snapshot.lastUpdateTime = new Date();
  }

  /**
   * Advance to next step in execution order
   */
  advanceToNextStep(): void {
    this.snapshot.currentStepIndex++;
    this.snapshot.lastUpdateTime = new Date();
  }

  /**
   * Get current step ID
   */
  getCurrentStepId(): string | null {
    if (this.snapshot.currentStepIndex >= this.snapshot.executionOrder.length) {
      return null;
    }
    return this.snapshot.executionOrder[this.snapshot.currentStepIndex];
  }

  /**
   * Get step state by ID
   */
  getStepState(stepId: string): PersistedStepState | undefined {
    return this.snapshot.stepStates[stepId];
  }

  /**
   * Get all completed steps
   */
  getCompletedSteps(): string[] {
    return Object.entries(this.snapshot.stepStates)
      .filter(([, state]) => state.status === StepStatus.COMPLETED)
      .map(([stepId]) => stepId);
  }

  /**
   * Get all failed steps
   */
  getFailedSteps(): string[] {
    return Object.entries(this.snapshot.stepStates)
      .filter(([, state]) => state.status === StepStatus.FAILED)
      .map(([stepId]) => stepId);
  }

  /**
   * Check if workflow can be resumed
   */
  canResume(): boolean {
    const hasIncompleteSteps = Object.values(this.snapshot.stepStates)
      .some(state => state.status === StepStatus.PENDING || state.status === StepStatus.PARTIAL);
    
    return this.snapshot.status !== WorkflowStatus.COMPLETED && 
           this.snapshot.status !== WorkflowStatus.CANCELLED &&
           hasIncompleteSteps;
  }

  /**
   * Mark workflow as resumed
   */
  markResumed(reason: string): void {
    this.snapshot.resumeCount++;
    this.snapshot.executionMetadata.lastResumeTime = new Date();
    this.snapshot.executionMetadata.resumeReasons.push(reason);
    this.snapshot.lastUpdateTime = new Date();
  }

  /**
   * Calculate total paused duration
   */
  updatePausedDuration(): void {
    if (this.snapshot.executionMetadata.lastResumeTime) {
      const pauseDuration = new Date().getTime() - this.snapshot.lastUpdateTime.getTime();
      this.snapshot.executionMetadata.totalPausedDuration += pauseDuration;
    }
  }

  /**
   * Serialize to JSON string
   */
  serialize(): string {
    return JSON.stringify(this.snapshot, (key, value) => {
      if (value instanceof Date) {
        return { __type: 'Date', value: value.toISOString() };
      }
      return value;
    }, 2);
  }

  /**
   * Deserialize from JSON string
   */
  static deserialize(json: string): WorkflowState {
    const parsed = JSON.parse(json, (key, value) => {
      if (value && typeof value === 'object' && value.__type === 'Date') {
        return new Date(value.value);
      }
      return value;
    });

    return WorkflowState.fromSnapshot(parsed);
  }

  /**
   * Create a compact representation for storage optimization
   */
  getCompactSnapshot(): CompactWorkflowState {
    return {
      id: this.snapshot.workflowId,
      name: this.snapshot.workflowName,
      version: this.snapshot.workflowVersion,
      status: this.snapshot.status,
      progress: this.getProgress(),
      startTime: this.snapshot.startTime,
      lastUpdate: this.snapshot.lastUpdateTime,
      resumeCount: this.snapshot.resumeCount
    };
  }

  /**
   * Calculate workflow progress percentage
   */
  getProgress(): number {
    const totalSteps = Object.keys(this.snapshot.stepStates).length;
    if (totalSteps === 0) return 0;

    const completedSteps = Object.values(this.snapshot.stepStates)
      .filter(state => state.status === StepStatus.COMPLETED).length;

    return Math.round((completedSteps / totalSteps) * 100);
  }

  /**
   * Get execution summary
   */
  getExecutionSummary(): WorkflowExecutionSummary {
    const stepCounts = Object.values(this.snapshot.stepStates).reduce(
      (counts, state) => {
        counts[state.status] = (counts[state.status] || 0) + 1;
        return counts;
      },
      {} as Record<StepStatus, number>
    );

    return {
      workflowId: this.snapshot.workflowId,
      name: this.snapshot.workflowName,
      status: this.snapshot.status,
      progress: this.getProgress(),
      stepCounts,
      startTime: this.snapshot.startTime,
      lastUpdateTime: this.snapshot.lastUpdateTime,
      resumeCount: this.snapshot.resumeCount,
      totalExecutionTime: this.getTotalExecutionTime(),
      canResume: this.canResume()
    };
  }

  /**
   * Get total execution time including paused duration
   */
  private getTotalExecutionTime(): number {
    const endTime = this.snapshot.status === WorkflowStatus.COMPLETED || 
                   this.snapshot.status === WorkflowStatus.FAILED ? 
                   this.snapshot.lastUpdateTime : new Date();
    
    return endTime.getTime() - this.snapshot.executionMetadata.originalStartTime.getTime();
  }
}

export interface CompactWorkflowState {
  id: string;
  name: string;
  version: string;
  status: WorkflowStatus;
  progress: number;
  startTime: Date;
  lastUpdate: Date;
  resumeCount: number;
}

export interface WorkflowExecutionSummary {
  workflowId: string;
  name: string;
  status: WorkflowStatus;
  progress: number;
  stepCounts: Record<StepStatus, number>;
  startTime: Date;
  lastUpdateTime: Date;
  resumeCount: number;
  totalExecutionTime: number;
  canResume: boolean;
}