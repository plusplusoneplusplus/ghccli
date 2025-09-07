/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { Config } from '@google/gemini-cli-core';
import { type HistoryItem, MessageType } from '../types.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';

interface UseModelCommandReturn {
  isModelDialogOpen: boolean;
  openModelDialog: () => void;
  handleModelSelect: (modelName: string) => void;
}

export const useModelCommand = (
  config: Config | null,
  settings: LoadedSettings,
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
): UseModelCommandReturn => {
  const [isModelDialogOpen, setIsModelDialogOpen] = useState(false);

  const openModelDialog = useCallback(() => {
    setIsModelDialogOpen(true);
  }, []);

  const handleModelSelect = useCallback(
    async (selectedModel: string) => {
      if (!config) {
        return;
      }

      const previousModel = config.getModel();
      config.setModel(selectedModel);
      
      // Save the selected model to user settings
      settings.setValue(SettingScope.User, 'selectedModel', selectedModel);

      // Update the Gemini client with the new model
      const geminiClient = config.getGeminiClient();
      if (geminiClient) {
        try {
          // The client will use the updated model from config.getModel()
          await geminiClient.setHistory(geminiClient.getHistory());
        } catch (error) {
          // Handle error silently as this is not critical
          console.warn('Failed to update client history:', error);
        }
      }

      // Close the dialog
      setIsModelDialogOpen(false);

      // Add success message to history
      addItem(
        {
          type: MessageType.INFO,
          text: `✅ Model switched from ${previousModel} to ${selectedModel}`,
        },
        Date.now(),
      );
    },
    [config, settings, addItem],
  );

  return {
    isModelDialogOpen,
    openModelDialog,
    handleModelSelect,
  };
};
