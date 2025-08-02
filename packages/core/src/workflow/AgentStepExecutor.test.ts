/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentStepExecutor, AgentStepExecutorConfig } from './AgentStepExecutor.js';
import { WorkflowStep, AgentConfig } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';
import { Config } from '../config/config.js';

// Mock the dependencies
vi.mock('../agents/agentLoader.js');
vi.mock('../core/contentGenerator.js');
vi.mock('../core/logger.js');
vi.mock('../agents/agentChat.js');
vi.mock('../core/coreToolScheduler.js');

describe('AgentStepExecutor', () => {
  let executor: AgentStepExecutor;
  let mockConfig: Config;
  let mockContext: WorkflowContext;
  let executorConfig: AgentStepExecutorConfig;

  beforeEach(() => {
    // Create mock config
    mockConfig = {
      getAgentConfigsDir: vi.fn().mockReturnValue(['/mock/agents']),
      getContentGeneratorConfig: vi.fn().mockReturnValue({}),
      getSessionId: vi.fn().mockReturnValue('test-session'),
      getToolRegistry: vi.fn().mockReturnValue({
        getFunctionDeclarations: vi.fn().mockReturnValue([]),
        getFilteredFunctionDeclarationsWithBlocking: vi.fn().mockReturnValue([])
      })
    } as any;

    // Create mock context
    mockContext = {
      log: vi.fn(),
      getVariables: vi.fn().mockReturnValue({ env: 'test', version: '1.0' }),
      getStepOutput: vi.fn().mockReturnValue({ result: 'previous-step-result' }),
      getWorkflowId: vi.fn().mockReturnValue('test-workflow-123')
    } as any;

    executorConfig = {
      config: mockConfig,
      agentConfigsDir: ['/test/agents'],
      defaultTimeout: 30000,
      maxRounds: 5
    };

    executor = new AgentStepExecutor(executorConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with config', () => {
      expect(executor).toBeDefined();
      expect(executor.getSupportedType()).toBe('agent');
    });
  });

  describe('getSupportedType', () => {
    it('should return "agent"', () => {
      expect(executor.getSupportedType()).toBe('agent');
    });
  });

  describe('canExecute', () => {
    it('should return true for agent type steps', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent',
          prompt: 'Test prompt'
        } as AgentConfig
      };

      expect(executor.canExecute(step)).toBe(true);
    });

    it('should return false for non-agent type steps', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'script',
        config: {
          command: 'echo test'
        } as any
      };

      expect(executor.canExecute(step)).toBe(false);
    });
  });

  describe('validate', () => {
    it('should validate correct agent step configuration', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent',
          prompt: 'Test prompt',
          parameters: { param1: 'value1' },
          timeout: 5000
        } as AgentConfig
      };

      const result = executor.validate(step);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid step type', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'script',
        config: {
          agent: 'test-agent'
        } as any
      };

      const result = executor.validate(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Invalid step type: expected 'agent', got 'script'");
    });

    it('should reject missing agent name', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          prompt: 'Test prompt'
        } as any
      };

      const result = executor.validate(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Agent step must specify an agent');
    });

    it('should reject non-string agent name', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 123,
          prompt: 'Test prompt'
        } as any
      };

      const result = executor.validate(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Agent name must be a string');
    });

    it('should reject non-string prompt', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent',
          prompt: 123
        } as any
      };

      const result = executor.validate(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Agent prompt must be a string');
    });

    it('should reject invalid timeout', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent',
          timeout: -1
        } as any
      };

      const result = executor.validate(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Agent timeout must be a positive number');
    });

    it('should reject non-object parameters', () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent',
          parameters: 'invalid'
        } as any
      };

      const result = executor.validate(step);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Agent parameters must be an object');
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      // Mock the AgentLoader
      const { AgentLoader } = vi.mocked(await import('../agents/agentLoader.js'));
      const mockAgentLoader = {
        loadAgentConfig: vi.fn().mockResolvedValue({
          name: 'Test Agent',
          description: 'Test agent description',
          methods: ['default'],
          availableAgents: [],
          metadata: {
            supportsStreaming: true,
            supportsTools: true,
            requiresWorkspace: false,
            supportsPromptSelection: false,
            languageModel: { preferred: 'gemini-1.5-pro' },
            promptSupport: {
              supportsPrompts: true,
              supportsTsxMessages: false,
              promptParameterName: 'prompt',
              variableResolution: true
            },
            specialization: 'general',
            executionConfig: {
              maxRounds: 10,
              maxContextTokens: 32000
            },
            toolPreferences: {
              allowedToolRegex: [],
              blockedToolsRegex: []
            }
          },
          systemPrompt: {
            type: 'content',
            value: 'You are a helpful assistant.'
          }
        })
      };
