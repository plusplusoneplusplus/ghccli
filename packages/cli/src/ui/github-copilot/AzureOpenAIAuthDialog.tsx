/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Colors } from '../colors.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';

export interface AzureOpenAIValues {
  endpoint: string;
  deployment: string;
  version: string;
  key: string;
}

interface AzureOpenAIAuthDialogProps {
  onApply: (values: AzureOpenAIValues, scope: SettingScope) => void;
  onCancel: () => void;
  settings: LoadedSettings;
}

const LABEL_WIDTH = 14; // visual alignment for labels

export function AzureOpenAIAuthDialog({ onApply, onCancel, settings }: AzureOpenAIAuthDialogProps): React.JSX.Element {
  const defaults = useMemo(() => ({
    key:
      settings.merged.azureOpenAIAPIKey || process.env.AZURE_OPENAI_API_KEY || '',
    endpoint:
      settings.merged.azureOpenAIEndpoint || process.env.AZURE_OPENAI_ENDPOINT || '',
    deployment:
      settings.merged.azureOpenAIDeploymentName || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '',
    version:
      settings.merged.azureOpenAIAPIVersion || process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
  }), [settings.merged.azureOpenAIAPIKey, settings.merged.azureOpenAIEndpoint, settings.merged.azureOpenAIDeploymentName, settings.merged.azureOpenAIAPIVersion]);

  const [endpoint, setEndpoint] = useState(defaults.endpoint);
  const [deployment, setDeployment] = useState(defaults.deployment);
  const [version, setVersion] = useState(defaults.version);
  const [key, setKey] = useState(defaults.key);
  const [activeIndex, setActiveIndex] = useState(0); // 0..3 inputs, 4=Apply, 5=Cancel
  const [error, setError] = useState<string | null>(null);

  const canApply = !!(key && endpoint && deployment && version);

  const apply = useCallback(() => {
    if (!canApply) {
      setError('All fields are required.');
      return;
    }
    setError(null);
    onApply({ endpoint, deployment, version, key }, SettingScope.User);
  }, [canApply, endpoint, deployment, version, key, onApply]);

  useInput((_input, keypress) => {
    if (keypress.escape) {
      onCancel();
      return;
    }
    if (keypress.upArrow) {
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (keypress.downArrow) {
      setActiveIndex((i) => Math.min(5, i + 1));
    } else if (keypress.return) {
      if (activeIndex === 4) {
        apply();
      } else if (activeIndex === 5) {
        onCancel();
      }
    }
  });

  const renderLabel = (text: string) => (
    <Text color={Colors.Gray}>
      {text.padEnd(LABEL_WIDTH, ' ')}
    </Text>
  );

  return (
    <Box borderStyle="round" borderColor={Colors.Gray} flexDirection="column" padding={1} width="100%">
      <Text bold>Azure OpenAI Setup</Text>
      <Box marginTop={1}><Text>Enter your Azure OpenAI settings. Fields default from environment or saved settings.</Text></Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          {renderLabel('Endpoint')}
          <TextInput value={endpoint} onChange={setEndpoint} focus={activeIndex === 0} placeholder="https://your-resource.openai.azure.com" />
        </Box>
        <Box marginTop={1}>
          {renderLabel('Deployment')}
          <TextInput value={deployment} onChange={setDeployment} focus={activeIndex === 1} placeholder="your-deployment-name" />
        </Box>
        <Box marginTop={1}>
          {renderLabel('API version')}
          <TextInput value={version} onChange={setVersion} focus={activeIndex === 2} placeholder="2024-02-15-preview" />
        </Box>
        <Box marginTop={1}>
          {renderLabel('API key')}
          <TextInput value={key} onChange={setKey} focus={activeIndex === 3} mask="*" placeholder="sk-..." />
        </Box>
      </Box>

      {error && (
        <Box marginTop={1}><Text color={Colors.AccentRed}>{error}</Text></Box>
      )}

      <Box marginTop={1}>
        <Text color={Colors.Gray}>Use Up/Down to navigate. Enter to activate. Esc to cancel.</Text>
      </Box>

      <Box marginTop={1}>
        <Text>
          <Text color={activeIndex === 4 ? Colors.AccentBlue : Colors.Gray}>[Apply]</Text>
          <Text>  </Text>
          <Text color={activeIndex === 5 ? Colors.AccentBlue : Colors.Gray}>[Cancel]</Text>
        </Text>
      </Box>
    </Box>
  );
}

