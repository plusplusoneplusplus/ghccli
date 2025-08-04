/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ScriptConfig {
  command: string;
  args?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface AgentConfig {
  agent: string;
  prompt?: string;
  parameters?: Record<string, unknown>;
  timeout?: number;
}

export interface ConditionOperator {
  type: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_exists' | 'greater_than' | 'less_than' | 'greater_than_or_equal' | 'less_than_or_equal' | 'matches' | 'not_matches';
  left: string;
  right?: unknown;
}

export interface BooleanExpression {
  type: 'and' | 'or' | 'not';
  conditions: (ConditionOperator | BooleanExpression)[];
}

export interface ConditionConfig {
  expression: ConditionOperator | BooleanExpression;
  onTrue?: string[];
  onFalse?: string[];
  continueOnError?: boolean;
  timeout?: number;
}

export type WorkflowStepConfig = ScriptConfig | AgentConfig | ConditionConfig;

export interface ParallelConfig {
  enabled: boolean;
  maxConcurrency?: number;
  resource?: string;
  isolateErrors?: boolean;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: string;
  config: WorkflowStepConfig;
  dependsOn?: string[];
  condition?: string;
  continueOnError?: boolean;
  parallel?: ParallelConfig;
}

export interface WorkflowParallelConfig {
  enabled: boolean;
  defaultMaxConcurrency?: number;
  resources?: Record<string, number>;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  version: string;
  steps: WorkflowStep[];
  timeout?: number;
  env?: Record<string, string>;
  metadata?: Record<string, unknown>;
  parallel?: WorkflowParallelConfig;
}

export interface WorkflowExecutionContext {
  workflowId: string;
  stepId: string;
  variables: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
  executionTime?: number;
  parallelGroup?: number;
}

export interface WorkflowResult {
  success: boolean;
  stepResults: Record<string, StepResult>;
  executionTime: number;
  error?: string;
  parallelStats?: {
    totalGroups: number;
    maxConcurrentSteps: number;
    resourceUtilization?: Record<string, number>;
  };
}