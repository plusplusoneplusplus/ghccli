/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { AuthType } from '@google/gemini-cli-core';
import { validateAuthMethod } from '../../config/auth.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { GitHubCopilotAuthDialog, AzureOpenAIAuthDialog, type AzureOpenAIValues } from '../github-copilot/index.js';

interface AuthDialogProps {
  onSelect: (authMethod: AuthType | undefined, scope: SettingScope) => void;
  settings: LoadedSettings;
  initialErrorMessage?: string | null;
}

function parseDefaultAuthType(
  defaultAuthType: string | undefined,
): AuthType | null {
  if (
    defaultAuthType &&
    Object.values(AuthType).includes(defaultAuthType as AuthType)
  ) {
    return defaultAuthType as AuthType;
  }
  return null;
}

export function AuthDialog({
  onSelect,
  settings,
  initialErrorMessage,
}: AuthDialogProps): React.JSX.Element {
  const [showGitHubCopilotDialog, setShowGitHubCopilotDialog] = useState(false);
  const [showAzureDialog, setShowAzureDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(() => {
    if (initialErrorMessage) {
      return initialErrorMessage;
    }

    const defaultAuthType = parseDefaultAuthType(
      process.env['GEMINI_DEFAULT_AUTH_TYPE'],
    );

    if (process.env['GEMINI_DEFAULT_AUTH_TYPE'] && defaultAuthType === null) {
      return (
        `Invalid value for GEMINI_DEFAULT_AUTH_TYPE: "${process.env['GEMINI_DEFAULT_AUTH_TYPE']}". ` +
        `Valid values are: ${Object.values(AuthType).join(', ')}.`
      );
    }

    if (
      process.env['GEMINI_API_KEY'] &&
      (!defaultAuthType || defaultAuthType === AuthType.USE_GEMINI)
    ) {
      return 'Existing API key detected (GEMINI_API_KEY). Select "Gemini API Key" option to use it.';
    }
    return null;
  });
  const items = [
    {
      label: 'Use Gemini API Key',
      value: AuthType.USE_GEMINI,
    },
    { label: 'Vertex AI', value: AuthType.USE_VERTEX_AI },
    { label: 'GitHub Copilot', value: AuthType.GITHUB_COPILOT },
    { label: 'Azure OpenAI', value: AuthType.AZURE_OPENAI },
  ];

  const initialAuthIndex = items.findIndex((item) => {
    if (settings.merged.selectedAuthType) {
      return item.value === settings.merged.selectedAuthType;
    }

    const defaultAuthType = parseDefaultAuthType(
      process.env['GEMINI_DEFAULT_AUTH_TYPE'],
    );
    if (defaultAuthType) {
      return item.value === defaultAuthType;
    }

    if (process.env['GEMINI_API_KEY']) {
      return item.value === AuthType.USE_GEMINI;
    }

    return item.value === AuthType.GITHUB_COPILOT;
  });

  const handleAuthSelect = (authMethod: AuthType) => {
    if (authMethod === AuthType.GITHUB_COPILOT) {
      setShowGitHubCopilotDialog(true);
      return;
    }
    if (authMethod === AuthType.AZURE_OPENAI) {
      setShowAzureDialog(true);
      return;
    }
    
    const error = validateAuthMethod(authMethod);
    if (error) {
      setErrorMessage(error);
    } else {
      setErrorMessage(null);
      onSelect(authMethod, SettingScope.User);
    }
  };

  const handleGitHubCopilotSuccess = (token: string) => {
    // Token is already saved by the GitHubCopilotTokenManager
    setShowGitHubCopilotDialog(false);
    setErrorMessage(null);
    onSelect(AuthType.GITHUB_COPILOT, SettingScope.User);
  };

  const handleGitHubCopilotCancel = () => {
    setShowGitHubCopilotDialog(false);
  };

  const handleAzureApply = (values: AzureOpenAIValues, scope: SettingScope) => {
    // Persist to settings
    settings.setValue(scope, 'azureOpenAIEndpoint', values.endpoint);
    settings.setValue(scope, 'azureOpenAIDeploymentName', values.deployment);
    settings.setValue(scope, 'azureOpenAIAPIVersion', values.version);
    settings.setValue(scope, 'azureOpenAIAPIKey', values.key);

    // Also set process.env so validation and core pick them up immediately
    process.env['AZURE_OPENAI_ENDPOINT'] = values.endpoint;
    process.env['AZURE_OPENAI_DEPLOYMENT_NAME'] = values.deployment;
    process.env['AZURE_OPENAI_API_VERSION'] = values.version;
    process.env['AZURE_OPENAI_API_KEY'] = values.key;

    setShowAzureDialog(false);
    setErrorMessage(null);
    onSelect(AuthType.AZURE_OPENAI, scope);
  };

  const handleAzureCancel = () => {
    setShowAzureDialog(false);
  };

  const handleGitHubCopilotError = (error: string) => {
    setShowGitHubCopilotDialog(false);
    setErrorMessage(`GitHub Copilot authentication failed: ${error}`);
  };

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        // If GitHub Copilot dialog is showing, close it first
        if (showGitHubCopilotDialog) {
          setShowGitHubCopilotDialog(false);
          return;
        }

        // If Azure dialog is showing, close it first
        if (showAzureDialog) {
          setShowAzureDialog(false);
          return;
        }

        // Prevent exit if there is an error message.
        // This means they user is not authenticated yet.
        if (errorMessage) {
          return;
        }
        if (settings.merged.selectedAuthType === undefined) {
          // Prevent exiting if no auth method is set
          setErrorMessage(
            'You must select an auth method to proceed. Press Ctrl+C twice to exit.',
          );
          return;
        }
        onSelect(undefined, SettingScope.User);
      }
    },
    { isActive: true },
  );

  // Show GitHub Copilot dialog if requested
  if (showGitHubCopilotDialog) {
    return (
      <GitHubCopilotAuthDialog
        onSuccess={handleGitHubCopilotSuccess}
        onCancel={handleGitHubCopilotCancel}
        onError={handleGitHubCopilotError}
      />
    );
  }

  // Show Azure OpenAI dialog if requested
  if (showAzureDialog) {
    return (
      <AzureOpenAIAuthDialog
        onApply={handleAzureApply}
        onCancel={handleAzureCancel}
        settings={settings}
      />
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.Gray}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>Get started</Text>
      <Box marginTop={1}>
        <Text>How would you like to authenticate for this project?</Text>
      </Box>
      <Box marginTop={1}>
        <RadioButtonSelect
          items={items}
          initialIndex={initialAuthIndex}
          onSelect={handleAuthSelect}
          isFocused={true}
        />
      </Box>
      {errorMessage && (
        <Box marginTop={1}>
          <Text color={Colors.AccentRed}>{errorMessage}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={Colors.Gray}>(Use Enter to select)</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Terms of Services and Privacy Notice for Gemini CLI</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.AccentBlue}>
          {
            'https://github.com/google-gemini/gemini-cli/blob/main/docs/tos-privacy.md'
          }
        </Text>
      </Box>
    </Box>
  );
}
