/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  WorkflowTemplate,
  TemplateInstance,
  WorkflowTemplateError,
  TemplateParameterError,
  TemplateInheritanceError
} from './WorkflowTemplate.js';

describe('WorkflowTemplate', () => {
  const baseTemplate: WorkflowTemplate = {
    metadata: {
      id: 'test-template',
      name: 'Test Template',
      version: '1.0.0'
    },
    parameters: [
      {
        name: 'workflowName',
        type: 'string',
        required: true
      },
      {
        name: 'timeout',
        type: 'number',
        required: false,
        default: 300000
      }
    ],
    template: {
      name: '{{parameters.workflowName}}',
      timeout: (300000 as any), // Template interpolation placeholder
      steps: []
    }
  };

  describe('Template Structure', () => {
    it('should have required metadata properties', () => {
      expect(baseTemplate.metadata.id).toBe('test-template');
      expect(baseTemplate.metadata.name).toBe('Test Template');
      expect(baseTemplate.metadata.version).toBe('1.0.0');
    });

    it('should have parameters array', () => {
      expect(Array.isArray(baseTemplate.parameters)).toBe(true);
      expect(baseTemplate.parameters).toHaveLength(2);
    });

    it('should have template definition', () => {
      expect(baseTemplate.template).toBeDefined();
      expect(baseTemplate.template.steps).toBeDefined();
    });
  });

  describe('Template Parameter Types', () => {
    it('should support string parameters', () => {
      const stringParam = baseTemplate.parameters.find(p => p.name === 'workflowName');
      expect(stringParam?.type).toBe('string');
      expect(stringParam?.required).toBe(true);
    });

    it('should support number parameters with defaults', () => {
      const numberParam = baseTemplate.parameters.find(p => p.name === 'timeout');
      expect(numberParam?.type).toBe('number');
      expect(numberParam?.required).toBe(false);
      expect(numberParam?.default).toBe(300000);
    });
  });

  describe('Template Instance', () => {
    it('should create valid template instance', () => {
      const instance: TemplateInstance = {
        templateId: 'test-template',
        parameters: {
          workflowName: 'My Workflow',
          timeout: 60000
        }
      };

      expect(instance.templateId).toBe('test-template');
      expect(instance.parameters.workflowName).toBe('My Workflow');
      expect(instance.parameters.timeout).toBe(60000);
    });

    it('should support name override', () => {
      const instance: TemplateInstance = {
        templateId: 'test-template',
        parameters: { workflowName: 'Test' },
        name: 'Custom Name'
      };

      expect(instance.name).toBe('Custom Name');
    });
  });

  describe('Error Classes', () => {
    it('should create WorkflowTemplateError', () => {
      const error = new WorkflowTemplateError('Test error', 'test-template');
      expect(error.message).toBe('Test error');
      expect(error.templateId).toBe('test-template');
      expect(error.name).toBe('WorkflowTemplateError');
    });

    it('should create TemplateParameterError', () => {
      const error = new TemplateParameterError('Parameter error', 'paramName', 'test-template');
      expect(error.message).toBe('Parameter error');
      expect(error.parameterName).toBe('paramName');
      expect(error.templateId).toBe('test-template');
      expect(error.name).toBe('TemplateParameterError');
    });

    it('should create TemplateInheritanceError', () => {
      const chain = ['parent', 'child'];
      const error = new TemplateInheritanceError('Inheritance error', chain, 'test-template');
      expect(error.message).toBe('Inheritance error');
      expect(error.inheritanceChain).toEqual(chain);
      expect(error.templateId).toBe('test-template');
      expect(error.name).toBe('TemplateInheritanceError');
    });
  });
});