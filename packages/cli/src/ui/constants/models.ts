/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Available models - Gemini, GPT, and Claude models
export const AVAILABLE_MODELS = [
  'gemini-2.5-pro',
  'gpt-4.1',
  'gpt-4o',
  'claude-sonnet-4',
  'claude-opus-4',
] as const;

export type ModelName = typeof AVAILABLE_MODELS[number];
