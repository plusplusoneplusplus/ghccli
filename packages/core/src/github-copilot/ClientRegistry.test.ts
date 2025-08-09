/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientRegistry, type ClientProfile } from './ClientRegistry.js';
import type { LlmClient } from './index.js';

describe('ClientRegistry', () => {
  let mockClient: LlmClient;
  let createGeminiClient: (profile: ClientProfile) => LlmClient;
  let registry: ClientRegistry;

  beforeEach(() => {
    mockClient = {
      getAuthType: vi.fn(),
      getModel: vi.fn(),
      generateContent: vi.fn(),
      generateJson: vi.fn(),
    } as unknown as LlmClient;

    createGeminiClient = vi.fn().mockReturnValue(mockClient);

    registry = new ClientRegistry({
      resolveProfile: (key) => {
        if (key === 'primary') return { provider: 'gemini' };
        if (key === 'unsupported') return { provider: 'openai' } as ClientProfile;
        return undefined;
      },
      createGeminiClient,
    });
  });

  it('returns same instance for repeated getClient calls (caching)', () => {
    const a = registry.getClient('primary');
    const b = registry.getClient('primary');
    expect(a).toBe(b);
    expect(createGeminiClient).toHaveBeenCalledTimes(1);
  });

  it('clears cache for a specific key and recreates on next call', () => {
    registry.getClient('primary');
    registry.clear('primary');
    registry.getClient('primary');
    expect(createGeminiClient).toHaveBeenCalledTimes(2);
  });

  it('clears entire cache when called without key', () => {
    registry.getClient('primary');
    registry.clear();
    registry.getClient('primary');
    expect(createGeminiClient).toHaveBeenCalledTimes(2);
  });

  it('throws on missing profile', () => {
    expect(() => registry.getClient('missing')).toThrowError(
      'Profile not found: missing',
    );
  });

  it('warns and falls back for unsupported providers', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = registry.getClient('unsupported');
    expect(client).toBe(mockClient);
    warnSpy.mockRestore();
  });
});


