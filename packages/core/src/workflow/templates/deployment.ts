/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowTemplate } from '../WorkflowTemplate.js';
import { registerTemplate } from './index.js';

const deploymentTemplate: WorkflowTemplate = {
  metadata: {
    id: 'deployment-workflow',
    name: 'Deployment Workflow',
    description: 'Template for application deployment',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['deployment', 'cd'],
    category: 'deployment'
  },
  extends: 'base-workflow',
  parameters: [
    {
      name: 'environment',
      type: 'string',
      description: 'Target environment',
      required: true,
      validation: {
        enum: ['development', 'staging', 'production']
      }
    },
    {
      name: 'deployCommand',
      type: 'string',
      description: 'Deployment command',
      required: false,
      default: 'npm run deploy'
    },
    {
      name: 'healthCheckUrl',
      type: 'string',
      description: 'Health check URL',
      required: false
    },
    {
      name: 'rollbackOnFailure',
      type: 'boolean',
      description: 'Rollback on deployment failure',
      required: false,
      default: true
    }
  ],
  template: {
    env: {
      ENVIRONMENT: '{{parameters.environment}}',
      DEPLOY_ENV: '{{parameters.environment}}'
    },
    steps: [
      {
        id: 'pre-deploy-check',
        name: 'Pre-deployment Check',
        type: 'script',
        config: {
          command: 'npm',
          args: ['run', 'pre-deploy']
        }
      },
      {
        id: 'deploy',
        name: 'Deploy Application',
        type: 'script',
        config: {
          command: '{{parameters.deployCommand}}'
        },
        dependsOn: ['pre-deploy-check']
      },
      {
        id: 'health-check',
        name: 'Health Check',
        type: 'script',
        config: {
          command: 'curl',
          args: ['-f', '{{parameters.healthCheckUrl}}']
        },
        dependsOn: ['deploy'],
        condition: '{{parameters.healthCheckUrl}}'
      },
      {
        id: 'rollback',
        name: 'Rollback Deployment',
        type: 'script',
        config: {
          command: 'npm',
          args: ['run', 'rollback']
        },
        condition: '{{parameters.rollbackOnFailure && steps.health-check.status === "failed"}}'
      }
    ]
  }
};

const dockerDeploymentTemplate: WorkflowTemplate = {
  metadata: {
    id: 'docker-deployment-workflow',
    name: 'Docker Deployment Workflow',
    description: 'Template for Docker-based deployment',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['docker', 'deployment', 'containers'],
    category: 'deployment'
  },
  extends: 'deployment-workflow',
  parameters: [
    {
      name: 'dockerRegistry',
      type: 'string',
      description: 'Docker registry URL',
      required: true
    },
    {
      name: 'imageName',
      type: 'string',
      description: 'Docker image name',
      required: true
    },
    {
      name: 'imageTag',
      type: 'string',
      description: 'Docker image tag',
      required: false,
      default: 'latest'
    },
    {
      name: 'dockerfile',
      type: 'string',
      description: 'Path to Dockerfile',
      required: false,
      default: 'Dockerfile'
    }
  ],
  template: {
    env: {
      DOCKER_REGISTRY: '{{parameters.dockerRegistry}}',
      IMAGE_NAME: '{{parameters.imageName}}',
      IMAGE_TAG: '{{parameters.imageTag}}'
    },
    steps: [
      {
        id: 'build-image',
        name: 'Build Docker Image',
        type: 'script',
        config: {
          command: 'docker',
          args: [
            'build',
            '-t',
            '{{parameters.dockerRegistry}}/{{parameters.imageName}}:{{parameters.imageTag}}',
            '-f',
            '{{parameters.dockerfile}}',
            '.'
          ]
        }
      },
      {
        id: 'push-image',
        name: 'Push Docker Image',
        type: 'script',
        config: {
          command: 'docker',
          args: [
            'push',
            '{{parameters.dockerRegistry}}/{{parameters.imageName}}:{{parameters.imageTag}}'
          ]
        },
        dependsOn: ['build-image']
      },
      {
        id: 'deploy-container',
        name: 'Deploy Container',
        type: 'script',
        config: {
          command: 'docker',
          args: [
            'run',
            '-d',
            '--name',
            '{{parameters.imageName}}-{{parameters.environment}}',
            '{{parameters.dockerRegistry}}/{{parameters.imageName}}:{{parameters.imageTag}}'
          ]
        },
        dependsOn: ['push-image']
      }
    ]
  }
};

const kubernetesDeploymentTemplate: WorkflowTemplate = {
  metadata: {
    id: 'kubernetes-deployment-workflow',
    name: 'Kubernetes Deployment Workflow',
    description: 'Template for Kubernetes deployment',
    version: '1.0.0',
    author: 'ghccli',
    tags: ['kubernetes', 'k8s', 'deployment'],
    category: 'deployment'
  },
  extends: 'docker-deployment-workflow',
  parameters: [
    {
      name: 'namespace',
      type: 'string',
      description: 'Kubernetes namespace',
      required: false,
      default: 'default'
    },
    {
      name: 'manifestPath',
      type: 'string',
      description: 'Path to Kubernetes manifests',
      required: false,
      default: 'k8s'
    },
    {
      name: 'replicas',
      type: 'number',
      description: 'Number of replicas',
      required: false,
      default: 3,
      validation: {
        minimum: 1,
        maximum: 100
      }
    }
  ],
  template: {
    env: {
      KUBE_NAMESPACE: '{{parameters.namespace}}',
      REPLICAS: '{{parameters.replicas}}'
    },
    steps: [
      {
        id: 'apply-manifests',
        name: 'Apply Kubernetes Manifests',
        type: 'script',
        config: {
          command: 'kubectl',
          args: [
            'apply',
            '-f',
            '{{parameters.manifestPath}}',
            '--namespace={{parameters.namespace}}'
          ]
        },
        dependsOn: ['push-image']
      },
      {
        id: 'wait-rollout',
        name: 'Wait for Rollout',
        type: 'script',
        config: {
          command: 'kubectl',
          args: [
            'rollout',
            'status',
            'deployment/{{parameters.imageName}}',
            '--namespace={{parameters.namespace}}'
          ]
        },
        dependsOn: ['apply-manifests']
      },
      {
        id: 'verify-pods',
        name: 'Verify Pod Status',
        type: 'script',
        config: {
          command: 'kubectl',
          args: [
            'get',
            'pods',
            '-l',
            'app={{parameters.imageName}}',
            '--namespace={{parameters.namespace}}'
          ]
        },
        dependsOn: ['wait-rollout']
      }
    ]
  }
};

// Register templates
registerTemplate(deploymentTemplate);
registerTemplate(dockerDeploymentTemplate);
registerTemplate(kubernetesDeploymentTemplate);