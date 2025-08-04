/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowTemplate } from '../WorkflowTemplate.js';
import { registerTemplate } from './index.js';

const testTemplate: WorkflowTemplate = {
  metadata: {
    id: 'test-workflow',
    name: 'Test Workflow',
    description: 'Template for running tests',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['test', 'quality'],
    category: 'testing'
  },
  extends: 'base-workflow',
  parameters: [
    {
      name: 'testCommand',
      type: 'string',
      description: 'Test command to execute',
      required: false,
      default: 'npm test'
    },
    {
      name: 'testPattern',
      type: 'string',
      description: 'Test file pattern',
      required: false
    },
    {
      name: 'coverage',
      type: 'boolean',
      description: 'Generate code coverage',
      required: false,
      default: false
    },
    {
      name: 'coverageThreshold',
      type: 'number',
      description: 'Minimum coverage percentage',
      required: false,
      default: 80,
      validation: {
        minimum: 0,
        maximum: 100
      }
    }
  ],
  template: {
    steps: [
      {
        id: 'run-tests',
        name: 'Run Tests',
        type: 'script',
        config: {
          command: '{{parameters.testCommand}}',
          env: {
            'TEST_PATTERN': '{{parameters.testPattern}}'
          }
        }
      },
      {
        id: 'coverage-check',
        name: 'Check Coverage',
        type: 'script',
        config: {
          command: 'npm',
          args: ['run', 'coverage:check']
        },
        dependsOn: ['run-tests'],
        condition: '{{parameters.coverage}}'
      }
    ]
  }
};

const e2eTestTemplate: WorkflowTemplate = {
  metadata: {
    id: 'e2e-test-workflow',
    name: 'E2E Test Workflow',
    description: 'Template for end-to-end testing',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['e2e', 'testing', 'integration'],
    category: 'testing'
  },
  extends: 'base-workflow',
  parameters: [
    {
      name: 'browser',
      type: 'string',
      description: 'Browser to use for testing',
      required: false,
      default: 'chromium',
      validation: {
        enum: ['chromium', 'firefox', 'webkit']
      }
    },
    {
      name: 'baseUrl',
      type: 'string',
      description: 'Base URL for testing',
      required: false,
      default: 'http://localhost:3000'
    },
    {
      name: 'headless',
      type: 'boolean',
      description: 'Run in headless mode',
      required: false,
      default: true
    },
    {
      name: 'startServer',
      type: 'boolean',
      description: 'Start development server before tests',
      required: false,
      default: true
    },
    {
      name: 'serverCommand',
      type: 'string',
      description: 'Command to start server',
      required: false,
      default: 'npm start'
    }
  ],
  template: {
    env: {
      BROWSER: '{{parameters.browser}}',
      BASE_URL: '{{parameters.baseUrl}}',
      HEADLESS: '{{parameters.headless}}'
    },
    steps: [
      {
        id: 'start-server',
        name: 'Start Development Server',
        type: 'script',
        config: {
          command: '{{parameters.serverCommand}}'
        },
        condition: '{{parameters.startServer}}'
      },
      {
        id: 'wait-server',
        name: 'Wait for Server',
        type: 'script',
        config: {
          command: 'npx',
          args: ['wait-on', '{{parameters.baseUrl}}']
        },
        dependsOn: ['start-server'],
        condition: '{{parameters.startServer}}'
      },
      {
        id: 'run-e2e-tests',
        name: 'Run E2E Tests',
        type: 'script',
        config: {
          command: 'npx',
          args: ['playwright', 'test']
        },
        dependsOn: ['wait-server']
      }
    ]
  }
};

const performanceTestTemplate: WorkflowTemplate = {
  metadata: {
    id: 'performance-test-workflow',
    name: 'Performance Test Workflow',
    description: 'Template for performance testing',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['performance', 'testing', 'benchmark'],
    category: 'testing'
  },
  extends: 'base-workflow',
  parameters: [
    {
      name: 'targetUrl',
      type: 'string',
      description: 'URL to test',
      required: true
    },
    {
      name: 'duration',
      type: 'number',
      description: 'Test duration in seconds',
      required: false,
      default: 60,
      validation: {
        minimum: 1,
        maximum: 3600
      }
    },
    {
      name: 'users',
      type: 'number',
      description: 'Number of virtual users',
      required: false,
      default: 10,
      validation: {
        minimum: 1,
        maximum: 1000
      }
    },
    {
      name: 'rampUpTime',
      type: 'number',
      description: 'Ramp-up time in seconds',
      required: false,
      default: 10
    }
  ],
  template: {
    steps: [
      {
        id: 'performance-test',
        name: 'Run Performance Test',
        type: 'script',
        config: {
          command: 'k6',
          args: [
            'run',
            '--duration={{parameters.duration}}s',
            '--vus={{parameters.users}}',
            '--ramp-up-time={{parameters.rampUpTime}}s',
            'performance-test.js'
          ],
          env: {
            'TARGET_URL': '{{parameters.targetUrl}}'
          }
        }
      },
      {
        id: 'analyze-results',
        name: 'Analyze Performance Results',
        type: 'agent',
        config: {
          agent: 'claude',
          prompt: 'Analyze the performance test results and provide insights on bottlenecks and optimization opportunities.',
          parameters: {
            results: '{{steps.performance-test.output}}'
          }
        },
        dependsOn: ['performance-test']
      }
    ]
  }
};

// Register templates
registerTemplate(testTemplate);
registerTemplate(e2eTestTemplate);
registerTemplate(performanceTestTemplate);