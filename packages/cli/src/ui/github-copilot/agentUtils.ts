/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@google/gemini-cli-core';

export async function switchAgent(config: Config, newAgent: string): Promise<void> {
  // Switch to the new agent
  config.setCurrentAgent(newAgent === 'default' ? null : newAgent);

  // Reset the chat client when switching agents
  const geminiClient = config.getGeminiClient();
  if (geminiClient) {
    await geminiClient.resetChat();
  }
}