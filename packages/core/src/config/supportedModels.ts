/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

// Available models - Gemini, GPT, and Claude models
export const AVAILABLE_MODELS = [
  'gemini-2.5-pro',
  'gpt-5',
  'gpt-4.1',
  'gpt-4o',
  'claude-sonnet-4',
  'claude-opus-4',
] as const;

export type ModelName = typeof AVAILABLE_MODELS[number];

/**
 * Checks if a model is available/supported
 */
export function isModelAvailable(model: string): model is ModelName {
  return AVAILABLE_MODELS.includes(model as ModelName);
}