/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { ModelSelector } from './modelSelector.js';

interface ModelDialogProps {
  isOpen: boolean;
  onExit: () => void;
  models: string[];
  currentModel: string;
  onModelSelect: (model: string) => void;
}

export const ModelDialog: React.FC<ModelDialogProps> = ({
  isOpen,
  onExit,
  models,
  currentModel,
  onModelSelect,
}) => {
  const handleModelSelect = (selectedModel: string) => {
    onModelSelect(selectedModel);
    onExit(); // Close the dialog after selection
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold>Model Selection</Text>
      <Box marginTop={1}>
        <Text>Choose an AI model to use for your conversations:</Text>
      </Box>
      <Box marginTop={1}>
        <ModelSelector
          models={models}
          currentModel={currentModel}
          onSelect={handleModelSelect}
        />
      </Box>
    </Box>
  );
};
