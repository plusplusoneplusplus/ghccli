/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubCopilotGeminiServer } from './github-copilot-content-generator.js';
import { Config } from '../config/config.js';

// Mock fetch globally
global.fetch = vi.fn();

// Mock the GitHubCopilotTokenManager
vi.mock('./github-copilot-auth.js', () => ({
  GitHubCopilotTokenManager: vi.fn().mockImplementation(() => ({
    getCachedOrFreshToken: vi.fn().mockResolvedValue({ token: 'mock-copilot-token' }),
    validateToken: vi.fn().mockResolvedValue(true),
    getCopilotToken: vi.fn().mockResolvedValue({ token: 'mock-copilot-token' }),
    getGitHubToken: vi.fn().mockResolvedValue('mock-github-token'),
  })),
}));

// Mock config
const mockConfig = {
  getModel: vi.fn().mockReturnValue('gemini-2.0-flash-exp'),
  getContentGeneratorConfig: vi.fn().mockReturnValue(undefined),
  getSessionId: vi.fn().mockReturnValue('test-session-id'),
  getOutputLoggerFile: vi.fn().mockReturnValue(undefined),
} as unknown as Config;


describe('GitHubCopilotGeminiServer - Integration Tests', () => {
  let server: GitHubCopilotGeminiServer;
  let mockTokenManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenManager = {
      getCachedOrFreshToken: vi.fn().mockResolvedValue({ token: 'mock-copilot-token' }),
      validateToken: vi.fn().mockResolvedValue(true),
      getCopilotToken: vi.fn().mockResolvedValue({ token: 'mock-copilot-token' }),
      getGitHubToken: vi.fn().mockResolvedValue('mock-github-token'),
      config: {
        editorName: 'test-editor',
        editorVersion: '1.0.0',
        pluginName: 'test-plugin', 
        pluginVersion: '1.0.0',
      }
    };
    server = new GitHubCopilotGeminiServer(mockTokenManager, mockConfig);
  });

  it('should create GitHubCopilotGeminiServer instance successfully', () => {
    expect(server).toBeInstanceOf(GitHubCopilotGeminiServer);
  });

  it('should have correct model configuration', () => {
    expect((server as any).model).toBe('gemini-2.0-flash-exp');
  });
});

