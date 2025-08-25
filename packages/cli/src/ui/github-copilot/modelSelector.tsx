
import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

interface ModelSelectorProps {
  models: string[];
  currentModel: string;
  onSelect: (model: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  currentModel,
  onSelect,
}) => {
  const items = models.map((model) => ({
    label: model,
    value: model,
  }));

  // Find the initial index of the current model
  const initialIndex = models.findIndex(model => model === currentModel);

  return (
    <Box flexDirection="column">
      <Text>Select a model (use ↑/↓ arrows to navigate, Enter to select):</Text>
      <SelectInput
        items={items}
        initialIndex={initialIndex >= 0 ? initialIndex : 0}
        onSelect={(item) => onSelect(item.value)}
      />
    </Box>
  );
};
