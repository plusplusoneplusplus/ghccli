/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { AgentSelector } from './AgentSelector.js';

interface AgentDialogProps {
  isOpen: boolean;
  onExit: () => void;
  agents: Array<{ name: string; description: string }>;
  currentAgent: string;
  onAgentSelect: (agent: string) => void;
}

export const AgentDialog: React.FC<AgentDialogProps> = ({
  isOpen,
  onExit,
  agents,
  currentAgent,
  onAgentSelect,
}) => {
  const handleAgentSelect = (selectedAgent: string) => {
    onAgentSelect(selectedAgent);
    onExit(); // Close the dialog after selection
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      <Text bold>Agent Selection</Text>
      <Box marginTop={1}>
        <Text>Choose an AI agent to use for your conversations:</Text>
      </Box>
      <Box marginTop={1}>
        <AgentSelector
          agents={agents}
          currentAgent={currentAgent}
          onSelect={handleAgentSelect}
        />
      </Box>
    </Box>
  );
};