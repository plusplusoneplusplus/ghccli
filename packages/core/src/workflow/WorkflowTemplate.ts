/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowStep } from './types.js';

export interface TemplateParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: unknown;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    enum?: unknown[];
  };
}

export interface TemplateMetadata {
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  tags?: string[];
  category?: string;
  compatibility?: {
    minVersion?: string;
    maxVersion?: string;
  };
}

export interface WorkflowTemplate {
  metadata: TemplateMetadata;
  parameters: TemplateParameter[];
  extends?: string | string[];
  template: Omit<WorkflowDefinition, 'name' | 'version'> & {
    name?: string;
    version?: string;
  };
  overrides?: {
    steps?: Partial<WorkflowStep>[];
  };
}

export interface TemplateInstance {
  templateId: string;
  parameters: Record<string, unknown>;
  name?: string;
  overrides?: {
    metadata?: Partial<TemplateMetadata>;
    steps?: Partial<WorkflowStep>[];
    env?: Record<string, string>;
  };
}

export interface TemplateInheritanceChain {
  base: WorkflowTemplate;
  extensions: WorkflowTemplate[];
  resolved: WorkflowDefinition;
}

export interface TemplateResolutionOptions {
  strictParameterValidation?: boolean;
  allowMissingParameters?: boolean;
  enableParameterInterpolation?: boolean;
  maxInheritanceDepth?: number;
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  inheritanceChain?: TemplateInheritanceChain;
}

export interface TemplateConflict {
  type: 'parameter' | 'step' | 'metadata' | 'environment';
  path: string;
  baseValue: unknown;
  extensionValue: unknown;
  resolution: 'override' | 'merge' | 'error';
}

export interface TemplateResolutionContext {
  templates: Map<string, WorkflowTemplate>;
  parameters: Record<string, unknown>;
  options: TemplateResolutionOptions;
  conflicts: TemplateConflict[];
}

export class WorkflowTemplateError extends Error {
  constructor(
    message: string,
    public readonly templateId?: string,
    public readonly path?: string,
    public readonly conflicts?: TemplateConflict[]
  ) {
    super(message);
    this.name = 'WorkflowTemplateError';
  }
}

export class TemplateParameterError extends WorkflowTemplateError {
  constructor(
    message: string,
    public readonly parameterName: string,
    templateId?: string
  ) {
    super(message, templateId);
    this.name = 'TemplateParameterError';
  }
}

export class TemplateInheritanceError extends WorkflowTemplateError {
  constructor(
    message: string,
    public readonly inheritanceChain: string[],
    templateId?: string
  ) {
    super(message, templateId);
    this.name = 'TemplateInheritanceError';
  }
}