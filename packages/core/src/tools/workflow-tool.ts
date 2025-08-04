/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { Schema, Type } from '@google/genai';
import { BaseTool, Icon, ToolResult, ToolLocation } from './tools.js';
import { WorkflowRunner, WorkflowStatus, WorkflowExecutionOptions } from '../workflow/WorkflowRunner.js';
import { WorkflowDefinition, WorkflowResult } from '../workflow/types.js';
import { validateWorkflowDefinition } from '../workflow/schema.js';
import { Config } from '../config/config.js';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { cwd } from 'node:process';

interface RunWorkflowParams {
  name: string;
  variables?: Record<string, unknown>;
  timeout?: number;
  continueOnError?: boolean;
  parallelEnabled?: boolean;
  maxConcurrency?: number;
}

interface ListWorkflowsParams {
  path?: string;
}

interface WorkflowStatusParams {
  name: string;
}

export class WorkflowTool extends BaseTool<
  RunWorkflowParams | ListWorkflowsParams | WorkflowStatusParams,
  ToolResult
> {
  private workflowRunners: Map<string, WorkflowRunner> = new Map();
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private config: Config;

  constructor(config: Config) {
    const parameterSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          enum: ['runWorkflow', 'listWorkflows', 'workflowStatus'],
          description: 'The action to perform'
        },
        name: {
          type: Type.STRING,
          description: 'Name of the workflow (required for runWorkflow and workflowStatus)'
        },
        variables: {
          type: Type.OBJECT,
          description: 'Variables to pass to the workflow execution (optional for runWorkflow)'
        },
        timeout: {
          type: Type.NUMBER,
          description: 'Timeout in milliseconds for workflow execution (optional for runWorkflow)'
        },
        continueOnError: {
          type: Type.BOOLEAN,
          description: 'Whether to continue execution if a step fails (optional for runWorkflow)'
        },
        parallelEnabled: {
          type: Type.BOOLEAN,
          description: 'Whether to enable parallel execution (optional for runWorkflow)'
        },
        maxConcurrency: {
          type: Type.NUMBER,
          description: 'Maximum number of concurrent steps (optional for runWorkflow)'
        },
        path: {
          type: Type.STRING,
          description: 'Path to search for workflows (optional for listWorkflows, defaults to current directory)'
        }
      },
      required: ['action']
    };

    super(
      'workflow',
      'Workflow Tool',
      'Execute, list, and check status of workflows. Supports YAML workflow definitions with script and agent steps.',
      Icon.Hammer,
      parameterSchema,
      true, // isOutputMarkdown
      false // canUpdateOutput
    );

    this.config = config;
  }

  validateToolParams(params: any): string | null {
    if (!params || typeof params !== 'object') {
      return 'Parameters must be an object';
    }

    if (!params.action || typeof params.action !== 'string') {
      return 'Action parameter is required and must be a string';
    }

    const validActions = ['runWorkflow', 'listWorkflows', 'workflowStatus'];
    if (!validActions.includes(params.action)) {
      return `Action must be one of: ${validActions.join(', ')}`;
    }

    if ((params.action === 'runWorkflow' || params.action === 'workflowStatus') && !params.name) {
      return `Name parameter is required for ${params.action}`;
    }

    if (params.action === 'runWorkflow') {
      if (params.timeout !== undefined && (typeof params.timeout !== 'number' || params.timeout <= 0)) {
        return 'Timeout must be a positive number';
      }
      if (params.maxConcurrency !== undefined && (typeof params.maxConcurrency !== 'number' || params.maxConcurrency <= 0)) {
        return 'maxConcurrency must be a positive number';
      }
    }

    return null;
  }

  getDescription(params: any): string {
    const action = params.action;
    switch (action) {
      case 'runWorkflow':
        return `Execute workflow "${params.name}"${params.variables ? ' with custom variables' : ''}`;
      case 'listWorkflows':
        return `List available workflows${params.path ? ` in ${params.path}` : ''}`;
      case 'workflowStatus':
        return `Get status of workflow "${params.name}"`;
      default:
        return `Unknown workflow action: ${action}`;
    }
  }

  toolLocations(params: any): ToolLocation[] {
    if (params.action === 'listWorkflows') {
      const searchPath = params.path || cwd();
      return [{ path: searchPath }];
    }
    return [];
  }

  async execute(
    params: any,
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Validation error: ${validationError}`,
        returnDisplay: `**Error:** ${validationError}`
      };
    }

    try {
      switch (params.action) {
        case 'runWorkflow':
          return await this.runWorkflow(params as RunWorkflowParams, signal, updateOutput);
        case 'listWorkflows':
          return await this.listWorkflows(params as ListWorkflowsParams);
        case 'workflowStatus':
          return await this.workflowStatus(params as WorkflowStatusParams);
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error executing workflow action: ${errorMessage}`,
        returnDisplay: `**Error:** ${errorMessage}`
      };
    }
  }

  private async runWorkflow(
    params: RunWorkflowParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void
  ): Promise<ToolResult> {
    // Discover workflows if not already loaded
    await this.discoverWorkflows();

    const workflow = this.workflows.get(params.name);
    if (!workflow) {
      const availableWorkflows = Array.from(this.workflows.keys()).join(', ');
      return {
        llmContent: `Workflow "${params.name}" not found. Available workflows: ${availableWorkflows}`,
        returnDisplay: `**Error:** Workflow "${params.name}" not found.\n\n**Available workflows:** ${availableWorkflows}`
      };
    }

    // Create workflow runner
    const runner = new WorkflowRunner(this.config);
    this.workflowRunners.set(params.name, runner);

    // Set up execution options
    const options: WorkflowExecutionOptions = {
      timeout: params.timeout,
      continueOnError: params.continueOnError,
      variables: params.variables,
      parallelEnabled: params.parallelEnabled,
      maxConcurrency: params.maxConcurrency
    };

    updateOutput?.(`Starting workflow "${params.name}"...\n`);

    // Execute workflow
    const result = await runner.execute(workflow, options);

    // Generate summary report
    const summaryReport = runner.generateSummaryReport(workflow, result);
    
    const llmContent = `Workflow "${params.name}" ${result.success ? 'completed successfully' : 'failed'}.\n\nExecution time: ${result.executionTime}ms\n\n${summaryReport}`;
    
    const returnDisplay = `# Workflow Execution Report\n\n**Workflow:** ${params.name}\n**Status:** ${result.success ? '✅ Success' : '❌ Failed'}\n**Execution Time:** ${result.executionTime}ms\n\n${summaryReport}`;

    return {
      summary: `Workflow "${params.name}" ${result.success ? 'completed' : 'failed'} in ${result.executionTime}ms`,
      llmContent,
      returnDisplay
    };
  }

  private async listWorkflows(params: ListWorkflowsParams): Promise<ToolResult> {
    const searchPath = params.path || cwd();
    
    try {
      await this.discoverWorkflows(searchPath);
      
      if (this.workflows.size === 0) {
        return {
          llmContent: `No workflows found in ${searchPath}`,
          returnDisplay: `**No workflows found** in \`${searchPath}\`\n\nWorkflows should be YAML files with .yml or .yaml extensions containing valid workflow definitions.`
        };
      }

      const workflowList = Array.from(this.workflows.entries())
        .map(([name, workflow]) => {
          const stepCount = workflow.steps.length;
          const description = workflow.description || 'No description available';
          return {
            name,
            description,
            version: workflow.version,
            stepCount
          };
        });

      const llmContent = `Found ${workflowList.length} workflows:\n${workflowList.map(w => `- ${w.name} (v${w.version}): ${w.description} (${w.stepCount} steps)`).join('\n')}`;
      
      const returnDisplay = `# Available Workflows\n\nFound **${workflowList.length}** workflows in \`${searchPath}\`:\n\n${workflowList.map(w => `## ${w.name}\n- **Version:** ${w.version}\n- **Description:** ${w.description}\n- **Steps:** ${w.stepCount}\n`).join('\n')}`;

      return {
        summary: `Found ${workflowList.length} workflows`,
        llmContent,
        returnDisplay
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error discovering workflows: ${errorMessage}`,
        returnDisplay: `**Error discovering workflows:** ${errorMessage}`
      };
    }
  }

  private async workflowStatus(params: WorkflowStatusParams): Promise<ToolResult> {
    const runner = this.workflowRunners.get(params.name);
    
    if (!runner) {
      return {
        llmContent: `No running workflow found with name "${params.name}"`,
        returnDisplay: `**No running workflow** found with name "${params.name}"`
      };
    }

    const status = runner.getStatus();
    const context = runner.getContext();
    const progress = runner.getProgress();

    const llmContent = `Workflow "${params.name}" status: ${status}\nProgress: ${progress}%`;
    
    let returnDisplay = `# Workflow Status\n\n**Name:** ${params.name}\n**Status:** ${this.getStatusEmoji(status)} ${status}\n**Progress:** ${progress}%\n`;
    
    if (context) {
      const completedSteps = Object.keys(context.getAllStepOutputs()).length;
      returnDisplay += `**Completed Steps:** ${completedSteps}\n`;
    }

    return {
      summary: `Workflow "${params.name}" is ${status} (${progress}%)`,
      llmContent,
      returnDisplay
    };
  }

  private getStatusEmoji(status: WorkflowStatus): string {
    switch (status) {
      case WorkflowStatus.PENDING:
        return '⏳';
      case WorkflowStatus.RUNNING:
        return '🔄';
      case WorkflowStatus.COMPLETED:
        return '✅';
      case WorkflowStatus.FAILED:
        return '❌';
      case WorkflowStatus.CANCELLED:
        return '🚫';
      default:
        return '❓';
    }
  }

  private async discoverWorkflows(searchPath?: string): Promise<void> {
    const path = searchPath || cwd();
    
    try {
      const entries = await readdir(path, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(path, entry.name);
        
        if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (ext === '.yml' || ext === '.yaml') {
            try {
              // Check if this YAML file looks like a workflow before attempting to load it
              const isLikelyWorkflow = await this.isLikelyWorkflowFile(fullPath);
              if (isLikelyWorkflow) {
                await this.loadWorkflowFile(fullPath);
              }
            } catch (error) {
              console.warn(`Failed to load workflow file ${fullPath}:`, error);
            }
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          // Recursively search subdirectories (but not hidden ones or node_modules)
          await this.discoverWorkflows(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Failed to read directory ${path}:`, error);
    }
  }

  /**
   * Performs a lightweight check to determine if a YAML file is likely a workflow
   * before attempting expensive validation. This prevents trying to parse agent
   * configs, docker-compose files, and other YAML files as workflows.
   */
   private async isLikelyWorkflowFile(filePath: string): Promise<boolean> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = parseYaml(content);
      
      // Must be an object
      if (!data || typeof data !== 'object') {
        return false;
      }
      
      // Must have essential workflow properties
      const hasName = 'name' in data && typeof data.name === 'string';
      const hasSteps = 'steps' in data && Array.isArray(data.steps);
      const hasVersion = 'version' in data && typeof data.version === 'string';
      
      // A workflow must have name, steps, and version
      if (!hasName || !hasSteps || !hasVersion) {
        return false;
      }
      
      // Check if steps look like workflow steps (have id, name, type)
      const steps = data.steps as any[];
      if (steps.length === 0) {
        return false;
      }
      
      // At least the first step should have workflow step structure
      const firstStep = steps[0];
      if (!firstStep || typeof firstStep !== 'object') {
        return false;
      }
      
      const hasStepId = 'id' in firstStep;
      const hasStepName = 'name' in firstStep;
      const hasStepType = 'type' in firstStep;
      
      return hasStepId && hasStepName && hasStepType;
    } catch {
      // If we can't parse it, it's definitely not a workflow
      return false;
    }
  }

  private async loadWorkflowFile(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const workflowData = parseYaml(content);
      
      // Validate workflow definition
      const validationResult = validateWorkflowDefinition(workflowData);
      if (!validationResult.valid) {
        const errors = validationResult.errors || ['Unknown validation error'];
        throw new Error(`Invalid workflow definition in ${filePath}: ${errors.join(', ')}`);
      }
      
      const workflow = workflowData as WorkflowDefinition;
      this.workflows.set(workflow.name, workflow);
    } catch (error) {
      throw new Error(`Failed to load workflow from ${filePath}: ${error}`);
    }
  }
}