/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, Kind, ToolResult } from '../tools/tools.js';
import { FunctionDeclaration, Type, Part } from '@google/genai';
import { AgentLoader } from '../agents/agentLoader.js';
import { createContentGenerator } from '../core/contentGenerator.js';
import { Config } from '../config/config.js';
import { Logger } from '../core/logger.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { ApprovalMode } from '../config/config.js';
import { ToolCallRequestInfo } from '../core/turn.js';
import { createLogger, LogLevel } from '../utils/logging.js';

const logger = createLogger('AgentInvocation');

const agentInvocationToolSchemaData: FunctionDeclaration = {
  name: 'invoke_agents',
  description:
    'Invokes multiple agents in parallel to handle complex, multi-step tasks autonomously. Each agent can be configured with specific parameters and methods.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      agents: {
        type: Type.ARRAY,
        description: 'Array of agent configurations to invoke',
        items: {
          type: Type.OBJECT,
          properties: {
            agentName: {
              type: Type.STRING,
              description: 'Name of the agent to invoke',
            },
            method: {
              type: Type.STRING,
              description: 'Optional method to call on the agent',
            },
            message: {
              type: Type.STRING,
              description: 'Message to send to the agent',
            },
            taskDescription: {
              type: Type.STRING,
              description: 'Optional description of the task for the agent',
            },
            additionalParams: {
              type: Type.OBJECT,
              description: 'Optional additional parameters for the agent',
            },
            metadata: {
              type: Type.OBJECT,
              description: 'Optional metadata for the agent execution',
            },
          },
          required: ['agentName', 'message'],
        },
      },
      executionId: {
        type: Type.STRING,
        description: 'Optional execution ID for tracking',
      },
      currentExecutionId: {
        type: Type.STRING,
        description: 'Optional current execution ID for context',
      },
    },
    required: ['agents'],
  },
};

const agentInvocationToolDescription = `
Invokes multiple agents in parallel to handle complex, multi-step tasks autonomously.

This tool allows you to:
- Execute multiple agents concurrently for improved performance
- Send different messages to different agents
- Specify optional methods for agents that support multiple operations
- Track execution with optional IDs
- Get aggregated results from all agent invocations

## Parameters

- \`agents\` (array, required): Array of agent configurations, each containing:
  - \`agentName\` (string, required): Name of the agent to invoke
  - \`method\` (string, optional): Specific method to call on the agent
  - \`message\` (string, required): Message to send to the agent
  - \`taskDescription\` (string, optional): Description of the task
  - \`additionalParams\` (object, optional): Additional parameters
  - \`metadata\` (object, optional): Metadata for execution tracking

- \`executionId\` (string, optional): Execution ID for batch tracking
- \`currentExecutionId\` (string, optional): Current execution context ID

## Example Usage

\`\`\`json
{
  "agents": [
    {
      "agentName": "research-agent",
      "message": "Search for recent developments in AI",
      "taskDescription": "Research task for AI developments"
    },
    {
      "agentName": "analysis-agent", 
      "method": "analyze",
      "message": "Analyze the provided data for trends",
      "taskDescription": "Data analysis task"
    }
  ]
}
\`\`\`
`;

export interface IMultiAgentInvocationParameters {
  agents: Array<{
    agentName: string;
    method?: string;
    message: string;
    taskDescription?: string;
    additionalParams?: Record<string, any>;
    metadata?: Record<string, any>;
  }>;
  executionId?: string;
  currentExecutionId?: string;
}

export interface IndividualAgentResult {
  agent: string;
  method?: string;
  success: boolean;
  duration: string;
  result?: any;
  error?: { message: string };
  childExecutionId?: string;
}

export interface MultiAgentInvocationResponse {
  totalAgents: number;
  successful: number;
  failed: number;
  duration: string;
  results: IndividualAgentResult[];
  executionSummary: {
    totalDuration: string;
    parentExecutionId?: string;
  };
}

export class AgentInvocationTool extends BaseTool<
  IMultiAgentInvocationParameters,
  ToolResult
