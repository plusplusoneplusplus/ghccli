/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { createContentGenerator, AuthType } from './contentGenerator.js';
import { Config } from '../config/config.js';

const mockConfig = {} as unknown as Config;

const AzureCtorSpy = vi.fn();
vi.mock('../github-copilot/azureOpenAIContentGenerator.js', () => ({
  AzureOpenAIContentGenerator: vi.fn().mockImplementation((...args: unknown[]) => {
    AzureCtorSpy(...args);
    return { __kind: 'azure' } as unknown;
  }),
}));

describe('createContentGenerator - Azure OpenAI (key auth)', () => {
  it('constructs AzureOpenAIContentGenerator with correct params', async () => {
    const cfg = {
      model: 'gpt-4o-deploy',
      apiKey: 'azure-key',
      authType: AuthType.AZURE_OPENAI,
      azureEndpoint: 'https://example.openai.azure.com',
      azureApiVersion: '2024-02-15-preview',
      azureDeploymentName: 'gpt-4o-deploy',
    } as const;

    const gen = await createContentGenerator(cfg as any, mockConfig);
    expect((gen as any).__kind).toBe('azure');

    expect(AzureCtorSpy).toHaveBeenCalledWith(
      'azure-key',
      'gpt-4o-deploy',
      mockConfig,
      { endpoint: 'https://example.openai.azure.com', apiVersion: '2024-02-15-preview' },
    );
  });
});


