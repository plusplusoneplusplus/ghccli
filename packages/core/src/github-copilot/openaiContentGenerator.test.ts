/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIContentGenerator } from './openaiContentGenerator.js';
import { GenerateContentParameters, CallableTool } from '@google/genai';

// Mock OpenAI
const mockOpenAIClient = {
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
};

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => mockOpenAIClient),
}));

describe('OpenAIContentGenerator', () => {
  let generator: OpenAIContentGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    generator = new OpenAIContentGenerator(
      'test-api-key',
      'gpt-4',
      {} as any // config
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('convertGeminiToolsToOpenAI', () => {
    it('should handle MCP tools with parametersJsonSchema', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        created: 1677652288,
        model: 'gpt-4',
      };

      mockOpenAIClient.chat.completions.create.mockResolvedValue(mockResponse);

      const request: GenerateContentParameters = {
        contents: [{ role: 'user', parts: [{ text: 'Test' }] }],
        model: 'gpt-4',
        config: {
          tools: [
            {
              callTool: vi.fn(),
              tool: () =>
                Promise.resolve({
                  functionDeclarations: [
                    {
                      name: 'list-items',
                      description: 'Get a list of items',
                      parametersJsonSchema: {
                        type: 'object',
                        properties: {
                          page_number: {
                            type: 'number',
                            description: 'Page number',
                          },
                          page_size: {
                            type: 'number',
                            description: 'Number of items per page',
                          },
                        },
                        additionalProperties: false,
                        $schema: 'http://json-schema.org/draft-07/schema#',
                      },
                    },
                  ],
                }),
            } as unknown as CallableTool,
          ],
        },
      };

      await generator.generateContent(request);

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              function: {
                name: 'list-items',
                description: 'Get a list of items',
                parameters: {
                  type: 'object',
                  properties: {
                    page_number: {
                      type: 'number',
                      description: 'Page number',
                    },
                    page_size: {
                      type: 'number',
                      description: 'Number of items per page',
                    },
                  },
                  additionalProperties: false,
                  $schema: 'http://json-schema.org/draft-07/schema#',
                },
              },
            },
          ],
        }),
      );
    });

    it('should handle Gemini tools with parameters field', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        created: 1677652288,
        model: 'gpt-4',
      };

      mockOpenAIClient.chat.completions.create.mockResolvedValue(mockResponse);

      const request: GenerateContentParameters = {
        contents: [{ role: 'user', parts: [{ text: 'Test' }] }],
        model: 'gpt-4',
        config: {
          tools: [
            {
              callTool: vi.fn(),
              tool: () =>
                Promise.resolve({
                  functionDeclarations: [
                    {
                      name: 'search',
                      description: 'Search for information',
                      parameters: {
                        type: 'OBJECT',
                        properties: {
                          query: {
                            type: 'STRING',
                            description: 'Search query',
                          },
                        },
                      },
                    },
                  ],
                }),
            } as unknown as CallableTool,
          ],
        },
      };

      await generator.generateContent(request);

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              function: {
                name: 'search',
                description: 'Search for information',
                parameters: {
                  type: 'object',
                  properties: {
                    query: {
                      type: 'string',
                      description: 'Search query',
                    },
                  },
                },
              },
            },
          ],
        }),
      );
    });
  });
});