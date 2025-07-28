/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, Icon, ToolResult } from './tools.js';
import { FunctionDeclaration, Type } from '@google/genai';
import { AgentChat } from '../agents/agentChat.js';
import { AgentLoader } from '../agents/agentLoader.js';
import { createContentGenerator } from '../core/contentGenerator.js';
import { Config } from '../config/config.js';
import * as path from 'node:path';

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
      Icon.Hammer,
      agentInvocationToolSchemaData.parameters as Record<string, unknown>,
    );
    this.config = config;
  }

  validateToolParams(params: IMultiAgentInvocationParameters): string | null {
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

  getDescription(params: IMultiAgentInvocationParameters): string {
    const agentList = params.agents
      .map(agent => `- ${agent.agentName}${agent.method ? ` (${agent.method})` : ''}`)
      .join('\n');

    return `**Invoke ${params.agents.length} Agents in Parallel**:\n\n${agentList}\n\nThis will send messages to ${params.agents.length} agents in parallel and return aggregated results.`;
  }

  async execute(
    params: IMultiAgentInvocationParameters,
    signal: AbortSignal,
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

    // Create execution promises for all agents
    const agentPromises = params.agents.map(async (agentConfig, index) => {
      const agentStartTime = Date.now();
      const agentExecutionId = `${batchExecutionId}-agent-${index}`;

      try {
        // Create agent loader with agents configs directory
        const agentLoader = new AgentLoader(path.join(process.cwd(), 'packages/core/src/agents/configs'));
        
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

        // Create agent chat instance
        const agentChat = new AgentChat(
          this.config,
          contentGenerator,
          loadedAgentConfig,
        );

        // Execute the agent with the provided message
        const response = await agentChat.sendMessage(
          { message: agentConfig.message },
          agentExecutionId,
        );

        const duration = Date.now() - agentStartTime;

        const individualResult: IndividualAgentResult = {
          agent: agentConfig.agentName,
          method: methodToUse,
          success: true,
          duration: `${duration}ms`,
          result: {
            response: response.text || 'No response content',
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

      return {
        summary,
        llmContent: JSON.stringify(response, null, 2),
        returnDisplay: `## Agent Invocation Results\n\n${summary}\n\n**Total Duration:** ${totalDuration}ms\n\n### Individual Results:\n\n${individualResults
          .map(
            (result) =>
              `- **${result.agent}**: ${result.success ? '✅ Success' : '❌ Failed'} (${result.duration})${
                result.error ? ` - ${result.error.message}` : ''
              }`
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
        returnDisplay: `Error invoking agents: ${errorMessage}`,
      };
    }
  }


  private generateExecutionId(): string {
    return `gemini-agent-exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}