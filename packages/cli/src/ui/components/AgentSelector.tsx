/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';

interface Agent {
  name: string;
  description: string;
}

interface AgentSelectorProps {
  agents: Agent[];
  currentAgent: string;
  onSelect: (agent: string) => void;
}

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  agents,
  currentAgent,
  onSelect,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const currentIndex = agents.findIndex(agent => agent.name === currentAgent);
    return currentIndex >= 0 ? currentIndex : 0;
  });

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(prevIndex => 
        prevIndex === 0 ? agents.length - 1 : prevIndex - 1
      );
    } else if (key.downArrow) {
      setSelectedIndex(prevIndex => 
        prevIndex === agents.length - 1 ? 0 : prevIndex + 1
      );
    } else if (key.return) {
      onSelect(agents[selectedIndex].name);
    }
  });

  return (
    <Box flexDirection="column">
      {agents.map((agent, index) => (
        <Box key={agent.name} marginY={0}>
          <Text 
            color={index === selectedIndex ? Colors.AccentYellow : undefined}
            bold={index === selectedIndex}
          >
            {index === selectedIndex ? '▶ ' : '  '}
            {agent.name}
            {agent.name === currentAgent ? ' (current)' : ''}
          </Text>
          <Text 
            color={index === selectedIndex ? Colors.AccentYellow : Colors.Gray}
            dimColor={index !== selectedIndex}
          >
            {' - '}
            {agent.description}
          </Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>
          Use ↑/↓ to navigate, Enter to select
        </Text>
      </Box>
    </Box>
  );
};