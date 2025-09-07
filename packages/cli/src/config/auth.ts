/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@google/gemini-cli-core';
import { loadEnvironment } from './settings.js';

export const validateAuthMethod = (authMethod: string): string | null => {
  loadEnvironment();
  if (
    authMethod === AuthType.LOGIN_WITH_GOOGLE ||
    authMethod === AuthType.CLOUD_SHELL
  ) {
    return 'This authentication method has been disabled for privacy reasons. Please use Gemini API Key, Vertex AI, or GitHub Copilot instead.';
  }

  if (authMethod === AuthType.USE_GEMINI) {
    if (!process.env['GEMINI_API_KEY']) {
      return 'GEMINI_API_KEY environment variable not found. Add that to your environment and try again (no reload needed if using .env)!';
    }
    return null;
  }

  if (authMethod === AuthType.USE_VERTEX_AI) {
    const hasVertexProjectLocationConfig =
      !!process.env['GOOGLE_CLOUD_PROJECT'] &&
      !!process.env['GOOGLE_CLOUD_LOCATION'];
    const hasGoogleApiKey = !!process.env['GOOGLE_API_KEY'];
    if (!hasVertexProjectLocationConfig && !hasGoogleApiKey) {
      return (
        'When using Vertex AI, you must specify either:\n' +
        '• GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables.\n' +
        '• GOOGLE_API_KEY environment variable (if using express mode).\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  if (authMethod === AuthType.GITHUB_COPILOT) {
    // GitHub Copilot authentication can use:
    // 1. GITHUB_TOKEN or GITHUB_COPILOT_TOKEN environment variable
    // 2. Stored token file in ~/.gemini/.github_token
    // 3. Interactive OAuth device flow (no validation needed)
    // Check for GitHub token - currently not used but kept for reference
    // !!(process.env['GITHUB_TOKEN'] || process.env['GITHUB_COPILOT_TOKEN']);
    
    // For now, we don't require environment variables since the auth module
    // can handle device flow authentication interactively
    return null;
  }

  // Azure OpenAI (API key)
  if (authMethod === AuthType.AZURE_OPENAI) {
    const hasKey = !!process.env['AZURE_OPENAI_API_KEY'];
    const hasEndpoint = !!process.env['AZURE_OPENAI_ENDPOINT'];
    const hasDeployment = !!process.env['AZURE_OPENAI_DEPLOYMENT_NAME'];
    if (!hasKey || !hasEndpoint || !hasDeployment) {
      return (
        'When using Azure OpenAI, you must specify:\n' +
        '• AZURE_OPENAI_API_KEY\n' +
        '• AZURE_OPENAI_ENDPOINT (e.g., https://your-resource.openai.azure.com)\n' +
        '• AZURE_OPENAI_DEPLOYMENT_NAME (deployment name)\n' +
        'Optionally: AZURE_OPENAI_API_VERSION (defaults to 2024-02-15-preview).'
      );
    }
    return null;
  }

  return 'Invalid auth method selected.';
};
