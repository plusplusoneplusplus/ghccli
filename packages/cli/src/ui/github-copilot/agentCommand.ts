/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  SlashCommandActionReturn,
  CommandContext,
  CommandKind,
} from '../commands/types.js';
import { AgentLoader } from '@google/gemini-cli-core';
import { switchAgent } from './agentUtils.js';
import { SettingScope } from '../../config/settings.js';

export const agentCommand: SlashCommand = {
  name: 'agent',
  description: 'switch AI agents interactively (/agent) or directly (/agent <name>)',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const { config, settings } = context.services;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Config not loaded.',
      };
    }

    const trimmedArgs = args.trim();

    // If no arguments, show interactive agent selector dialog
    if (!trimmedArgs) {
      return {
        type: 'dialog',
        dialog: 'agent',
      };
    }

    // Get available agents
    const configsDir = config.getAgentConfigsDir();
    const agentLoader = new AgentLoader(configsDir);
    
    try {
      const availableAgents = await agentLoader.listAvailableAgents();
      
      // Add 'default' as an option to switch back to regular GeminiChat
      const allAgents = ['default', ...availableAgents];

      // Check if the requested agent is available
      if (!allAgents.includes(trimmedArgs)) {
        let message = `❌ Unknown agent: ${trimmedArgs}\n\n`;
        message += '📋 Available agents:\n';
        allAgents.forEach((agent) => {
          const description = agent === 'default' ? 'Default Gemini chat' : agent;
          message += `   ${agent} - ${description}\n`;
        });

        return {
          type: 'message',
          messageType: 'error',
          content: message,
        };
      }

      // Get current agent name
      const currentAgent = config.getCurrentAgent() || 'default';
      
      // Switch to the requested agent
      await switchAgent(config, trimmedArgs);

      // Save the selected agent to user settings
      if (settings) {
        settings.setValue(SettingScope.User, 'selectedAgent', trimmedArgs);
      }

      return {
        type: 'message',
        messageType: 'info',
        content: `✅ Switched from ${currentAgent} to ${trimmedArgs}`,
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `❌ Failed to load agents: ${error}`,
      };
    }
  },
  completion: async (
    context: CommandContext,
    partialArg: string,
  ): Promise<string[]> => {
    const { config } = context.services;
    if (!config) {
      return [];
    }

    try {
      const configsDir = config.getAgentConfigsDir();
      const agentLoader = new AgentLoader(configsDir);
      const availableAgents = await agentLoader.listAvailableAgents();
      const allAgents = ['default', ...availableAgents];
      
      // Provide autocompletion for agent names
      return allAgents.filter((agent) =>
        agent.toLowerCase().startsWith(partialArg.toLowerCase()),
      );
    } catch {
      return ['default'];
    }
  },
};