/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '../core/contentGenerator.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_FLASH_LITE_MODEL = 'gemini-2.5-flash-lite';

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

// Lightweight model for summarization and nextSpeakerCheck tasks
export const LIGHTWEIGHT_MODEL = 'gpt-4o';

/**
 * Get the appropriate lightweight model based on the authentication type
 * @param authType The authentication type from content generator config
 * @returns The appropriate lightweight model
 */
export function getLightweightModel(authType?: AuthType): string {
  // For OpenAI/Github Copilot auth type, use gpt-4o as the lightweight model
  if (authType === AuthType.OPENAI || authType === AuthType.GITHUB_COPILOT) {
    return LIGHTWEIGHT_MODEL;
  }
  // For all other auth types (Gemini, GitHub Copilot, etc.), fall back to Flash Lite
  return DEFAULT_GEMINI_FLASH_LITE_MODEL;
}
