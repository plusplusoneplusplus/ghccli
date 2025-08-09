/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlmClient } from './index.js';
import { createLogger } from '../utils/logging.js';

const logger = createLogger('ClientRegistry');

export type ClientProviderId = 'gemini' | 'openai' | 'openrouter';

export interface ClientProfile {
  provider: ClientProviderId;
  model?: string;
  profileName?: string;
}

export type ClientProfileKey = string;

export interface ClientRegistryOptions {
  resolveProfile: (key: ClientProfileKey) => ClientProfile | undefined;
  /**
   * Optional factory used to construct a Gemini-backed LlmClient.
   * If omitted, getClient will throw for 'gemini' provider as we cannot
   * safely create a concrete client without access to the runtime Config.
   */
  createGeminiClient?: (profile: ClientProfile) => LlmClient;
}

export class ClientRegistry {
  private readonly cache = new Map<ClientProfileKey, LlmClient>();
  private readonly resolveProfile: (key: ClientProfileKey) => ClientProfile | undefined;
  private readonly createGeminiClient?: (profile: ClientProfile) => LlmClient;

  constructor(options: ClientRegistryOptions) {
    this.resolveProfile = options.resolveProfile;
    this.createGeminiClient = options.createGeminiClient;
  }

  getClient(key: ClientProfileKey): LlmClient {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const profile = this.resolveProfile(key);
    if (!profile) {
      throw new Error(`Profile not found: ${key}`);
    }

    const client = this.getOrCreateClient(profile);
    this.cache.set(key, client);
    return client;
  }

  getOrCreateClient(profile: ClientProfile): LlmClient {
    switch (profile.provider) {
      case 'gemini': {
        if (!this.createGeminiClient) {
          throw new Error('Missing credentials for provider: gemini');
        }
        return this.createGeminiClient(profile);
      }
      case 'openai':
      case 'openrouter':
        logger.warn(
          `Provider '${profile.provider}' not yet supported. Falling back to 'gemini' if available.`,
        );
        if (!this.createGeminiClient) {
          // No fallback path available
          throw new Error(`Missing credentials for provider: ${profile.provider}`);
        }
        return this.createGeminiClient({ provider: 'gemini', model: profile.model });
      default:
        logger.warn(
          `Unknown provider '${(profile as { provider: string }).provider}'. Falling back to 'gemini' if available.`,
        );
        if (!this.createGeminiClient) {
          throw new Error('Missing credentials for provider: gemini');
        }
        return this.createGeminiClient({ provider: 'gemini', model: profile.model });
    }
  }

  clear(key?: ClientProfileKey): void {
    if (typeof key === 'string') {
      this.cache.delete(key);
      return;
    }
    this.cache.clear();
  }
}


