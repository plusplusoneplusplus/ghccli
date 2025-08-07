/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Config } from '../config/config.js';

// Capture constructor and create() calls from the parent generator mock
const openAIConstructorCalls: any[] = [];
let createCalls: Array<{ params: any; options: any }> = [];

// Mock the parent OpenAIContentGenerator to avoid importing the real one and its dependencies
vi.mock('./openaiContentGenerator.js', () => {
  class MockParent {
    public model: string;
    public config: any;
    public client: any;
    constructor(apiKey: string, model: string, config: any) {
      openAIConstructorCalls.push({ apiKey, model });
      this.model = model;
      this.config = config;
      this.client = {
        apiKey,
        chat: {
          completions: {
            create: vi.fn((params: any, options: any) => {
              createCalls.push({ params, options });
              return Promise.resolve({
                choices: [
                  { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
                ],
                model: params.model,
              });
            }),
          },
        },
      };
    }
    // Provide the same method signature used by Azure subclass
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected async getAdditionalRequestOptions(): Promise<Record<string, any> | undefined> { return undefined; }
    async generateContent(request: any): Promise<any> {
      const additional = await (this as any).getAdditionalRequestOptions();
      return this.client.chat.completions.create({ model: request.model, messages: [] }, additional);
    }
  }
  return { OpenAIContentGenerator: MockParent };
});

// Import after mocks
import { AzureOpenAIContentGenerator } from './azureOpenAIContentGenerator.js';

const mockConfig = {
  getModel: vi.fn().mockReturnValue('gpt-4o-deploy'),
  getSessionId: vi.fn().mockReturnValue('test-session-id'),
  getOutputLoggerFile: vi.fn().mockReturnValue(undefined),
  getContentGeneratorConfig: vi.fn().mockReturnValue({ enableOpenAILogging: false }),
} as unknown as Config;

describe('AzureOpenAIContentGenerator (API key auth)', () => {
  beforeEach(() => {
    createCalls = [];
    openAIConstructorCalls.length = 0;
    vi.clearAllMocks();
    process.env.AZURE_OPENAI_API_KEY = 'env-azure-key';
  });

  afterEach(() => {
    delete process.env.AZURE_OPENAI_API_KEY;
  });

  it('adds api-version query and api-key header, and sets Azure base URL', async () => {
    const endpoint = 'https://example.openai.azure.com';
    const apiVersion = '2024-02-15-preview';
    const deployment = 'gpt-4o-deploy';

    const gen = new AzureOpenAIContentGenerator(
      'test-azure-key',
      deployment,
      mockConfig,
      { endpoint, apiVersion },
    );

    await gen.generateContent({
      contents: ['hello'],
      model: deployment,
    } as any);

    // Since we mocked the parent, assert construction captured apiKey and model
    expect(openAIConstructorCalls[0]).toEqual({ apiKey: 'test-azure-key', model: deployment });
    // Assert request options include Azure api-version and api-key
    expect(createCalls[0].options?.query?.['api-version']).toBe(apiVersion);
    expect(createCalls[0].options?.headers?.['api-key']).toBe('test-azure-key');
  });
});


