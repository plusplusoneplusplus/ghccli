/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import AjvPkg from 'ajv';
import { WorkflowDefinition, WorkflowStep, ScriptConfig, AgentConfig } from './types.js';

const AjvClass = (AjvPkg as any).default || AjvPkg;
const ajv = new AjvClass({ allErrors: true, verbose: true, allowUnionTypes: true });

const scriptConfigSchema = {
  type: 'object',
  properties: {
    command: { type: 'string' },
    args: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
    },
    workingDirectory: { type: 'string', nullable: true },
    env: {
      type: 'object',
      patternProperties: {
        '.*': { type: 'string' },
      },
      additionalProperties: false,
      nullable: true,
      required: [],
    },
    timeout: { type: 'number', minimum: 0, nullable: true },
  },
  required: ['command'],
  additionalProperties: false,
} as const;

const agentConfigSchema = {
  type: 'object',
  properties: {
    agent: { type: 'string' },
    prompt: { type: 'string', nullable: true },
    parameters: {
      type: 'object',
      patternProperties: {
        '.*': { type: ['string', 'number', 'boolean', 'object', 'array'] },
      },
      additionalProperties: true,
      nullable: true,
      required: [],
    },
    timeout: { type: 'number', minimum: 0, nullable: true },
  },
  required: ['agent'],
  additionalProperties: false,
} as const;

const workflowStepSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' },
    name: { type: 'string' },
    type: { type: 'string', enum: ['script', 'agent'] },
    config: {
      oneOf: [scriptConfigSchema, agentConfigSchema],
    },
    dependsOn: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
    },
    condition: { type: 'string', nullable: true },
    continueOnError: { type: 'boolean', nullable: true },
  },
  required: ['id', 'name', 'type', 'config'],
  additionalProperties: false,
} as const;

const workflowDefinitionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    steps: {
      type: 'array',
      items: workflowStepSchema,
      minItems: 1,
    },
    timeout: { type: 'number', minimum: 0, nullable: true },
    env: {
      type: 'object',
      patternProperties: {
        '.*': { type: 'string' },
      },
      additionalProperties: false,
      nullable: true,
      required: [],
    },
    metadata: {
      type: 'object',
      patternProperties: {
        '.*': { type: ['string', 'number', 'boolean', 'object', 'array'] },
      },
      additionalProperties: true,
      nullable: true,
      required: [],
    },
  },
  required: ['name', 'version', 'steps'],
  additionalProperties: false,
} as const;

const validateWorkflow = ajv.compile(workflowDefinitionSchema);

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateWorkflowDefinition(workflow: unknown): ValidationResult {
  const valid = validateWorkflow(workflow);
  
  if (valid) {
    // Additional semantic validation
    const semanticErrors = validateSemantics(workflow as WorkflowDefinition);
    if (semanticErrors.length > 0) {
      return {
        valid: false,
        errors: semanticErrors,
      };
    }
    return { valid: true };
  }

  const errors = validateWorkflow.errors?.map((error: any) => {
    const instancePath = error.instancePath || 'root';
    return `${instancePath}: ${error.message}`;
  }) || ['Unknown validation error'];

  return {
    valid: false,
    errors,
  };
}

function validateSemantics(workflow: WorkflowDefinition): string[] {
  const errors: string[] = [];
  const stepIds = new Set<string>();
  
  // Check for unique step IDs
  for (const step of workflow.steps) {
    if (stepIds.has(step.id)) {
      errors.push(`Duplicate step ID: ${step.id}`);
    }
    stepIds.add(step.id);
  }
  
  // Check dependencies reference valid step IDs
  for (const step of workflow.steps) {
    if (step.dependsOn) {
      for (const depId of step.dependsOn) {
        if (!stepIds.has(depId)) {
          errors.push(`Step "${step.id}" depends on non-existent step: ${depId}`);
        }
        if (depId === step.id) {
          errors.push(`Step "${step.id}" cannot depend on itself`);
        }
      }
    }
  }
  
  // Check for circular dependencies (basic check)
  const hasCycles = detectCycles(workflow.steps);
  if (hasCycles) {
    errors.push('Circular dependency detected in workflow steps');
  }
  
  return errors;
}

function detectCycles(steps: WorkflowStep[]): boolean {
  const graph = new Map<string, string[]>();
  
  // Build dependency graph
  for (const step of steps) {
    graph.set(step.id, step.dependsOn || []);
  }
  
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  
  function hasCycleDFS(nodeId: string): boolean {
    if (recursionStack.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    
    visited.add(nodeId);
    recursionStack.add(nodeId);
    
    const dependencies = graph.get(nodeId) || [];
    for (const depId of dependencies) {
      if (hasCycleDFS(depId)) {
        return true;
      }
    }
    
    recursionStack.delete(nodeId);
    return false;
  }
  
  for (const stepId of graph.keys()) {
    if (!visited.has(stepId)) {
      if (hasCycleDFS(stepId)) {
        return true;
      }
    }
  }
  
  return false;
}

export { workflowDefinitionSchema };