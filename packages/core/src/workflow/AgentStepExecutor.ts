/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowStep, AgentConfig } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';
import { StepExecutor } from './StepExecutor.js';
import { VariableInterpolator } from './VariableInterpolator.js';
import { AgentLoader } from '../agents/agentLoader.js';
import { createContentGenerator } from '../core/contentGenerator.js';
import { Config } from '../config/config.js';
import { Logger } from '../core/logger.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { ApprovalMode } from '../config/config.js';
import { ToolCallRequestInfo } from '../core/turn.js';
import { Part } from '@google/genai';

export interface AgentExecutionResult {
  agentId: string;
  response: unknown;
  executionTime: number;
  metadata?: Record<string, unknown>;
}

export interface AgentStepExecutorConfig {
  config: Config;
  agentConfigsDir?: string | string[];
  defaultTimeout?: number;
  maxRounds?: number;
}

/**
 * Executor for agent-type workflow steps
 * Integrates with the existing agent system to execute agent-based tasks
 */
export class AgentStepExecutor extends StepExecutor {
  private executorConfig?: AgentStepExecutorConfig;
  private interpolator: VariableInterpolator;

  constructor(executorConfig?: AgentStepExecutorConfig) {
    super();
    this.executorConfig = executorConfig;
    this.interpolator = new VariableInterpolator();
  }

  getSupportedType(): string {
    return 'agent';
  }

