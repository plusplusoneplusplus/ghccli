/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TemplateResolver } from './TemplateResolver.js';
import {
  WorkflowTemplate,
  TemplateInstance,
  TemplateResolutionContext,
  TemplateParameterError
} from './WorkflowTemplate.js';
import { WorkflowDefinition } from './types.js';

describe('TemplateResolver', () => {
  let resolver: TemplateResolver;
  let baseTemplate: WorkflowTemplate;
  let templates: Map<string, WorkflowTemplate>;

  beforeEach(() => {
    resolver = new TemplateResolver();
    
    baseTemplate = {
      metadata: {
        id: 'base-workflow',
        name: 'Base Workflow',
        version: '1.0.0'
      },
      parameters: [
        {
          name: 'workflowName',
          type: 'string',
          required: true,
          validation: {
            minLength: 1,
            maxLength: 100
          }
        },
        {
          name: 'timeout',
          type: 'number',
          required: false,
          default: 300000,
          validation: {
            minimum: 1000
          }
        }
      ],
      template: {
        name: '{{parameters.workflowName}}',
        timeout: (300000 as any), // Template interpolation placeholder
        steps: []
      }
    };

    templates = new Map();
    templates.set('base-workflow', baseTemplate);
  });

  describe('Parameter Validation', () => {
    it('should validate required parameters', () => {
      const result = resolver.validateParameters(baseTemplate, {}, true);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Required parameter missing: workflowName');
    });

    it('should use default values for optional parameters', () => {
      const parameters: Record<string, unknown> = { workflowName: 'Test Workflow' };
      const result = resolver.validateParameters(baseTemplate, parameters, true);
      expect(result.valid).toBe(true);
      expect(parameters.timeout).toBe(300000);
    });

    it('should validate parameter types', () => {
      const parameters = { workflowName: 123, timeout: 'invalid' };
      const result = resolver.validateParameters(baseTemplate, parameters, true);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('invalid type');
    });

    it('should validate string constraints', () => {
      const parameters = { workflowName: '', timeout: 60000 };
      const result = resolver.validateParameters(baseTemplate, parameters, true);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('too short');
    });

    it('should validate number constraints', () => {
      const parameters = { workflowName: 'Test', timeout: 500 };
      const result = resolver.validateParameters(baseTemplate, parameters, true);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('too small');
    });
  });

  describe('Template Resolution', () => {
    it('should resolve simple template', async () => {
      const instance: TemplateInstance = {
        templateId: 'base-workflow',
        parameters: {
          workflowName: 'My Test Workflow',
          timeout: 120000
        }
      };

      const context: TemplateResolutionContext = {
        templates,
        parameters: instance.parameters,
        options: {
          enableParameterInterpolation: false,
          strictParameterValidation: true
        },
        conflicts: []
      };

      const result = await resolver.resolveTemplate(instance, context);
      
      expect(result).toBeDefined();
      expect(result.name).toBe('{{parameters.workflowName}}');
      expect(result.timeout).toBe(300000); // Since parameter interpolation is disabled, uses default
    });

    it('should throw error for missing template', async () => {
      const instance: TemplateInstance = {
        templateId: 'nonexistent-template',
        parameters: {}
      };

      const context: TemplateResolutionContext = {
        templates,
        parameters: instance.parameters,
        options: {},
        conflicts: []
      };

      await expect(resolver.resolveTemplate(instance, context))
        .rejects.toThrow('Template not found: nonexistent-template');
    });

    it('should throw error for invalid parameters', async () => {
      const instance: TemplateInstance = {
        templateId: 'base-workflow',
        parameters: {} // Missing required workflowName
      };

      const context: TemplateResolutionContext = {
        templates,
        parameters: instance.parameters,
        options: { strictParameterValidation: true },
        conflicts: []
      };

      await expect(resolver.resolveTemplate(instance, context))
        .rejects.toThrow(TemplateParameterError);
    });
  });

  describe('Template Inheritance', () => {
    it('should handle single inheritance', async () => {
      const childTemplate: WorkflowTemplate = {
        metadata: {
          id: 'child-workflow',
          name: 'Child Workflow',
          version: '1.0.0'
        },
        extends: 'base-workflow',
        parameters: [
          {
            name: 'additionalParam',
            type: 'string',
            required: false,
            default: 'default-value'
          }
        ],
        template: {
          description: 'Extended workflow',
          steps: [
            {
              id: 'step1',
              name: 'Test Step',
              type: 'script',
              config: {
                command: 'echo',
                args: ['hello']
              }
            }
          ]
        }
      };

      templates.set('child-workflow', childTemplate);

      const instance: TemplateInstance = {
        templateId: 'child-workflow',
        parameters: {
          workflowName: 'Inherited Workflow'
        }
      };

      const context: TemplateResolutionContext = {
        templates,
        parameters: instance.parameters,
        options: { enableParameterInterpolation: false },
        conflicts: []
      };

      const result = await resolver.resolveTemplate(instance, context);
      
      expect(result.name).toBe('Child Workflow'); // Child template metadata name since no template.name is specified
      expect(result.description).toBe('Extended workflow');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].id).toBe('step1');
    });

    it('should detect circular inheritance', async () => {
      const template1: WorkflowTemplate = {
        metadata: { id: 'template1', name: 'Template 1', version: '1.0.0' },
        extends: 'template2',
        parameters: [],
        template: { steps: [] }
      };

      const template2: WorkflowTemplate = {
        metadata: { id: 'template2', name: 'Template 2', version: '1.0.0' },
        extends: 'template1',
        parameters: [],
        template: { steps: [] }
      };

      templates.set('template1', template1);
      templates.set('template2', template2);

      const instance: TemplateInstance = {
        templateId: 'template1',
        parameters: {}
      };

      const context: TemplateResolutionContext = {
        templates,
        parameters: instance.parameters,
        options: {},
        conflicts: []
      };

      await expect(resolver.resolveTemplate(instance, context))
        .rejects.toThrow('Circular inheritance detected');
    });
  });

  describe('Conflict Detection', () => {
    it('should detect environment variable conflicts', async () => {
      const parentTemplate: WorkflowTemplate = {
        metadata: { id: 'parent', name: 'Parent', version: '1.0.0' },
        parameters: [],
        template: {
          steps: [],
          env: { NODE_ENV: 'development' }
        }
      };

      const childTemplate: WorkflowTemplate = {
        metadata: { id: 'child', name: 'Child', version: '1.0.0' },
        extends: 'parent',
        parameters: [],
        template: {
          steps: [],
          env: { NODE_ENV: 'production' }
        }
      };

      templates.set('parent', parentTemplate);
      templates.set('child', childTemplate);

      const instance: TemplateInstance = {
        templateId: 'child',
        parameters: {}
      };

      const context: TemplateResolutionContext = {
        templates,
        parameters: instance.parameters,
        options: {},
        conflicts: []
      };

      const result = await resolver.resolveTemplate(instance, context);
      
      expect(context.conflicts).toHaveLength(1);
      expect(context.conflicts[0].type).toBe('environment');
      expect(context.conflicts[0].path).toBe('env.NODE_ENV');
      expect(result.env?.NODE_ENV).toBe('production'); // Child overrides parent
    });
  });
});