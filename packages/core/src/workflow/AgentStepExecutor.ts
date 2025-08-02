/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowStep, AgentConfig } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';
import { StepExecutor } from './StepExecutor.js';

export interface AgentExecutionResult {
  agentId: string;
  response: unknown;
  executionTime: number;
  metadata?: Record<string, unknown>;
}

/**
 * Executor for agent-type workflow steps
 * Integrates with the existing agent system to execute agent-based tasks
 */
export class AgentStepExecutor extends StepExecutor {
  getSupportedType(): string {
    return 'agent';
  }

  validate(step: WorkflowStep): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (step.type !== 'agent') {
      errors.push(`Invalid step type: expected 'agent', got '${step.type}'`);
    }

    const config = step.config as AgentConfig;
    if (!config.agent) {
      errors.push('Agent step must specify an agent');
    }

    if (typeof config.agent !== 'string') {
      errors.push('Agent name must be a string');
    }

    if (config.prompt && typeof config.prompt !== 'string') {
      errors.push('Agent prompt must be a string');
    }

    if (config.timeout && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
      errors.push('Agent timeout must be a positive number');
    }

    if (config.parameters && typeof config.parameters !== 'object') {
      errors.push('Agent parameters must be an object');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async execute(step: WorkflowStep, context: WorkflowContext): Promise<AgentExecutionResult> {
    const config = step.config as AgentConfig;
    const startTime = Date.now();

    try {
      // For now, this is a placeholder implementation
      // In the actual implementation, this would integrate with the existing agent system
      // located in packages/core/src/agents/
      
      const agentResult = await this.executeAgent(config, context);
      
      return {
        agentId: config.agent,
        response: agentResult,
        executionTime: Date.now() - startTime,
        metadata: {
          prompt: config.prompt,
          parameters: config.parameters
        }
      };
    } catch (error) {
      throw new Error(`Agent execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Execute the agent with the given configuration
   * This is a placeholder that would integrate with the actual agent system
   */
  private async executeAgent(config: AgentConfig, context: WorkflowContext): Promise<unknown> {
    // TODO: Integrate with the actual agent system from packages/core/src/agents/
    // This would involve:
    // 1. Loading the specified agent configuration
    // 2. Creating an agent instance
    // 3. Executing the agent with the provided prompt and parameters
    // 4. Handling agent-specific timeout and error scenarios
    
    // For now, return a placeholder response
    return {
      agent: config.agent,
      prompt: config.prompt || 'No prompt provided',
      parameters: config.parameters || {},
      contextVariables: context.getVariables(),
      message: 'Agent execution placeholder - to be integrated with actual agent system'
    };
  }

  /**
   * Resolve prompt template with context variables
   */
  private resolvePromptTemplate(prompt: string, context: WorkflowContext): string {
    let resolvedPrompt = prompt;
    
    // Replace variable placeholders like {{variable.name}}
    const variables = context.getVariables();
    const variableRegex = /\{\{([^}]+)\}\}/g;
    
    resolvedPrompt = resolvedPrompt.replace(variableRegex, (match, path) => {
      const value = this.getNestedValue(variables, path.trim());
      return value !== undefined ? String(value) : match;
    });

    // Replace step output placeholders like {{steps.stepId.property}}
    const stepOutputRegex = /\{\{steps\.([^.}]+)(?:\.([^}]+))?\}\}/g;
    resolvedPrompt = resolvedPrompt.replace(stepOutputRegex, (match, stepId, property) => {
      const stepOutput = context.getStepOutput(stepId);
      if (stepOutput === undefined) {
        return match;
      }
      
      if (!property) {
        return String(stepOutput);
      }
      
      const value = this.getNestedValue(stepOutput, property);
      return value !== undefined ? String(value) : match;
    });

    return resolvedPrompt;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' ? current[key] : undefined;
    }, obj);
  }

  protected async beforeExecute(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    const config = step.config as AgentConfig;
    context.log(`Executing agent: ${config.agent}`);
    
    if (config.prompt) {
      const resolvedPrompt = this.resolvePromptTemplate(config.prompt, context);
      context.log(`Prompt: ${resolvedPrompt}`);
    }
    
    if (config.parameters) {
      context.log(`Parameters: ${JSON.stringify(config.parameters, null, 2)}`);
    }
  }

  protected async afterExecute(step: WorkflowStep, context: WorkflowContext, result: unknown): Promise<void> {
    const agentResult = result as AgentExecutionResult;
    context.log(`Agent ${agentResult.agentId} completed in ${agentResult.executionTime}ms`);
    
    // Log the response (truncated if too long)
    const responseStr = JSON.stringify(agentResult.response);
    const truncated = responseStr.length > 1000 ? responseStr.substring(0, 1000) + '...' : responseStr;
    context.log(`Response: ${truncated}`);
  }

  protected async onError(step: WorkflowStep, context: WorkflowContext, error: Error): Promise<void> {
    const config = step.config as AgentConfig;
    context.log(`Agent ${config.agent} execution failed: ${error.message}`, 'error');
  }
}