  /**
   * Get the executor configuration with defaults
   */
  private getExecutorConfig(): AgentStepExecutorConfig {
    if (!this.executorConfig) {
      throw new Error('AgentStepExecutor requires a configuration to be provided. Please provide an AgentStepExecutorConfig when creating the executor.');
    }
    return this.executorConfig;
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

    // Interpolate configuration values
    const interpolatedConfig = this.interpolateConfig(config, context);

    try {
      const agentResult = await this.executeAgent(interpolatedConfig, context);
      
      return {
        agentId: interpolatedConfig.agent,
        response: agentResult,
        executionTime: Date.now() - startTime,
        metadata: {
          prompt: interpolatedConfig.prompt,
          parameters: interpolatedConfig.parameters
        }
      };
    } catch (error) {
      throw new Error(`Agent execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Interpolate variables in agent configuration
   */
  private interpolateConfig(config: AgentConfig, context: WorkflowContext): AgentConfig {
    const result = this.interpolator.interpolateValue(config, context);
    
    if (!result.success) {
      context.log(`Warning: Variable interpolation had errors: ${result.errors.join(', ')}`, 'warn');
    }
    
    return result.value as AgentConfig;
  }

  /**
   * Execute the agent with the given configuration
   * Integrates with the actual agent system from packages/core/src/agents/
   */
  private async executeAgent(config: AgentConfig, context: WorkflowContext): Promise<unknown> {
    const executorConfig = this.getExecutorConfig();
    const agentConfigsDir = executorConfig.agentConfigsDir || executorConfig.config.getAgentConfigsDir();
    const agentLoader = new AgentLoader(agentConfigsDir);
    
    // Load agent configuration
    const loadedAgentConfig = await agentLoader.loadAgentConfig(config.agent);
    if (!loadedAgentConfig) {
      throw new Error(`Agent '${config.agent}' not found`);
    }

    // Create content generator
    const contentGenerator = await createContentGenerator(
      executorConfig.config.getContentGeneratorConfig(),
      executorConfig.config,
      executorConfig.config.getSessionId()
    );

    // Get tool registry and apply agent-specific tool filtering
    const toolRegistry = await executorConfig.config.getToolRegistry();
    const toolDeclarations = toolRegistry.getFunctionDeclarations();
    
    // Get allowed and blocked tool regex patterns from agent configuration
    const allowedToolRegex = loadedAgentConfig.metadata.toolPreferences?.allowedToolRegex || [];
    const blockedToolsRegex = loadedAgentConfig.metadata.toolPreferences?.blockedToolsRegex || [];
    
    // Filter tools based on agent's tool preferences
    const filteredToolDeclarations = (allowedToolRegex.length > 0 || blockedToolsRegex.length > 0)
      ? toolRegistry.getFilteredFunctionDeclarationsWithBlocking(allowedToolRegex, blockedToolsRegex)
      : toolDeclarations;
    
    const filteredTools = [{ functionDeclarations: filteredToolDeclarations }];

    // Dynamically import AgentChat to avoid circular dependency
    const { AgentChat } = await import('../agents/agentChat.js');

    // Create agent chat instance with filtered tools
    const agentChat = await AgentChat.fromAgentConfig(
      executorConfig.config,
      contentGenerator,
      config.agent,
      agentConfigsDir,
      {
        tools: filteredTools,
      },
    );

    // Resolve prompt template with context variables
    const resolvedPrompt = config.prompt ? this.resolvePromptTemplate(config.prompt, context) : 'Execute your task based on the workflow context.';
    
    // Create execution ID for this workflow step
    const executionId = `workflow-${context.getWorkflowId ? context.getWorkflowId() : 'unknown'}-step-${Date.now()}`;
    
    // Set up timeout handling
    const timeout = config.timeout || executorConfig.defaultTimeout || 60000; // Default to 60 seconds
    const maxRounds = executorConfig.maxRounds || loadedAgentConfig.metadata.executionConfig.maxRounds || 10;
    
    // Execute the agent with complete tool calling support
    const responseText = await this.executeAgentWithToolSupport(
      agentChat,
      resolvedPrompt,
      executionId,
      timeout,
      maxRounds
    );

    // Save chat history automatically using execution ID as tag
    try {
      const logger = new Logger(executorConfig.config.getSessionId());
      await logger.initialize();
      const chatHistory = agentChat.getHistory();
      await logger.saveCheckpoint(chatHistory, executionId);
    } catch (saveError) {
      // Log error but don't fail the agent execution
      context.log(`Failed to save chat history for agent ${config.agent}: ${saveError}`, 'warn');
    }

    return {
      agent: config.agent,
      prompt: resolvedPrompt,
      parameters: config.parameters || {},
      response: responseText,
      executionId: executionId,
      agentConfig: {
        name: loadedAgentConfig.name,
        description: loadedAgentConfig.description,
        specialization: loadedAgentConfig.metadata.specialization
      }
    };
  }

  /**
   * Execute an agent with full tool calling support, handling multiple rounds of conversation
   * until the agent provides a final response without tool calls.
   */
  private async executeAgentWithToolSupport(
    agentChat: any, // AgentChat type
    message: string,
    executionId: string,
    timeout: number,
    maxRounds: number,
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Agent execution timed out after ${timeout}ms`));
      }, timeout);

      try {
        let currentMessage = message;
        let fullResponseText = '';
        let conversationRound = 0;

        while (conversationRound < maxRounds) {
          conversationRound++;
          
          // Send message to the agent
          const responseStream = await agentChat.sendMessageStream(
            { message: currentMessage },
            `${executionId}-round-${conversationRound}`,
          );

          // Collect response parts and check for tool calls
          const responseParts: Part[] = [];
          let roundResponseText = '';

          for await (const resp of responseStream) {
            if (resp.candidates?.[0]?.content?.parts) {
              for (const part of resp.candidates[0].content.parts) {
                responseParts.push(part);
                
                // Collect text parts
                const textPart = getResponseText(resp);
                if (textPart) {
                  roundResponseText += textPart;
                }
              }
            }
          }

          // Add the round's text to the full response
          if (roundResponseText.trim()) {
            fullResponseText += (fullResponseText ? '\n\n' : '') + roundResponseText;
          }

          // Extract tool calls from the response parts
          const toolCalls = this.extractToolCallsFromParts(responseParts);
          
          if (toolCalls.length === 0) {
            // No tool calls, we're done
            break;
          }

          // Execute tool calls using CoreToolScheduler
          const toolResults = await this.executeToolCalls(toolCalls);
          
          // Convert tool results back to message format for the next round
          currentMessage = this.formatToolResultsAsMessage(toolResults);
        }

        if (conversationRound >= maxRounds) {
          fullResponseText += '\n\n[Warning: Agent conversation reached maximum rounds limit]';
        }

        clearTimeout(timeoutId);
        resolve(fullResponseText);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Extract tool calls from response parts
   */
  private extractToolCallsFromParts(parts: Part[]): ToolCallRequestInfo[] {
    const toolCalls: ToolCallRequestInfo[] = [];
    
    for (const part of parts) {
      if ('functionCall' in part && part.functionCall) {
        const fc = part.functionCall;
        toolCalls.push({
          callId: fc.id || `call_${toolCalls.length}`,
          name: fc.name || '',
          args: fc.args || {},
          isClientInitiated: false, // These are agent-initiated tool calls
          prompt_id: `agent-tool-${Date.now()}-${toolCalls.length}`,
        });
      }
    }
    
    return toolCalls;
  }

  /**
   * Execute tool calls using CoreToolScheduler
   */
  private async executeToolCalls(
    toolCalls: ToolCallRequestInfo[],
  ): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      
      const executorConfig = this.getExecutorConfig();
      const toolScheduler = new CoreToolScheduler({
        toolRegistry: executorConfig.config.getToolRegistry(),
        approvalMode: ApprovalMode.YOLO, // Auto-approve tools for workflow agents
        getPreferredEditor: () => undefined,
        config: executorConfig.config,
        onAllToolCallsComplete: (completedCalls) => {
          // Extract results from completed calls
          for (const call of completedCalls) {
            if (call.status === 'success') {
              let result = 'Tool executed successfully';
              
              // Extract result from responseParts
              if (call.response?.responseParts) {
                const responseParts = call.response.responseParts;
                if (typeof responseParts === 'object' && 'functionResponse' in responseParts) {
                  result = (responseParts as any).functionResponse?.response || result;
                } else if (Array.isArray(responseParts) && responseParts.length > 0) {
                  const firstPart = responseParts[0];
                  if (typeof firstPart === 'object' && 'functionResponse' in firstPart) {
                    result = (firstPart as any).functionResponse?.response || result;
                  }
                }
              }
              
              results.push({
                callId: call.request.callId,
                name: call.request.name,
                result: result,
                success: true,
              });
            } else {
              results.push({
                callId: call.request.callId,
                name: call.request.name,
                error: call.response?.error?.message || 'Tool execution failed',
                success: false,
              });
            }
          }
          resolve(results);
        },
      });

      // Schedule the tool calls
      toolScheduler.schedule(toolCalls, new AbortController().signal).catch(reject);
    });
  }

  /**
   * Format tool results as a message for the next conversation round
   */
  private formatToolResultsAsMessage(toolResults: any[]): string {
    const resultSummary = toolResults
      .map((result) => {
        if (result.success) {
          return `Tool ${result.name} executed successfully: ${JSON.stringify(result.result)}`;
        } else {
          return `Tool ${result.name} failed: ${result.error}`;
        }
      })
      .join('\n');
    
    return `Tool execution results:\n${resultSummary}\n\nPlease continue with your response based on these results.`;
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
      context.log(`Resolved prompt: ${resolvedPrompt.length > 200 ? resolvedPrompt.substring(0, 200) + '...' : resolvedPrompt}`);
    }
    
    if (config.parameters) {
      context.log(`Parameters: ${JSON.stringify(config.parameters, null, 2)}`);
    }

    // Log timeout and execution config
    const executorConfig = this.getExecutorConfig();
    const timeout = config.timeout || executorConfig.defaultTimeout || 60000;
    context.log(`Timeout: ${timeout}ms`);
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