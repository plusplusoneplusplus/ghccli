/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach, Mock } from 'vitest';
import { AgentInvocationTool, IMultiAgentInvocationParameters } from './agent-invocation.js';
import { Config } from '../config/config.js';
import { AgentLoader } from '../agents/agentLoader.js';
import { AgentChat } from '../agents/agentChat.js';
import { AgentConfig } from '../agents/agentTypes.js';
import { createContentGenerator, ContentGenerator } from '../core/contentGenerator.js';
import { GenerateContentResponse } from '@google/genai';

// Mock dependencies
vi.mock('../agents/agentLoader.js');
vi.mock('../agents/agentChat.js');
vi.mock('../core/contentGenerator.js');
vi.mock('node:path');

describe('AgentInvocationTool', () => {
  const mockAbortSignal = new AbortController().signal;
  
  const mockConfig = {
    getContentGeneratorConfig: vi.fn(),
    getSessionId: vi.fn(),
  } as unknown as Config;

  const mockAgentConfig: AgentConfig = {
    name: 'test-agent',
    description: 'Test agent for testing',
    methods: ['analyze', 'research'],
    availableAgents: ['test-agent'],
    metadata: {
      supportsStreaming: true,
      supportsTools: true,
      requiresWorkspace: false,
      supportsPromptSelection: true,
      languageModel: { preferred: 'gemini-pro' },
      promptSupport: {
        supportsPrompts: true,
        supportsTsxMessages: false,
        promptParameterName: 'prompt',
        variableResolution: true,
      },
      specialization: 'Testing',
      executionConfig: {
        maxRounds: 10,
        maxContextTokens: 100000,
      },
    },
    systemPrompt: {
      type: 'content',
      value: 'You are a test agent.',
    },
  };

  const mockContentGenerator = {} as ContentGenerator;
  const mockAgentLoader = vi.mocked(AgentLoader);
  const mockAgentChat = vi.mocked(AgentChat);
  const mockCreateContentGenerator = vi.mocked(createContentGenerator);

  let tool: AgentInvocationTool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.getSessionId.mockReturnValue('test-session-id');
    mockConfig.getContentGeneratorConfig.mockReturnValue({
      model: 'gemini-pro',
      authType: 'test-auth',
    });
    
    tool = new AgentInvocationTool(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateToolParams', () => {
    it('should return null for valid parameters', () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'test-agent',
            message: 'Test message',
          },
        ],
      };

      const result = tool.validateToolParams(params);
      expect(result).toBeNull();
    });

    it('should return error for missing agents array', () => {
      const params = {} as IMultiAgentInvocationParameters;

      const result = tool.validateToolParams(params);
      expect(result).toBe('Agents array parameter is required and must not be empty');
    });

    it('should return error for empty agents array', () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [],
      };

      const result = tool.validateToolParams(params);
      expect(result).toBe('Agents array parameter is required and must not be empty');
    });

    it('should return error for agent without name', () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: '',
            message: 'Test message',
          },
        ],
      };

      const result = tool.validateToolParams(params);
      expect(result).toBe('Agent name is required for agent at index 0');
    });

    it('should return error for agent without message', () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'test-agent',
            message: '',
          },
        ],
      };

      const result = tool.validateToolParams(params);
      expect(result).toBe('Message is required and cannot be empty for agent \'test-agent\' at index 0');
    });

    it('should return error for agent with whitespace-only message', () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'test-agent',
            message: '   ',
          },
        ],
      };

      const result = tool.validateToolParams(params);
      expect(result).toBe('Message is required and cannot be empty for agent \'test-agent\' at index 0');
    });
  });

  describe('getDescription', () => {
    it('should return formatted description for single agent', () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'test-agent',
            message: 'Test message',
          },
        ],
      };

      const result = tool.getDescription(params);
      expect(result).toBe(
        '**Invoke 1 Agents in Parallel**:\n\n- test-agent\n\nThis will send messages to 1 agents in parallel and return aggregated results.'
      );
    });

    it('should return formatted description for multiple agents with methods', () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'research-agent',
            method: 'research',
            message: 'Research AI developments',
          },
          {
            agentName: 'analysis-agent',
            method: 'analyze',
            message: 'Analyze the data',
          },
        ],
      };

      const result = tool.getDescription(params);
      expect(result).toBe(
        '**Invoke 2 Agents in Parallel**:\n\n- research-agent (research)\n- analysis-agent (analyze)\n\nThis will send messages to 2 agents in parallel and return aggregated results.'
      );
    });
  });

  describe('execute', () => {
    let mockAgentLoaderInstance: any;
    let mockAgentChatInstance: any;
    let mockResponse: GenerateContentResponse;

    beforeEach(() => {
      // Setup mocks for successful execution
      mockResponse = {
        text: 'Agent response text',
        candidates: [
          {
            content: {
              parts: [{ text: 'Agent response text' }],
              role: 'model',
            },
          },
        ],
      };

      mockAgentLoaderInstance = {
        loadAgentConfig: vi.fn().mockResolvedValue(mockAgentConfig),
      };
      mockAgentLoader.mockImplementation(() => mockAgentLoaderInstance);

      mockCreateContentGenerator.mockResolvedValue(mockContentGenerator);

      mockAgentChatInstance = {
        sendMessage: vi.fn().mockResolvedValue(mockResponse),
      };
      mockAgentChat.mockImplementation(() => mockAgentChatInstance);
    });

    it('should successfully execute single agent', async () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'test-agent',
            message: 'Test message',
            taskDescription: 'Test task',
          },
        ],
      };

      const result = await tool.execute(params, mockAbortSignal);

      expect(result.summary).toBe('Invoked 1 agents: 1 successful, 0 failed');
      expect(result.llmContent).toContain('"totalAgents": 1');
      expect(result.llmContent).toContain('"successful": 1');
      expect(result.llmContent).toContain('"failed": 0');
      expect(result.returnDisplay).toContain('✅ Success');
    });

    it('should successfully execute multiple agents in parallel', async () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'agent1',
            message: 'Message 1',
          },
          {
            agentName: 'agent2',
            message: 'Message 2',
            method: 'analyze',
          },
        ],
      };

      const result = await tool.execute(params, mockAbortSignal);

      expect(result.summary).toBe('Invoked 2 agents: 2 successful, 0 failed');
      expect(result.llmContent).toContain('"totalAgents": 2');
      expect(result.llmContent).toContain('"successful": 2');
      expect(result.llmContent).toContain('"failed": 0');
      expect(result.returnDisplay).toContain('- **agent1**: ✅ Success');
      expect(result.returnDisplay).toContain('- **agent2**: ✅ Success');
    });

    it('should handle agent not found error', async () => {
      mockAgentLoaderInstance.loadAgentConfig.mockRejectedValue(new Error('Agent not found'));

      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'nonexistent-agent',
            message: 'Test message',
          },
        ],
      };

      const result = await tool.execute(params, mockAbortSignal);

      expect(result.summary).toBe('Invoked 1 agents: 0 successful, 1 failed');
      expect(result.llmContent).toContain('"successful": 0');
      expect(result.llmContent).toContain('"failed": 1');
      expect(result.returnDisplay).toContain('❌ Failed');
    });

    it('should handle invalid method error', async () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'test-agent',
            method: 'invalid-method',
            message: 'Test message',
          },
        ],
      };

      const result = await tool.execute(params, mockAbortSignal);

      expect(result.summary).toBe('Invoked 1 agents: 0 successful, 1 failed');
      expect(result.llmContent).toContain('"failed": 1');
      expect(result.returnDisplay).toContain('❌ Failed');
      expect(result.returnDisplay).toContain('invalid-method');
    });

    it('should handle agent execution error', async () => {
      mockAgentChatInstance.sendMessage.mockRejectedValue(new Error('Agent execution failed'));

      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'test-agent',
            message: 'Test message',
          },
        ],
      };

      const result = await tool.execute(params, mockAbortSignal);

      expect(result.summary).toBe('Invoked 1 agents: 0 successful, 1 failed');
      expect(result.llmContent).toContain('"failed": 1');
      expect(result.returnDisplay).toContain('❌ Failed');
      expect(result.returnDisplay).toContain('Agent execution failed');
    });

    it('should handle mixed success and failure', async () => {
      mockAgentLoaderInstance.loadAgentConfig
        .mockResolvedValueOnce(mockAgentConfig)  // First agent succeeds
        .mockRejectedValueOnce(new Error('Second agent not found'));  // Second agent fails

      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'good-agent',
            message: 'Test message 1',
          },
          {
            agentName: 'bad-agent',
            message: 'Test message 2',
          },
        ],
      };

      const result = await tool.execute(params, mockAbortSignal);

      expect(result.summary).toBe('Invoked 2 agents: 1 successful, 1 failed');
      expect(result.llmContent).toContain('"successful": 1');
      expect(result.llmContent).toContain('"failed": 1');
      expect(result.returnDisplay).toContain('✅ Success');
      expect(result.returnDisplay).toContain('❌ Failed');
    });

    it('should include execution metadata in results', async () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'test-agent',
            message: 'Test message',
            additionalParams: { param1: 'value1' },
            metadata: { meta1: 'metavalue1' },
          },
        ],
        executionId: 'custom-execution-id',
        currentExecutionId: 'parent-execution-id',
      };

      const result = await tool.execute(params, mockAbortSignal);

      const parsedResult = JSON.parse(result.llmContent);
      expect(parsedResult.executionSummary.parentExecutionId).toBe('parent-execution-id');
      expect(parsedResult.results[0].childExecutionId).toContain('custom-execution-id-agent-0');
    });

    it('should generate execution ID when not provided', async () => {
      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'test-agent',
            message: 'Test message',
          },
        ],
      };

      const result = await tool.execute(params, mockAbortSignal);

      const parsedResult = JSON.parse(result.llmContent);
      expect(parsedResult.results[0].childExecutionId).toMatch(/gemini-agent-exec-\d+-[a-z0-9]+/);
    });

    it('should return validation error for invalid params', async () => {
      const params = {} as IMultiAgentInvocationParameters;

      const result = await tool.execute(params, mockAbortSignal);

      expect(result.llmContent).toContain('"success":false');
      expect(result.llmContent).toContain('Agents array parameter is required and must not be empty');
      expect(result.returnDisplay).toContain('Error: Agents array parameter is required and must not be empty');
    });

    it('should handle timeout scenarios gracefully', async () => {
      // Mock a long-running agent operation
      mockAgentChatInstance.sendMessage.mockImplementation(() => 
        new Promise((resolve) => setTimeout(() => resolve({
          text: 'Delayed response',
          candidates: [{ content: { parts: [{ text: 'Delayed response' }], role: 'model' } }]
        }), 100))
      );

      const params: IMultiAgentInvocationParameters = {
        agents: [
          {
            agentName: 'slow-agent',
            message: 'This might take a while',
          },
        ],
      };

      const result = await tool.execute(params, mockAbortSignal);
      expect(result.summary).toBe('Invoked 1 agents: 1 successful, 0 failed');
    });

    it('should handle large number of agents', async () => {
      const agents = Array.from({ length: 5 }, (_, i) => ({
        agentName: `agent-${i}`,
        message: `Message for agent ${i}`,
      }));

      const params: IMultiAgentInvocationParameters = { agents };

      const result = await tool.execute(params, mockAbortSignal);
      expect(result.summary).toBe('Invoked 5 agents: 5 successful, 0 failed');
    });
  });

  describe('tool metadata', () => {
    it('should have correct tool name', () => {
      expect(AgentInvocationTool.Name).toBe('invoke_agents');
      expect(tool.name).toBe('invoke_agents');
    });

    it('should have correct display name', () => {
      expect(tool.displayName).toBe('Invoke Agents');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Invokes multiple agents in parallel');
    });

    it('should have proper schema', () => {
      expect(tool.schema.name).toBe('invoke_agents');
      expect(tool.schema.description).toContain('Invokes multiple agents in parallel');
      expect(tool.schema.parameters).toBeDefined();
    });
  });
});