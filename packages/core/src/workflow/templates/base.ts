/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowTemplate } from '../WorkflowTemplate.js';
import { registerTemplate } from './index.js';

const baseWorkflowTemplate: WorkflowTemplate = {
  metadata: {
    id: 'base-workflow',
    name: 'Base Workflow',
    description: 'Base template with common workflow structure',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['base', 'foundation'],
    category: 'foundation'
  },
  parameters: [
    {
      name: 'workflowName',
      type: 'string',
      description: 'Name of the workflow',
      required: true,
      validation: {
        minLength: 1,
        maxLength: 100,
        pattern: '^[a-zA-Z0-9_-]+$'
      }
    },
    {
      name: 'workflowDescription',
      type: 'string',
      description: 'Description of the workflow',
      required: false
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Global workflow timeout in milliseconds',
      required: false,
      default: 300000,
      validation: {
        minimum: 1000,
        maximum: 3600000
      }
    }
  ],
  template: {
    name: '{{parameters.workflowName}}',
    description: '{{parameters.workflowDescription}}',
    timeout: (300000 as any), // Will be replaced by parameter interpolation
    steps: [],
    env: {
      WORKFLOW_NAME: '{{parameters.workflowName}}',
      WORKFLOW_ID: '{{workflow.id}}'
    }
  }
};

const scriptStepTemplate: WorkflowTemplate = {
  metadata: {
    id: 'script-step',
    name: 'Script Step',
    description: 'Template for script execution steps',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['script', 'execution'],
    category: 'execution'
  },
  extends: 'base-workflow',
  parameters: [
    {
      name: 'stepId',
      type: 'string',
      description: 'Unique identifier for the step',
      required: true,
      validation: {
        pattern: '^[a-zA-Z0-9_-]+$'
      }
    },
    {
      name: 'stepName',
      type: 'string',
      description: 'Human-readable name for the step',
      required: true
    },
    {
      name: 'command',
      type: 'string',
      description: 'Command to execute',
      required: true
    },
    {
      name: 'args',
      type: 'array',
      description: 'Command arguments',
      required: false
    },
    {
      name: 'workingDirectory',
      type: 'string',
      description: 'Working directory for command execution',
      required: false
    },
    {
      name: 'stepTimeout',
      type: 'number',
      description: 'Step timeout in milliseconds',
      required: false,
      validation: {
        minimum: 1000
      }
    },
    {
      name: 'continueOnError',
      type: 'boolean',
      description: 'Continue workflow if step fails',
      required: false,
      default: false
    }
  ],
  template: {
    steps: [
      {
        id: '{{parameters.stepId}}',
        name: '{{parameters.stepName}}',
        type: 'script' as const,
        config: {
          command: '{{parameters.command}}',
          args: [] as any, // Will be replaced by parameter interpolation
          workingDirectory: '{{parameters.workingDirectory}}',
          timeout: (60000 as any) // Will be replaced by parameter interpolation
        },
        continueOnError: (false as any) // Will be replaced by parameter interpolation
      }
    ]
  }
};

const agentStepTemplate: WorkflowTemplate = {
  metadata: {
    id: 'agent-step',
    name: 'Agent Step',
    description: 'Template for agent execution steps',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['agent', 'ai'],
    category: 'execution'
  },
  extends: 'base-workflow',
  parameters: [
    {
      name: 'stepId',
      type: 'string',
      description: 'Unique identifier for the step',
      required: true,
      validation: {
        pattern: '^[a-zA-Z0-9_-]+$'
      }
    },
    {
      name: 'stepName',
      type: 'string',
      description: 'Human-readable name for the step',
      required: true
    },
    {
      name: 'agent',
      type: 'string',
      description: 'Agent identifier',
      required: true,
      validation: {
        enum: ['claude', 'gpt-4', 'local-llm']
      }
    },
    {
      name: 'prompt',
      type: 'string',
      description: 'Prompt for the agent',
      required: true
    },
    {
      name: 'parameters',
      type: 'object',
      description: 'Additional parameters for the agent',
      required: false
    },
    {
      name: 'stepTimeout',
      type: 'number',
      description: 'Step timeout in milliseconds',
      required: false,
      validation: {
        minimum: 1000
      }
    }
  ],
  template: {
    steps: [
      {
        id: '{{parameters.stepId}}',
        name: '{{parameters.stepName}}',
        type: 'agent' as const,
        config: {
          agent: '{{parameters.agent}}',
          prompt: '{{parameters.prompt}}',
          parameters: ({} as any), // Will be replaced by parameter interpolation
          timeout: (60000 as any) // Will be replaced by parameter interpolation
        }
      }
    ]
  }
};

// Register templates
registerTemplate(baseWorkflowTemplate);
registerTemplate(scriptStepTemplate);
registerTemplate(agentStepTemplate);