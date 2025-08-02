/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { validateWorkflowDefinition } from './schema.js';
import { WorkflowDefinition } from './types.js';

describe('WorkflowDefinition Schema Validation', () => {
  const validWorkflow: WorkflowDefinition = {
    name: 'Test Workflow',
    version: '1.0.0',
    description: 'A test workflow',
    steps: [
      {
        id: 'step1',
        name: 'First Step',
        type: 'script',
        config: {
          command: 'echo',
          args: ['Hello World'],
        },
      },
      {
        id: 'step2',
        name: 'Second Step',
        type: 'agent',
        config: {
          agent: 'test-agent',
          prompt: 'Do something',
        },
        dependsOn: ['step1'],
      },
    ],
  };

  describe('Valid workflows', () => {
    it('should validate a basic workflow', () => {
      const result = validateWorkflowDefinition(validWorkflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate workflow with minimal required fields', () => {
      const minimalWorkflow: WorkflowDefinition = {
        name: 'Minimal',
        version: '1.0.0',
        steps: [
          {
            id: 'step1',
            name: 'Only Step',
            type: 'script',
            config: {
              command: 'ls',
            },
          },
        ],
      };

      const result = validateWorkflowDefinition(minimalWorkflow);
      expect(result.valid).toBe(true);
    });

    it('should validate workflow with all optional fields', () => {
      const fullWorkflow: WorkflowDefinition = {
        name: 'Full Workflow',
        version: '2.1.0',
        description: 'Complete workflow example',
        timeout: 3600,
        env: {
          NODE_ENV: 'production',
          DEBUG: 'true',
        },
        metadata: {
          author: 'test',
          tags: ['ci', 'cd'],
        },
        steps: [
          {
            id: 'build',
            name: 'Build Project',
            type: 'script',
            config: {
              command: 'npm',
              args: ['run', 'build'],
              workingDirectory: '/app',
              env: {
                NODE_ENV: 'production',
              },
              timeout: 300,
            },
            continueOnError: false,
          },
          {
            id: 'test',
            name: 'Run Tests',
            type: 'agent',
            config: {
              agent: 'test-runner',
              prompt: 'Run all tests',
              parameters: {
                coverage: true,
                parallel: 4,
              },
              timeout: 600,
            },
            dependsOn: ['build'],
            condition: 'success(build)',
            continueOnError: true,
          },
        ],
      };

      const result = validateWorkflowDefinition(fullWorkflow);
      expect(result.valid).toBe(true);
    });
  });

  describe('Invalid workflows - Schema violations', () => {
    it('should reject workflow without name', () => {
      const invalid = { ...validWorkflow };
      delete (invalid as any).name;

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("root: must have required property 'name'");
    });

    it('should reject workflow without version', () => {
      const invalid = { ...validWorkflow };
      delete (invalid as any).version;

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("root: must have required property 'version'");
    });

    it('should reject workflow with invalid version format', () => {
      const invalid = { ...validWorkflow, version: 'invalid' };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('must match pattern');
    });

    it('should reject workflow without steps', () => {
      const invalid = { ...validWorkflow };
      delete (invalid as any).steps;

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("root: must have required property 'steps'");
    });

    it('should reject workflow with empty steps array', () => {
      const invalid = { ...validWorkflow, steps: [] };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('must NOT have fewer than 1 items');
    });

    it('should reject step without required fields', () => {
      const invalid = {
        ...validWorkflow,
        steps: [
          {
            name: 'Incomplete Step',
            type: 'script',
          },
        ],
      };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors?.some(e => e.includes("must have required property 'id'"))).toBe(true);
      expect(result.errors?.some(e => e.includes("must have required property 'config'"))).toBe(true);
    });

    it('should reject step with invalid ID format', () => {
      const invalid = {
        ...validWorkflow,
        steps: [
          {
            id: 'invalid id with spaces',
            name: 'Invalid Step',
            type: 'script',
            config: {
              command: 'echo',
            },
          },
        ],
      };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('must match pattern');
    });

    it('should reject script config without command', () => {
      const invalid = {
        ...validWorkflow,
        steps: [
          {
            id: 'step1',
            name: 'Invalid Script',
            type: 'script',
            config: {
              args: ['test'],
            },
          },
        ],
      };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors?.some(e => e.includes("must have required property 'command'"))).toBe(true);
    });

    it('should reject agent config without agent', () => {
      const invalid = {
        ...validWorkflow,
        steps: [
          {
            id: 'step1',
            name: 'Invalid Agent',
            type: 'agent',
            config: {
              prompt: 'test',
            },
          },
        ],
      };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors?.some(e => e.includes("must have required property 'agent'"))).toBe(true);
    });

    it('should reject negative timeout values', () => {
      const invalid = {
        ...validWorkflow,
        timeout: -100,
      };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('must be >= 0');
    });
  });

  describe('Invalid workflows - Semantic violations', () => {
    it('should reject workflow with duplicate step IDs', () => {
      const invalid = {
        ...validWorkflow,
        steps: [
          {
            id: 'duplicate',
            name: 'First',
            type: 'script',
            config: { command: 'echo' },
          },
          {
            id: 'duplicate',
            name: 'Second',
            type: 'script',
            config: { command: 'ls' },
          },
        ],
      };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duplicate step ID: duplicate');
    });

    it('should reject workflow with invalid dependency references', () => {
      const invalid = {
        ...validWorkflow,
        steps: [
          {
            id: 'step1',
            name: 'First Step',
            type: 'script',
            config: { command: 'echo' },
            dependsOn: ['nonexistent'],
          },
        ],
      };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Step "step1" depends on non-existent step: nonexistent');
    });

    it('should reject workflow with self-dependency', () => {
      const invalid = {
        ...validWorkflow,
        steps: [
          {
            id: 'step1',
            name: 'Self-dependent Step',
            type: 'script',
            config: { command: 'echo' },
            dependsOn: ['step1'],
          },
        ],
      };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Step "step1" cannot depend on itself');
    });

    it('should reject workflow with circular dependencies', () => {
      const invalid = {
        ...validWorkflow,
        steps: [
          {
            id: 'step1',
            name: 'First Step',
            type: 'script',
            config: { command: 'echo' },
            dependsOn: ['step2'],
          },
          {
            id: 'step2',
            name: 'Second Step',
            type: 'script',
            config: { command: 'ls' },
            dependsOn: ['step1'],
          },
        ],
      };

      const result = validateWorkflowDefinition(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Circular dependency detected in workflow steps');
    });
  });

  describe('Edge cases', () => {
    it('should handle null input', () => {
      const result = validateWorkflowDefinition(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should handle undefined input', () => {
      const result = validateWorkflowDefinition(undefined);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should handle non-object input', () => {
      const result = validateWorkflowDefinition('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should handle empty object', () => {
      const result = validateWorkflowDefinition({});
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });
});