(AgentLoader as any).mockImplementation(() => mockAgentLoader);

      // Mock createContentGenerator
      const { createContentGenerator } = vi.mocked(await import('../core/contentGenerator.js'));
      createContentGenerator.mockResolvedValue({} as any);

      // Mock AgentChat
      const { AgentChat } = vi.mocked(await import('../agents/agentChat.js'));
      const mockAgentChat = {
        sendMessageStream: vi.fn().mockResolvedValue([
          {
            candidates: [{
              content: {
                parts: [{ text: 'Test agent response' }]
              }
            }]
          }
        ]),
        getHistory: vi.fn().mockReturnValue([])
      };
      AgentChat.fromAgentConfig = vi.fn().mockResolvedValue(mockAgentChat);

      // Mock Logger
      const { Logger } = vi.mocked(await import('../core/logger.js'));
      const mockLogger = {
        initialize: vi.fn().mockResolvedValue(undefined),
        saveCheckpoint: vi.fn().mockResolvedValue(undefined)
      };
      (Logger as any).mockImplementation(() => mockLogger);
    });

    it('should execute agent step successfully', async () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent',
          prompt: 'Test prompt with {{env}} environment',
          parameters: { param1: 'value1' }
        } as AgentConfig
      };

      const result = await executor.execute(step, mockContext);

      expect(result).toBeDefined();
      expect(result.agentId).toBe('test-agent');
      expect(result.response).toBeDefined();
      expect(typeof result.executionTime).toBe('number');
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
      expect(result.metadata).toMatchObject({
        prompt: 'Test prompt with {{env}} environment',
        parameters: { param1: 'value1' }
      });
    });

    it('should handle execution errors gracefully', async () => {
      const agentLoaderModule = await import('../agents/agentLoader.js');
      const { AgentLoader } = vi.mocked(agentLoaderModule);
      const mockAgentLoader = {
        loadAgentConfig: vi.fn().mockRejectedValue(new Error('Agent not found'))
      };
(AgentLoader as any).mockImplementation(() => mockAgentLoader);

      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'non-existent-agent',
          prompt: 'Test prompt'
        } as AgentConfig
      };

      await expect(executor.execute(step, mockContext)).rejects.toThrow('Agent execution failed: Agent not found');
    });
  });

  describe('beforeExecute', () => {
    it('should log execution details', async () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent',
          prompt: 'Test prompt with variables: {{env}}',
          parameters: { param1: 'value1' },
          timeout: 10000
        } as AgentConfig
      };

      await executor['beforeExecute'](step, mockContext);

      expect(mockContext.log).toHaveBeenCalledWith('Executing agent: test-agent');
      expect(mockContext.log).toHaveBeenCalledWith(expect.stringContaining('Resolved prompt:'));
      expect(mockContext.log).toHaveBeenCalledWith('Parameters: {\n  "param1": "value1"\n}');
      expect(mockContext.log).toHaveBeenCalledWith('Timeout: 10000ms');
    });

    it('should use default timeout when not specified', async () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent'
        } as AgentConfig
      };

      await executor['beforeExecute'](step, mockContext);

      expect(mockContext.log).toHaveBeenCalledWith('Timeout: 30000ms');
    });
  });

  describe('afterExecute', () => {
    it('should log completion details', async () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent'
        } as AgentConfig
      };

      const result = {
        agentId: 'test-agent',
        response: 'Test response',
        executionTime: 1500,
        metadata: {}
      };

      await executor['afterExecute'](step, mockContext, result);

      expect(mockContext.log).toHaveBeenCalledWith('Agent test-agent completed in 1500ms');
      expect(mockContext.log).toHaveBeenCalledWith(expect.stringContaining('Response:'));
    });
  });

  describe('onError', () => {
    it('should log error details', async () => {
      const step: WorkflowStep = {
        id: 'test-step',
        name: 'Test Step',
        type: 'agent',
        config: {
          agent: 'test-agent'
        } as AgentConfig
      };

      const error = new Error('Test error');

      await executor['onError'](step, mockContext, error);

      expect(mockContext.log).toHaveBeenCalledWith('Agent test-agent execution failed: Test error', 'error');
    });
  });

  describe('resolvePromptTemplate', () => {
    it('should resolve variable placeholders', () => {
      const prompt = 'Hello {{env}}, version {{version}}';
      const resolved = executor['resolvePromptTemplate'](prompt, mockContext);
      
      expect(resolved).toBe('Hello test, version 1.0');
    });

    it('should resolve step output placeholders', () => {
      const prompt = 'Previous result: {{steps.prev-step.result}}';
      const resolved = executor['resolvePromptTemplate'](prompt, mockContext);
      
      expect(resolved).toBe('Previous result: previous-step-result');
    });

    it('should leave unresolved placeholders unchanged', () => {
      const prompt = 'Hello {{nonexistent}}';
      const resolved = executor['resolvePromptTemplate'](prompt, mockContext);
      
      expect(resolved).toBe('Hello {{nonexistent}}');
    });

    it('should handle nested object properties', () => {
      mockContext.getVariables = vi.fn().mockReturnValue({
        config: { database: { host: 'localhost', port: 5432 } }
      });

      const prompt = 'Connect to {{config.database.host}}:{{config.database.port}}';
      const resolved = executor['resolvePromptTemplate'](prompt, mockContext);
      
      expect(resolved).toBe('Connect to localhost:5432');
    });
  });

  describe('getNestedValue', () => {
    it('should retrieve nested values', () => {
      const obj = {
        level1: {
          level2: {
            value: 'found'
          }
        }
      };

      const result = executor['getNestedValue'](obj, 'level1.level2.value');
      expect(result).toBe('found');
    });

    it('should return undefined for non-existent paths', () => {
      const obj = { a: { b: 'value' } };

      const result = executor['getNestedValue'](obj, 'a.c.d');
      expect(result).toBeUndefined();
    });

    it('should handle null and undefined objects', () => {
      expect(executor['getNestedValue'](null, 'a.b')).toBeUndefined();
      expect(executor['getNestedValue'](undefined, 'a.b')).toBeUndefined();
    });
  });
});