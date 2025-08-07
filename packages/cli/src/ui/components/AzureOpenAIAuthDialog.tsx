/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';

interface AzureOpenAIAuthDialogProps {
  onApply: (scope: SettingScope) => void;
  onCancel: () => void;
  settings: LoadedSettings;
}

export function AzureOpenAIAuthDialog({ onApply, onCancel, settings }: AzureOpenAIAuthDialogProps): React.JSX.Element {
  const defaults = useMemo(() => ({
    key: process.env.AZURE_OPENAI_API_KEY || '',
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '',
    version: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
  }), []);

  const canApply = !!(defaults.key && defaults.endpoint && defaults.deployment);

  return (
    <Box borderStyle="round" borderColor={Colors.Gray} flexDirection="column" padding={1} width="100%">
      <Text bold>Azure OpenAI Setup</Text>
      <Box marginTop={1}><Text>Provide settings via environment variables (recommended):</Text></Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={defaults.key ? Colors.AccentGreen : Colors.AccentRed}>AZURE_OPENAI_API_KEY: {defaults.key ? 'detected' : 'missing'}</Text>
        <Text color={defaults.endpoint ? Colors.AccentGreen : Colors.AccentRed}>AZURE_OPENAI_ENDPOINT: {defaults.endpoint || 'missing'}</Text>
        <Text color={defaults.deployment ? Colors.AccentGreen : Colors.AccentRed}>AZURE_OPENAI_DEPLOYMENT_NAME: {defaults.deployment || 'missing'}</Text>
        <Text color={defaults.version ? Colors.AccentGreen : Colors.AccentRed}>AZURE_OPENAI_API_VERSION: {defaults.version}</Text>
      </Box>
      <Box marginTop={1}><Text color={Colors.Gray}>Tip: Add these to your .env or shell profile.</Text></Box>
      <Box marginTop={1} flexDirection="row">
        <Text>
          {canApply ? '[Enter] Use detected settings   ' : ''}
          [Esc] Cancel
        </Text>
      </Box>
    </Box>
  );
}


