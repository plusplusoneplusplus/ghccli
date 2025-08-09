/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { TaskClientSelector, LlmTask } from './TaskClientSelector.js';
import { ClientRegistry, type ClientProfile } from './ClientRegistry.js';
import type { LlmClient } from './index.js';

describe('TaskClientSelector', () => {
  const mockClient: LlmClient = {
    getAuthType: vi.fn(),
    getModel: vi.fn(),
    generateContent: vi.fn(),
    generateJson: vi.fn(),
  } as unknown as LlmClient;

  const createGeminiClient = vi.fn().mockReturnValue(mockClient);

  const profiles: Record<string, ClientProfile> = {
    primary: { provider: 'gemini', model: 'gemini-pro' },
    light: { provider: 'gemini', model: 'gemini-1.5-flash' },
  };

  const registry = new ClientRegistry({
    resolveProfile: (key) => profiles[key],
    createGeminiClient,
  });

  it('falls back to primary when no override exists', () => {
    const selector = new TaskClientSelector({
      registry,
      resolveTaskProfileKey: () => undefined,
    });
    const client = selector.getClientFor(LlmTask.NEXT_SPEAKER);
    expect(client).toBe(mockClient);
    expect(createGeminiClient).toHaveBeenCalledWith({ provider: 'gemini', model: 'gemini-pro' });
  });

  it('returns overridden client when task mapping exists', () => {
    const selector = new TaskClientSelector({
      registry,
      resolveTaskProfileKey: (task) => (task === LlmTask.LIGHTWEIGHT_SUMMARY ? 'light' : 'primary'),
    });
    const client = selector.getClientFor(LlmTask.LIGHTWEIGHT_SUMMARY);
    expect(client).toBe(mockClient);
    expect(createGeminiClient).toHaveBeenCalledWith({ provider: 'gemini', model: 'gemini-1.5-flash' });
  });

  it('getModelFor returns profile model when present, otherwise uses defaultResolver', () => {
    const selector = new TaskClientSelector({
      registry,
      resolveTaskProfileKey: (task) => (task === LlmTask.LIGHTWEIGHT_SUMMARY ? 'light' : 'missing'),
      resolveProfile: (key) => profiles[key],
    });

    const model1 = selector.getModelFor(LlmTask.LIGHTWEIGHT_SUMMARY, () => 'fallback-model');
    expect(model1).toBe('gemini-1.5-flash');

    const model2 = selector.getModelFor(LlmTask.NEXT_SPEAKER, () => 'fallback-model');
    expect(model2).toBe('fallback-model');
  });
});


