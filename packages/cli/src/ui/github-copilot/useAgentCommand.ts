/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useMemo } from 'react';
import { Config, AgentLoader } from '@google/gemini-cli-core';
import { type HistoryItem, MessageType } from '../types.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { switchAgent } from './agentUtils.js';

interface UseAgentCommandReturn {
  isAgentDialogOpen: boolean;
  openAgentDialog: () => void;
  handleAgentSelect: (agentName: string) => void;
  availableAgents: Array<{ name: string; description: string }>;
}

export const useAgentCommand = (
  config: Config | null,
  settings: LoadedSettings,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
): UseAgentCommandReturn => {
  const [isAgentDialogOpen, setIsAgentDialogOpen] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<Array<{ name: string; description: string }>>([]);

  const loadAvailableAgents = useCallback(async () => {
    if (!config) return;

    try {
      const configsDir = config.getAgentConfigsDir();
      const agentLoader = new AgentLoader(configsDir);
      const agentNames = await agentLoader.listAvailableAgents();
      
      const agents = [
        { name: 'default', description: 'Default Gemini chat' }
      ];

      for (const agentName of agentNames) {
        try {
          const agentConfig = await agentLoader.loadAgentConfig(agentName);
          agents.push({
            name: agentName,
            description: agentConfig.description || agentName
          });
        } catch (error) {
          // If we can't load the config, just add the name
          agents.push({
            name: agentName,
            description: agentName
          });
        }
      }

      setAvailableAgents(agents);
    } catch (error) {
      console.warn('Failed to load available agents:', error);
      setAvailableAgents([{ name: 'default', description: 'Default Gemini chat' }]);
    }
  }, [config]);

  const openAgentDialog = useCallback(async () => {
    await loadAvailableAgents();
    setIsAgentDialogOpen(true);
  }, [loadAvailableAgents]);

  const handleAgentSelect = useCallback(
    async (selectedAgent: string) => {
      if (!config) {
        return;
      }

      const previousAgent = config.getCurrentAgent() || 'default';
      
      // Switch to the requested agent
      await switchAgent(config, selectedAgent);
      
      // Save the selected agent to user settings
      settings.setValue(SettingScope.User, 'selectedAgent', selectedAgent);

      // Close the dialog
      setIsAgentDialogOpen(false);

      // Add success message to history
      addItem(
        {
          type: MessageType.INFO,
          text: `✅ Agent switched from ${previousAgent} to ${selectedAgent}`,
        },
        Date.now(),
      );
    },
    [config, settings, addItem],
  );

  const memoizedAgents = useMemo(() => availableAgents, [availableAgents]);

  return {
    isAgentDialogOpen,
    openAgentDialog,
    handleAgentSelect,
    availableAgents: memoizedAgents,
  };
};