describe('GitHubCopilotGeminiServer - Cache Control Tests', () => {
  let server: GitHubCopilotGeminiServer;
  let mockTokenManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenManager = {
      getCachedOrFreshToken: vi.fn().mockResolvedValue({ token: 'mock-copilot-token' }),
      validateToken: vi.fn().mockResolvedValue(true),
      getCopilotToken: vi.fn().mockResolvedValue({ token: 'mock-copilot-token' }),
      getGitHubToken: vi.fn().mockResolvedValue('mock-github-token'),
      config: {
        editorName: 'test-editor',
        editorVersion: '1.0.0',
        pluginName: 'test-plugin', 
        pluginVersion: '1.0.0',
      }
    };
    server = new GitHubCopilotGeminiServer(mockTokenManager, mockConfig);
  });

  describe('applyProviderSpecificTransforms with cache control', () => {
    it('should add copilot_cache_control only to the very last message regardless of role', () => {
      const baseMessages = [
        { role: 'system' as const, content: 'You are a helpful assistant.' },
        { role: 'user' as const, content: 'User message 1' },
        { role: 'assistant' as const, content: 'Assistant response 1' },
        { role: 'user' as const, content: 'User message 2' },
        { role: 'assistant' as const, content: 'Assistant response 2' },
      ];

      const result = (server as any).applyProviderSpecificTransforms(baseMessages);
      
      // Only the very last message should have cache control
      expect(result[result.length - 1]).toEqual({
        role: 'assistant',
        content: 'Assistant response 2',
        copilot_cache_control: { type: 'ephemeral' }
      });
      
      // All other messages should NOT have cache control
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]).not.toHaveProperty('copilot_cache_control');
      }
    });

    it('should handle tool calls with cache control correctly', () => {
      const messagesWithTools = [
        { role: 'user' as const, content: 'Search for information' },
        { 
          role: 'assistant' as const, 
          tool_calls: [{ id: 'call_1', type: 'function' as const, function: { name: 'search', arguments: '{}' } }] 
        },
        { role: 'tool' as const, content: 'Search results', tool_call_id: 'call_1' },
        { role: 'assistant' as const, content: 'Based on the search results...' },
      ];

      const result = (server as any).applyProviderSpecificTransforms(messagesWithTools);
      
      // Only the very last message should have cache control
      expect(result[result.length - 1]).toEqual({
        role: 'assistant',
        content: 'Based on the search results...',
        copilot_cache_control: { type: 'ephemeral' }
      });
      
      // Tool-related messages should not have cache control
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]).not.toHaveProperty('copilot_cache_control');
      }
    });

    it('should handle single user message correctly', () => {
      const singleMessage = [
        { role: 'user' as const, content: 'Hello, how are you?' }
      ];

      const result = (server as any).applyProviderSpecificTransforms(singleMessage);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: 'user',
        content: 'Hello, how are you?',
        copilot_cache_control: { type: 'ephemeral' }
      });
    });

    it('should handle empty messages array', () => {
      const emptyMessages: any[] = [];
      const result = (server as any).applyProviderSpecificTransforms(emptyMessages);
      expect(result).toEqual([]);
    });

    it('should handle multiple user messages correctly - only the very last message gets cached', () => {
      const multipleUserMessages = [
        { role: 'user' as const, content: 'First user message' },
        { role: 'user' as const, content: 'Second user message' },
        { role: 'user' as const, content: 'Third user message' }
      ];

      const result = (server as any).applyProviderSpecificTransforms(multipleUserMessages);
      
      expect(result).toHaveLength(3);
      
      // Only the last message should have cache control
      expect(result[2]).toEqual({
        role: 'user',
        content: 'Third user message',
        copilot_cache_control: { type: 'ephemeral' }
      });
      
      // First two messages should not have cache control
      expect(result[0]).not.toHaveProperty('copilot_cache_control');
      expect(result[1]).not.toHaveProperty('copilot_cache_control');
    });

    it('should handle tool response as last message correctly', () => {
      const messagesEndingWithTool = [
        { role: 'user' as const, content: 'Get the weather' },
        { 
          role: 'assistant' as const, 
          tool_calls: [{ id: 'call_weather', type: 'function' as const, function: { name: 'getWeather', arguments: '{}' } }] 
        },
        { role: 'tool' as const, content: 'Sunny, 75°F', tool_call_id: 'call_weather' }
      ];

      const result = (server as any).applyProviderSpecificTransforms(messagesEndingWithTool);
      
      // The tool response (last message) should get cache control
      expect(result[result.length - 1]).toEqual({
        role: 'tool',
        content: 'Sunny, 75°F',
        tool_call_id: 'call_weather',
        copilot_cache_control: { type: 'ephemeral' }
      });
      
      // Previous messages should not have cache control
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i]).not.toHaveProperty('copilot_cache_control');
      }
    });
  });

  describe('Base OpenAI generator behavior', () => {
    it('should not add cache control in base OpenAI implementation', async () => {
      // Import at runtime to avoid circular imports
      const { OpenAIContentGenerator } = await import('./openaiContentGenerator.js');
      const baseGenerator = new OpenAIContentGenerator('test-key', 'gpt-4', mockConfig);
      
      const messages = [
        { role: 'user' as const, content: 'Test message' }
      ];
      
      // Base implementation should not add cache control
      const baseResult = (baseGenerator as any).applyProviderSpecificTransforms?.(messages) || messages;
      expect(baseResult[0]).not.toHaveProperty('copilot_cache_control');
      
      // GitHub Copilot implementation should add cache control
      const copilotResult = (server as any).applyProviderSpecificTransforms(messages);
      expect(copilotResult[0]).toHaveProperty('copilot_cache_control');
    });
  });
});