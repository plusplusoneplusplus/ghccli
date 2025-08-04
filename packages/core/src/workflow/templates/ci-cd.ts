/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowTemplate } from '../WorkflowTemplate.js';
import { registerTemplate } from './index.js';

const buildTemplate: WorkflowTemplate = {
  metadata: {
    id: 'build-workflow',
    name: 'Build Workflow',
    description: 'Template for building projects',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['build', 'ci-cd'],
    category: 'ci-cd'
  },
  extends: 'base-workflow',
  parameters: [
    {
      name: 'buildCommand',
      type: 'string',
      description: 'Build command to execute',
      required: false,
      default: 'npm run build'
    },
    {
      name: 'installCommand',
      type: 'string',
      description: 'Dependency installation command',
      required: false,
      default: 'npm ci'
    },
    {
      name: 'buildDirectory',
      type: 'string',
      description: 'Directory to build in',
      required: false,
      default: '.'
    },
    {
      name: 'artifactPath',
      type: 'string',
      description: 'Path to build artifacts',
      required: false,
      default: 'dist'
    }
  ],
  template: {
    steps: [
      {
        id: 'install-dependencies',
        name: 'Install Dependencies',
        type: 'script',
        config: {
          command: '{{parameters.installCommand}}',
          workingDirectory: '{{parameters.buildDirectory}}'
        }
      },
      {
        id: 'build',
        name: 'Build Project',
        type: 'script',
        config: {
          command: '{{parameters.buildCommand}}',
          workingDirectory: '{{parameters.buildDirectory}}'
        },
        dependsOn: ['install-dependencies']
      },
      {
        id: 'verify-artifacts',
        name: 'Verify Build Artifacts',
        type: 'script',
        config: {
          command: 'ls',
          args: ['-la', '{{parameters.artifactPath}}'],
          workingDirectory: '{{parameters.buildDirectory}}'
        },
        dependsOn: ['build']
      }
    ]
  }
};

const lintTemplate: WorkflowTemplate = {
  metadata: {
    id: 'lint-workflow',
    name: 'Lint Workflow',
    description: 'Template for code linting',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['lint', 'quality', 'ci-cd'],
    category: 'ci-cd'
  },
  extends: 'base-workflow',
  parameters: [
    {
      name: 'lintCommand',
      type: 'string',
      description: 'Lint command to execute',
      required: false,
      default: 'npm run lint'
    },
    {
      name: 'fixCommand',
      type: 'string',
      description: 'Command to auto-fix lint issues',
      required: false,
      default: 'npm run lint:fix'
    },
    {
      name: 'autoFix',
      type: 'boolean',
      description: 'Automatically fix lint issues',
      required: false,
      default: false
    }
  ],
  template: {
    steps: [
      {
        id: 'lint-check',
        name: 'Run Lint Check',
        type: 'script',
        config: {
          command: '{{parameters.lintCommand}}'
        },
        condition: '{{!parameters.autoFix}}'
      },
      {
        id: 'lint-fix',
        name: 'Auto-fix Lint Issues',
        type: 'script',
        config: {
          command: '{{parameters.fixCommand}}'
        },
        condition: '{{parameters.autoFix}}'
      }
    ]
  }
};

const ciPipelineTemplate: WorkflowTemplate = {
  metadata: {
    id: 'ci-pipeline',
    name: 'CI Pipeline',
    description: 'Complete CI pipeline with install, lint, test, and build',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['ci', 'pipeline'],
    category: 'ci-cd'
  },
  extends: 'base-workflow',
  parameters: [
    {
      name: 'nodeVersion',
      type: 'string',
      description: 'Node.js version to use',
      required: false,
      default: '18'
    },
    {
      name: 'skipTests',
      type: 'boolean',
      description: 'Skip test execution',
      required: false,
      default: false
    },
    {
      name: 'skipLint',
      type: 'boolean',
      description: 'Skip linting',
      required: false,
      default: false
    }
  ],
  template: {
    env: {
      NODE_VERSION: '{{parameters.nodeVersion}}',
      CI: 'true'
    },
    steps: [
      {
        id: 'setup-node',
        name: 'Setup Node.js',
        type: 'script',
        config: {
          command: 'node',
          args: ['--version']
        }
      },
      {
        id: 'install',
        name: 'Install Dependencies',
        type: 'script',
        config: {
          command: 'npm',
          args: ['ci']
        },
        dependsOn: ['setup-node']
      },
      {
        id: 'lint',
        name: 'Lint Code',
        type: 'script',
        config: {
          command: 'npm',
          args: ['run', 'lint']
        },
        dependsOn: ['install'],
        condition: '{{!parameters.skipLint}}'
      },
      {
        id: 'test',
        name: 'Run Tests',
        type: 'script',
        config: {
          command: 'npm',
          args: ['test']
        },
        dependsOn: ['install'],
        condition: '{{!parameters.skipTests}}'
      },
      {
        id: 'build',
        name: 'Build Project',
        type: 'script',
        config: {
          command: 'npm',
          args: ['run', 'build']
        },
        dependsOn: ['lint', 'test']
      }
    ]
  }
};

// Register templates
registerTemplate(buildTemplate);
registerTemplate(lintTemplate);
registerTemplate(ciPipelineTemplate);