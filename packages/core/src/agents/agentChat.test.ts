/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentChat } from './agentChat.js';
import { AgentLoader } from './agentLoader.js';
import { Config } from '../config/config.js';
import { ContentGenerator } from '../core/contentGenerator.js';
import * as path from 'node:path';

// Mock the Config and ContentGenerator
vi.mock('../config/config.js');
vi.mock('../core/contentGenerator.js');

// Mock the getCoreSystemPrompt function
vi.mock('../core/prompts.js', () => ({
  getCoreSystemPrompt: vi.fn(() => null),
}));

describe('AgentChat', () => {
  let mockConfig: Config;
  let mockContentGenerator: ContentGenerator;
  let configsDir: string;

  beforeEach(() => {
    mockConfig = {
      getUserMemory: vi.fn(() => null),
    } as any;
    mockContentGenerator = {} as ContentGenerator;
    configsDir = path.join(__dirname, 'configs');
  });

  describe('AgentLoader', () => {
    it('should correctly parse YAML configuration using yaml package', async () => {
      // Import YAML for direct testing
      const YAML = await import('yaml');
      
      // Test with a simple YAML structure
      const yamlContent = `
name: test-agent
description: Test agent description
methods: []
availableAgents:
  - research-sub-agent
metadata:
  supportsStreaming: false
  supportsTools: true
  requiresWorkspace: false
  supportsPromptSelection: false
  languageModel:
    preferred: gemini-2.5-pro
  promptSupport:
    supportsPrompts: true
    supportsTsxMessages: false
    promptParameterName: prompt
    variableResolution: false
  specialization: research
  executionConfig:
    maxRounds: 10
    maxContextTokens: 32000
systemPrompt:
  type: content
  value: "You are a test agent"
`;

      const config = YAML.parse(yamlContent);
      
      expect(config.name).toBe('test-agent');
      expect(config.description).toBe('Test agent description');
      expect(config.methods).toEqual([]);
      expect(config.availableAgents).toEqual(['research-sub-agent']);
      expect(config.metadata.supportsStreaming).toBe(false);
      expect(config.metadata.supportsTools).toBe(true);
      expect(config.metadata.languageModel.preferred).toBe('gemini-2.5-pro');
      expect(config.metadata.executionConfig.maxRounds).toBe(10);
      expect(config.metadata.executionConfig.maxContextTokens).toBe(32000);
      expect(config.systemPrompt.type).toBe('content');
      expect(config.systemPrompt.value).toBe('You are a test agent');
    });

    it('should handle arrays correctly', async () => {
      const YAML = await import('yaml');
      
      const yamlContent = `
availableAgents:
  - agent1
  - agent2
  - agent3
toolPreferences:
  allowedToolRegex:
    - ".*invoke_agents.*"
    - ".*web.*"
`;

      const config = YAML.parse(yamlContent);
      
      expect(config.availableAgents).toEqual(['agent1', 'agent2', 'agent3']);
      expect(config.toolPreferences.allowedToolRegex).toEqual([
        '.*invoke_agents.*',
        '.*web.*'
      ]);
    });

    it('should handle nested objects correctly', async () => {
      const YAML = await import('yaml');
      
      const yamlContent = `
metadata:
  languageModel:
    preferred: gemini-2.5-pro
  executionConfig:
    maxRounds: 10
    maxContextTokens: 32000
`;

      const config = YAML.parse(yamlContent);
      
      expect(config.metadata.languageModel.preferred).toBe('gemini-2.5-pro');
      expect(config.metadata.executionConfig.maxRounds).toBe(10);
      expect(config.metadata.executionConfig.maxContextTokens).toBe(32000);
    });
  });

  describe('AgentChat creation', () => {
    it('should create an instance with agent config', () => {
      const agentConfig = {
        name: 'test-agent',
        description: 'Test agent',
        methods: [],
        availableAgents: ['sub-agent'],
        metadata: {
          supportsStreaming: false,
          supportsTools: true,
          requiresWorkspace: false,
          supportsPromptSelection: false,
          languageModel: { preferred: 'gemini-2.5-pro' },
          promptSupport: {
            supportsPrompts: true,
            supportsTsxMessages: false,
            promptParameterName: 'prompt',
            variableResolution: false
          },
          specialization: 'research',
          executionConfig: {
            maxRounds: 10,
            maxContextTokens: 32000
          }
        },
        systemPrompt: {
          type: 'content' as const,
          value: 'You are a test agent'
        }
      };

      const chat = new AgentChat(
        mockConfig,
        mockContentGenerator,
        agentConfig
      );

      expect(chat.getAgentName()).toBe('test-agent');
      expect(chat.getAgentDescription()).toBe('Test agent');
      expect(chat.getSpecialization()).toBe('research');
      expect(chat.supportsStreaming()).toBe(false);
      expect(chat.supportsTools()).toBe(true);
      expect(chat.getMaxRounds()).toBe(10);
      expect(chat.getMaxContextTokens()).toBe(32000);
      expect(chat.getAvailableAgents()).toEqual(['sub-agent']);
    });
  });

  describe('System prompt generation', () => {
    it('should resolve variables in system prompt', () => {
      const agentConfig = {
        name: 'test-agent',
        description: 'Test agent',
        methods: [],
        availableAgents: ['agent1', 'agent2'],
        metadata: {
          supportsStreaming: false,
          supportsTools: true,
          requiresWorkspace: false,
          supportsPromptSelection: false,
          languageModel: { preferred: 'gemini-2.5-pro' },
          promptSupport: {
            supportsPrompts: true,
            supportsTsxMessages: false,
            promptParameterName: 'prompt',
            variableResolution: true
          },
          specialization: 'research',
          executionConfig: {
            maxRounds: 10,
            maxContextTokens: 32000
          }
        },
        systemPrompt: {
          type: 'content' as const,
          value: 'You are a {{.CurrentDate}} agent with agents:\n{{availableAgents}}'
        }
      };

      const chat = new AgentChat(
        mockConfig,
        mockContentGenerator,
        agentConfig
      );

      // Test the instance method through generateSystemPrompt
      const systemPrompt = (chat as any).generateSystemPrompt();
      
      expect(systemPrompt).toBeDefined();
      expect(systemPrompt.parts[0].text).toContain('agent with agents:\n- agent1\n- agent2');
      expect(systemPrompt.parts[0].text).toMatch(/You are a \d{4}-\d{2}-\d{2} agent/);
    });

    it('should generate system prompt from agent config', () => {
      const agentConfig = {
        name: 'test-agent',
        description: 'Test agent',
        methods: [],
        availableAgents: ['agent1'],
        metadata: {
          supportsStreaming: false,
          supportsTools: true,
          requiresWorkspace: false,
          supportsPromptSelection: false,
          languageModel: { preferred: 'gemini-2.5-pro' },
          promptSupport: {
            supportsPrompts: true,
            supportsTsxMessages: false,
            promptParameterName: 'prompt',
            variableResolution: false
          },
          specialization: 'research',
          executionConfig: {
            maxRounds: 10,
            maxContextTokens: 32000
          }
        },
        systemPrompt: {
          type: 'content' as const,
          value: 'You are a test agent'
        }
      };

      const chat = new AgentChat(
        mockConfig,
        mockContentGenerator,
        agentConfig
      );

      const systemPrompt = (chat as any).generateSystemPrompt();
      
      expect(systemPrompt).toBeDefined();
      expect(systemPrompt.role).toBe('system');
      expect(systemPrompt.parts[0].text).toBe('You are a test agent');
    });
  });
});