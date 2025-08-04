/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowTemplate } from '../WorkflowTemplate.js';

/**
 * Built-in workflow templates
 */
export const BUILTIN_TEMPLATES = new Map<string, WorkflowTemplate>();

/**
 * Register a built-in template
 */
export function registerTemplate(template: WorkflowTemplate): void {
  BUILTIN_TEMPLATES.set(template.metadata.id, template);
}

// Import templates after BUILTIN_TEMPLATES is initialized
import './base.js';
import './ci-cd.js';
import './testing.js';
import './deployment.js';

/**
 * Get all built-in templates
 */
export function getBuiltinTemplates(): WorkflowTemplate[] {
  return Array.from(BUILTIN_TEMPLATES.values());
}

/**
 * Get a built-in template by ID
 */
export function getBuiltinTemplate(id: string): WorkflowTemplate | undefined {
  return BUILTIN_TEMPLATES.get(id);
}