> {
  static readonly Name: string = agentInvocationToolSchemaData.name!;

  private config: Config;

  constructor(config: Config) {
    super(
      AgentInvocationTool.Name,
      'Invoke Agents',
      agentInvocationToolDescription,
      Kind.Execute,
      agentInvocationToolSchemaData.parameters as Record<string, unknown>,
      true, // isOutputMarkdown
      true, // canUpdateOutput - enable live progress updates
    );
    this.config = config;
  }

  override validateToolParams(params: IMultiAgentInvocationParameters): string | null {
    if (!params.agents || !Array.isArray(params.agents) || params.agents.length === 0) {
      return 'Agents array parameter is required and must not be empty';
    }

    for (let i = 0; i < params.agents.length; i++) {
      const agentConfig = params.agents[i];

      if (!agentConfig.agentName) {
        return `Agent name is required for agent at index ${i}`;
      }

      if (!agentConfig.message || agentConfig.message.trim() === '') {
        return `Message is required and cannot be empty for agent '${agentConfig.agentName}' at index ${i}`;
      }
    }

    return null;
  }

  override getDescription(params: IMultiAgentInvocationParameters): string {
    const agentList = params.agents
      .map(agent => {
        const truncatedMessage = agent.message.length > 60 
          ? agent.message.substring(0, 60) + '...' 
          : agent.message;
        return `- ${agent.agentName}${agent.method ? ` (${agent.method})` : ''}: "${truncatedMessage}"`;
      })
      .join('\n');

    return `**Invoke ${params.agents.length} Agents in Parallel**:\n\n${agentList}\n\nThis will send messages to ${params.agents.length} agents in parallel and return aggregated results.`;
  }

  async execute(
    params: IMultiAgentInvocationParameters,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Validate parameters
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: JSON.stringify({ success: false, error: validationError }),
        returnDisplay: `Error: ${validationError}`,
      };
    }

    const batchExecutionId = params.executionId || this.generateExecutionId();

    // Send initial progress update
    if (updateOutput) {
      updateOutput(`Starting execution of ${params.agents.length} agents in parallel...`);
    }

    // Create execution promises for all agents
    const agentPromises = params.agents.map(async (agentConfig, index) => {
      const agentStartTime = Date.now();
      const agentExecutionId = `${batchExecutionId}-agent-${index}`;

      try {
        // Create agent loader using the proper agent discovery hierarchy
        const agentLoader = new AgentLoader(this.config.getAgentConfigsDir());
        
        // Load agent configuration
        const loadedAgentConfig = await agentLoader.loadAgentConfig(agentConfig.agentName);
        if (!loadedAgentConfig) {
          throw new Error(`Agent '${agentConfig.agentName}' not found`);
        }

        // Validate method if provided
        let methodToUse = agentConfig.method;
        if (methodToUse && !loadedAgentConfig.methods.includes(methodToUse)) {
          throw new Error(
            `Method '${methodToUse}' not supported by agent '${agentConfig.agentName}'. Supported methods: ${loadedAgentConfig.methods.join(', ')}`
          );
        }

        // Create content generator
        const contentGenerator = await createContentGenerator(
          this.config.getContentGeneratorConfig(),
          this.config,
          this.config.getSessionId()
        );

        // Get tool registry and apply agent-specific tool filtering
        const toolRegistry = await this.config.getToolRegistry();
        const toolDeclarations = toolRegistry.getFunctionDeclarations();
        
        logger.debug(`Total available tools: ${toolDeclarations.length}`, LogLevel.VERBOSE);
        
        // Get allowed and blocked tool regex patterns from agent configuration
        const allowedToolRegex = loadedAgentConfig.metadata.toolPreferences?.allowedToolRegex || [];
        const blockedToolsRegex = loadedAgentConfig.metadata.toolPreferences?.blockedToolsRegex || [];
        
        logger.debug(`Agent ${agentConfig.agentName} - allowedToolRegex: [${allowedToolRegex.join(', ')}]`, LogLevel.VERBOSE);
        logger.debug(`Agent ${agentConfig.agentName} - blockedToolsRegex: [${blockedToolsRegex.join(', ')}]`, LogLevel.VERBOSE);
        
        // Filter tools based on agent's tool preferences
        const filteredToolDeclarations = (allowedToolRegex.length > 0 || blockedToolsRegex.length > 0)
          ? toolRegistry.getFilteredFunctionDeclarationsWithBlocking(allowedToolRegex, blockedToolsRegex)
          : toolDeclarations;
        
        logger.debug(`Filtered tools for agent: ${filteredToolDeclarations.length}`, LogLevel.VERBOSE);
        logger.debug(`Filtered tool names: [${filteredToolDeclarations.map(td => td.name).join(', ')}]`, LogLevel.VERBOSE);
        
        const filteredTools = [{ functionDeclarations: filteredToolDeclarations }];

        // Dynamically import AgentChat to avoid circular dependency
        const { AgentChat } = await import('../agents/agentChat.js');

        // Create agent chat instance with filtered tools
        logger.debug(`Creating AgentChat for ${agentConfig.agentName} with ${filteredTools[0].functionDeclarations.length} tools`, LogLevel.VERBOSE);
        const agentChat = await AgentChat.fromAgentConfig(
          this.config,
          contentGenerator,
          agentConfig.agentName,
          this.config.getAgentConfigsDir(),
          {
            tools: filteredTools,
          },
        );

        logger.debug(`AgentChat created successfully for ${agentConfig.agentName}`, LogLevel.VERBOSE);
        logger.debug(`Agent supports tools: ${agentChat.supportsTools()}`, LogLevel.VERBOSE);
        logger.debug(`Agent supports streaming: ${agentChat.supportsStreaming()}`, LogLevel.VERBOSE);

        // Create progress update callback that sends live updates
        const onProgressUpdate = updateOutput ? (progressText: string) => {
          const agentProgressText = `**Agent ${index + 1} (${agentConfig.agentName})**: ${progressText}`;
          updateOutput(agentProgressText);
        } : undefined;

        // Execute the agent with complete tool calling support
        logger.debug(`Starting execution for agent ${agentConfig.agentName}`, LogLevel.VERBOSE);
        let responseText = await this.executeAgentWithToolSupport(
          agentChat,
          agentConfig.message,
          agentExecutionId,
          signal,
          onProgressUpdate,
        );

        // Save chat history automatically using execution ID as tag
        try {
          const logger = new Logger(this.config.getSessionId());
          await logger.initialize();
          const chatHistory = agentChat.getHistory();
          await logger.saveCheckpoint(chatHistory, agentExecutionId);
        } catch (saveError) {
          // Log error but don't fail the agent execution
          logger.warn(`Failed to save chat history for agent ${agentConfig.agentName}: ${saveError}`);
        }

        const duration = Date.now() - agentStartTime;

        const individualResult: IndividualAgentResult = {
          agent: agentConfig.agentName,
          method: methodToUse,
          success: true,
          duration: `${duration}ms`,
          result: {
            response: responseText,
            data: agentConfig.additionalParams || null,
          },
          childExecutionId: agentExecutionId,
        };

        return individualResult;
      } catch (error) {
        const duration = Date.now() - agentStartTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return {
          agent: agentConfig.agentName,
          method: agentConfig.method,
          success: false,
          duration: `${duration}ms`,
          error: { message: errorMessage },
          childExecutionId: agentExecutionId,
        };
      }
    });

    try {
      // Execute all agents in parallel
      const results = await Promise.allSettled(agentPromises);
      const totalDuration = Date.now() - startTime;

      // Process results
      const individualResults: IndividualAgentResult[] = [];
      let successful = 0;
      let failed = 0;

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          individualResults.push(result.value);
          if (result.value.success) {
            successful++;
          } else {
            failed++;
          }
        } else {
          // This should rarely happen since we handle errors within each agent promise
          failed++;
          const agentConfig = params.agents[index];
          individualResults.push({
            agent: agentConfig.agentName,
            method: agentConfig.method,
            success: false,
            duration: '0ms',
            error: { message: result.reason?.message || 'Promise rejected' },
            childExecutionId: `${batchExecutionId}-agent-${index}`,
          });
        }
      });

      // Create aggregated response
      const response: MultiAgentInvocationResponse = {
        totalAgents: params.agents.length,
        successful,
        failed,
        duration: `${totalDuration}ms`,
        results: individualResults,
        executionSummary: {
          totalDuration: `${totalDuration}ms`,
          parentExecutionId: params.currentExecutionId,
        },
      };

      const summary = `Invoked ${params.agents.length} agents: ${successful} successful, ${failed} failed`;

      // Send final progress update
      if (updateOutput) {
        updateOutput(`✅ Completed execution of ${params.agents.length} agents: ${successful} successful, ${failed} failed`);
      }

      return {
        summary,
        llmContent: JSON.stringify(response, null, 2),
        returnDisplay: `## Agent Invocation Results\n\n${summary}\n\n**Execution ID:** \`${batchExecutionId}\`\n**Total Duration:** ${totalDuration}ms\n\n### Individual Results:\n\n${individualResults
          .map(
            (result) =>
              `- **${result.agent}**: ${result.success ? '✅ Success' : '❌ Failed'} (${result.duration})${
                result.error ? ` - ${result.error.message}` : ''
              }${result.success ? ` - *Chat saved as: \`${result.childExecutionId}\`*` : ''}`
          )
          .join('\n')}`,
      };
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Return error response
      const errorResponse: MultiAgentInvocationResponse = {
        totalAgents: params.agents.length,
        successful: 0,
        failed: params.agents.length,
        duration: `${totalDuration}ms`,
        results: params.agents.map((agentConfig, index) => ({
          agent: agentConfig.agentName,
          method: agentConfig.method,
          success: false,
          duration: '0ms',
          error: { message: errorMessage },
          childExecutionId: `${batchExecutionId}-agent-${index}`,
        })),
        executionSummary: {
          totalDuration: `${totalDuration}ms`,
          parentExecutionId: params.currentExecutionId,
        },
      };

      return {
        llmContent: JSON.stringify(errorResponse, null, 2),
        returnDisplay: `## Agent Invocation Error\n\n**Execution ID:** \`${batchExecutionId}\`\n**Error:** ${errorMessage}`,
      };
    }
  }


  private generateExecutionId(): string {
    return `gemini-agent-exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Execute an agent with full tool calling support, handling multiple rounds of conversation
   * until the agent provides a final response without tool calls.
   */
  private async executeAgentWithToolSupport(
    agentChat: any, // AgentChat type
    message: string,
    executionId: string,
    signal: AbortSignal,
    onProgressUpdate?: (progressText: string) => void,
  ): Promise<string> {
    let currentMessage = message;
    let fullResponseText = '';
    let conversationRound = 0;
    const maxRounds = 10; // Prevent infinite loops

    logger.debug(`Starting agent execution with message: ${message.substring(0, 100)}...`, LogLevel.VERBOSE);

    while (conversationRound < maxRounds && !signal.aborted) {
      conversationRound++;
      
      logger.debug(`Starting round ${conversationRound}/${maxRounds}`, LogLevel.VERBOSE);
      
      // Update progress if callback provided
      if (onProgressUpdate) {
        onProgressUpdate(`Round ${conversationRound}/${maxRounds}: Processing agent response...`);
      }
      
      // Send message to the agent
      logger.debug(`Sending message to agent (round ${conversationRound})`, LogLevel.VERBOSE);
      const responseStream = await agentChat.sendMessageStream(
        { message: currentMessage },
        `${executionId}-round-${conversationRound}`,
      );

      // Collect response parts and check for tool calls
      const responseParts: Part[] = [];
      let roundResponseText = '';

      logger.debug('Processing response stream...', LogLevel.VERBOSE);
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

      logger.debug(`Collected ${responseParts.length} response parts, text length: ${roundResponseText.length}`, LogLevel.VERBOSE);

      // Add the round's text to the full response
      if (roundResponseText.trim()) {
        fullResponseText += (fullResponseText ? '\n\n' : '') + roundResponseText;
      }

      // Extract tool calls from the response parts
      const toolCalls = this.extractToolCallsFromParts(responseParts);
      
      if (toolCalls.length === 0) {
        // No tool calls, we're done
        logger.debug('No tool calls found, agent completed successfully', LogLevel.VERBOSE);
        if (onProgressUpdate) {
          onProgressUpdate(`Round ${conversationRound}/${maxRounds}: Agent completed successfully`);
        }
        break;
      }

      // Update progress for tool execution
      logger.debug(`Found ${toolCalls.length} tool calls to execute`, LogLevel.VERBOSE);
      if (onProgressUpdate) {
        onProgressUpdate(`Round ${conversationRound}/${maxRounds}: Executing ${toolCalls.length} tools...`);
      }

      // Execute tool calls using CoreToolScheduler
      const toolResults = await this.executeToolCalls(toolCalls, signal);
      
      logger.debug(`Tool execution completed, got ${toolResults.length} results`, LogLevel.VERBOSE);
      
      // Convert tool results back to message format for the next round
      currentMessage = this.formatToolResultsAsMessage(toolResults);
      logger.debug(`Formatted tool results for next round: ${currentMessage.substring(0, 200)}...`, LogLevel.VERBOSE);
    }

    if (conversationRound >= maxRounds) {
      logger.warn(`Agent conversation reached maximum rounds limit (${maxRounds})`);
      fullResponseText += '\n\n[Warning: Agent conversation reached maximum rounds limit]';
    }

    logger.debug(`Agent execution completed with ${fullResponseText.length} characters of response`, LogLevel.VERBOSE);
    return fullResponseText;
  }

  /**
   * Extract tool calls from response parts
   */
  private extractToolCallsFromParts(parts: Part[]): ToolCallRequestInfo[] {
    const toolCalls: ToolCallRequestInfo[] = [];
    
    logger.debug(`Extracting tool calls from ${parts.length} response parts`, LogLevel.VERBOSE);
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      logger.debug(`Part ${i}: ${Object.keys(part).join(', ')}`, LogLevel.VERBOSE);
      
      if ('functionCall' in part && part.functionCall) {
        const fc = part.functionCall;
        logger.debug(`Found function call: id=${fc.id}, name=${fc.name}`, LogLevel.VERBOSE);
        
        toolCalls.push({
          callId: fc.id || `call_${toolCalls.length}`,
          name: fc.name || '',
          args: fc.args || {},
          isClientInitiated: false, // These are agent-initiated tool calls
          prompt_id: `agent-tool-${Date.now()}-${toolCalls.length}`,
        });
      }
    }
    
    logger.debug(`Extracted ${toolCalls.length} tool calls`, LogLevel.VERBOSE);
    return toolCalls;
  }

  /**
   * Execute tool calls using CoreToolScheduler
   */
  private async executeToolCalls(
    toolCalls: ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<any[]> {
    // If no tool calls, return empty results immediately
    if (!toolCalls || toolCalls.length === 0) {
      logger.debug('No tool calls to execute', LogLevel.VERBOSE);
      return [];
    }

    logger.debug(`Executing ${toolCalls.length} tool calls: ${toolCalls.map(tc => tc.name).join(', ')}`, LogLevel.VERBOSE);

    return new Promise((resolve, reject) => {
      const results: any[] = [];
      let isResolved = false;
      
      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          logger.error('Tool execution timeout after 60 seconds');
          reject(new Error('Tool execution timeout after 60 seconds'));
        }
      }, 60000); // 60 second timeout

      // Handle abort signal
      if (signal.aborted) {
        clearTimeout(timeout);
        reject(new Error('Tool execution aborted'));
        return;
      }

      signal.addEventListener('abort', () => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          logger.debug('Tool execution aborted by signal', LogLevel.VERBOSE);
          reject(new Error('Tool execution aborted'));
        }
      });
      
      // Create a temporary config with YOLO approval mode for agent-initiated tool calls
      const agentToolConfig = {
        ...this.config,
        getApprovalMode: () => ApprovalMode.YOLO, // Force YOLO mode for agent tools
      };
      
      logger.debug('Creating CoreToolScheduler with YOLO approval mode for agent tools', LogLevel.VERBOSE);
      
      const toolScheduler = new CoreToolScheduler({
        toolRegistry: this.config.getToolRegistry(),
        getPreferredEditor: () => undefined,
        config: agentToolConfig as Config, // Use the modified config
        getTerminalSize: () => ({ columns: 80, rows: 24 }),
        onEditorClose: () => {},
        onAllToolCallsComplete: async (completedCalls) => {
          if (isResolved) return;
          
          isResolved = true;
          clearTimeout(timeout);
          
          logger.debug(`All ${completedCalls.length} tool calls completed`, LogLevel.VERBOSE);
          
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
              logger.debug(`Tool ${call.request.name} succeeded`, LogLevel.VERBOSE);
            } else {
              results.push({
                callId: call.request.callId,
                name: call.request.name,
                error: call.response?.error?.message || 'Tool execution failed',
                success: false,
              });
              logger.warn(`Tool ${call.request.name} failed: ${call.response?.error?.message}`);
            }
          }
          resolve(results);
        },
        onToolCallsUpdate: (toolCalls) => {
          // Log tool call status updates for debugging
          const statusSummary = toolCalls.map(tc => `${tc.request.name}: ${tc.status}`).join(', ');
          logger.debug(`Tool status update: ${statusSummary}`, LogLevel.VERBOSE);
        },
      });

      // Schedule the tool calls
      logger.debug('Scheduling tool calls with CoreToolScheduler', LogLevel.VERBOSE);
      toolScheduler.schedule(toolCalls, signal).catch((error) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          logger.error(`Error scheduling tool calls: ${error}`);
          reject(error);
        }
      });
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
}