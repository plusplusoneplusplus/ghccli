/**
 * @license
 * Copyright 2025 Google LLC
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
      {} as never // config
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

    it('should normalize function names with dots and restore them in responses', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'my_tool_with_dots',
                    arguments: '{"query": "test"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
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
                      name: 'my.tool.with.dots',
                      description: 'Tool with dots in name',
                      parametersJsonSchema: {
                        type: 'object',
                        properties: {
                          query: { type: 'string' },
                        },
                      },
                    },
                  ],
                }),
            } as unknown as CallableTool,
          ],
        },
      };

      const result = await generator.generateContent(request);

      // Verify the tool was normalized when sent to OpenAI
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              function: expect.objectContaining({
                name: 'my_tool_with_dots',
              }),
            }),
          ],
        }),
      );

      // Verify the original function name is restored in the response
      expect(result.candidates?.[0]?.content?.parts?.[0]).toEqual({
        functionCall: {
          id: 'call_1',
          name: 'my.tool.with.dots',
          args: { query: 'test' },
        },
      });
    });

    it('should clear tool call state between requests', async () => {
      const mockResponse1 = {
        id: 'chatcmpl-123',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'first_tool_name',
                    arguments: '{}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        created: 1677652288,
        model: 'gpt-4',
      };

      const mockResponse2 = {
        id: 'chatcmpl-124',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_2',
                  type: 'function',
                  function: {
                    name: 'second_tool_name',
                    arguments: '{}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        created: 1677652289,
        model: 'gpt-4',
      };

      mockOpenAIClient.chat.completions.create
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2);

      const request1: GenerateContentParameters = {
        contents: [{ role: 'user', parts: [{ text: 'Test 1' }] }],
        model: 'gpt-4',
        config: {
          tools: [
            {
              callTool: vi.fn(),
              tool: () =>
                Promise.resolve({
                  functionDeclarations: [
                    {
                      name: 'first.tool.name',
                      description: 'First tool',
                      parametersJsonSchema: { type: 'object' },
                    },
                  ],
                }),
            } as unknown as CallableTool,
          ],
        },
      };

      const request2: GenerateContentParameters = {
        contents: [{ role: 'user', parts: [{ text: 'Test 2' }] }],
        model: 'gpt-4',
        config: {
          tools: [
            {
              callTool: vi.fn(),
              tool: () =>
                Promise.resolve({
                  functionDeclarations: [
                    {
                      name: 'second.tool.name',
                      description: 'Second tool',
                      parametersJsonSchema: { type: 'object' },
                    },
                  ],
                }),
            } as unknown as CallableTool,
          ],
        },
      };

      // First request
      const result1 = await generator.generateContent(request1);
      expect(result1.candidates?.[0]?.content?.parts?.[0]).toEqual({
        functionCall: {
          id: 'call_1',
          name: 'first.tool.name',
          args: {},
        },
      });

      // Second request should have clean state
      const result2 = await generator.generateContent(request2);
      expect(result2.candidates?.[0]?.content?.parts?.[0]).toEqual({
        functionCall: {
          id: 'call_2',
          name: 'second.tool.name',
          args: {},
        },
      });
    });

    it('should handle multiple dots in function names', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'deeply_nested_tool_name',
                    arguments: '{}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
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
                      name: 'deeply.nested.tool.name',
                      description: 'Tool with multiple dots',
                      parametersJsonSchema: { type: 'object' },
                    },
                  ],
                }),
            } as unknown as CallableTool,
          ],
        },
      };

      const result = await generator.generateContent(request);

      // Verify all dots were replaced with underscores when sent to OpenAI
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              function: expect.objectContaining({
                name: 'deeply_nested_tool_name',
              }),
            }),
          ],
        }),
      );

      // Verify the original function name with all dots is restored
      expect(result.candidates?.[0]?.content?.parts?.[0]).toEqual({
        functionCall: {
          id: 'call_1',
          name: 'deeply.nested.tool.name',
          args: {},
        },
      });
    });
  });

  describe('streaming functionality', () => {
    it('should normalize function names in streaming responses', async () => {
      const mockStreamResponse = {
        async *[Symbol.asyncIterator]() {
          yield {
            id: 'chatcmpl-123',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'streamed_tool_name',
                        arguments: '',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
            created: 1677652288,
            model: 'gpt-4',
          };
          yield {
            id: 'chatcmpl-123',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        arguments: '{"query": "test"}',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
            created: 1677652288,
            model: 'gpt-4',
          };
          yield {
            id: 'chatcmpl-123',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'tool_calls',
              },
            ],
            created: 1677652288,
            model: 'gpt-4',
          };
        },
      };

      mockOpenAIClient.chat.completions.create.mockResolvedValue(mockStreamResponse);

      const request: GenerateContentParameters = {
        contents: [{ role: 'user', parts: [{ text: 'Test streaming' }] }],
        model: 'gpt-4',
        config: {
          tools: [
            {
              callTool: vi.fn(),
              tool: () =>
                Promise.resolve({
                  functionDeclarations: [
                    {
                      name: 'streamed.tool.name',
                      description: 'Streaming tool with dots',
                      parametersJsonSchema: {
                        type: 'object',
                        properties: {
                          query: { type: 'string' },
                        },
                      },
                    },
                  ],
                }),
            } as unknown as CallableTool,
          ],
        },
      };

      const streamGenerator = await generator.generateContentStream(request);
      const responses = [];
      
      for await (const response of streamGenerator) {
        responses.push(response);
      }

      // Find the response with the completed function call
      const finalResponse = responses.find(
        r => r.candidates?.[0]?.content?.parts?.some(p => 'functionCall' in p)
      );

      expect(finalResponse?.candidates?.[0]?.content?.parts?.[0]).toEqual({
        functionCall: {
          id: 'call_1',
          name: 'streamed.tool.name',
          args: { query: 'test' },
        },
      });
    });
  });
});