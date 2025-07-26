/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  SlashCommandActionReturn,
  CommandContext,
  CommandKind,
} from './types.js';
import { AVAILABLE_MODELS } from '../constants/models.js';

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'switch AI models interactively (/model) or directly (/model <name>)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const { config } = context.services;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Config not loaded.',
      };
    }

    const trimmedArgs = args.trim();

    // If no arguments, show interactive model selector dialog
    if (!trimmedArgs) {
      return {
        type: 'dialog',
        dialog: 'model',
      };
    }

    // Check if the requested model is available
    if (!AVAILABLE_MODELS.includes(trimmedArgs as any)) {
      let message = `❌ Unknown model: ${trimmedArgs}\n\n`;
      message += '📋 Available models:\n';
      AVAILABLE_MODELS.forEach((model) => {
        message += `   ${model}\n`;
      });

      return {
        type: 'message',
        messageType: 'error',
        content: message,
      };
    }

    // Switch to the requested model
    const previousModel = config.getModel();
    config.setModel(trimmedArgs);

    // Update the Gemini client with the new model
    const geminiClient = config.getGeminiClient();
    if (geminiClient) {
      // The client will use the updated model from config.getModel()
      await geminiClient.setHistory(geminiClient.getHistory());
    }

    return {
      type: 'message',
      messageType: 'info',
      content: `✅ Switched from ${previousModel} to ${trimmedArgs}`,
    };
  },
  completion: async (
    _context: CommandContext,
    partialArg: string,
  ): Promise<string[]> => {
    // Provide autocompletion for model names
    return AVAILABLE_MODELS.filter((model) =>
      model.toLowerCase().startsWith(partialArg.toLowerCase()),
    );
  },
};

