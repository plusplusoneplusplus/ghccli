/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  GoogleGenAI,
} from '@google/genai';
import { createCodeAssistContentGenerator } from '../code_assist/codeAssist.js';
import { createGitHubCopilotContentGenerator } from '../github-copilot/github-copilot-content-generator.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';
import { Config } from '../config/config.js';

import { UserTierId } from '../code_assist/types.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { getInstallationId } from '../utils/user_id.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  userTier?: UserTierId;
}

export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  CLOUD_SHELL = 'cloud-shell',
  GITHUB_COPILOT = 'github-copilot',
  OPENAI = 'openai',
  AZURE_OPENAI = 'azure-openai',
}

export type ContentGeneratorConfig = {
  model: string;
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType | undefined;
  proxy?: string | undefined;
  timeout?: number;
  maxRetries?: number;
  enableOpenAILogging?: boolean;
  // Azure OpenAI specific options
  azureEndpoint?: string;
  azureApiVersion?: string;
  azureDeploymentName?: string;
  samplingParams?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    top_k?: number;
    repetition_penalty?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
  };
};

export function createContentGeneratorConfig(
  config: Config,
  authType: AuthType | undefined,
): ContentGeneratorConfig {
  const geminiApiKey = process.env['GEMINI_API_KEY'] || undefined;
  const googleApiKey = process.env['GOOGLE_API_KEY'] || undefined;
  const googleCloudProject = process.env['GOOGLE_CLOUD_PROJECT'] || undefined;
  const googleCloudLocation = process.env['GOOGLE_CLOUD_LOCATION'] || undefined;
  const openaiApiKey = process.env['OPENAI_API_KEY'] || undefined;
  const azureApiKey = process.env['AZURE_OPENAI_API_KEY'] || undefined;
  const azureEndpoint = process.env['AZURE_OPENAI_ENDPOINT'] || undefined;
  const azureDeploymentName = process.env['AZURE_OPENAI_DEPLOYMENT_NAME'] || undefined;
  const azureApiVersion = process.env['AZURE_OPENAI_API_VERSION'] || '2024-02-15-preview';

  // Use runtime model from config if available; otherwise, fall back to parameter or default
  // For OpenAI, use OPENAI_MODEL env var or default to gpt-4 if no model specified
  let effectiveModel = config.getModel() || DEFAULT_GEMINI_MODEL;
  if (authType === AuthType.OPENAI) {
    effectiveModel = config.getModel() || process.env['OPENAI_MODEL'] || 'gpt-4o';
  }
  if (authType === AuthType.AZURE_OPENAI) {
    // For Azure, the "model" field corresponds to the deployment name used in the path
    effectiveModel = azureDeploymentName || config.getModel() || 'azure-deployment';
  }

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
    proxy: config?.getProxy(),
    enableOpenAILogging: config?.getEnableOpenAILogging() ?? true,
  };

  // If we are using Google auth or Cloud Shell, these are now disabled for privacy reasons
  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.CLOUD_SHELL
  ) {
    throw new Error('LOGIN_WITH_GOOGLE and CLOUD_SHELL authentication methods have been disabled for privacy reasons. Please use GEMINI_API_KEY, VERTEX_AI, GITHUB_COPILOT, or OPENAI instead.');
  }

  // If we are using GitHub Copilot, there is nothing else to validate for now
  if (authType === AuthType.GITHUB_COPILOT) {
    return contentGeneratorConfig;
  }

  // If we are using OpenAI, validate the API key
  if (authType === AuthType.OPENAI) {
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required for OpenAI authentication');
    }
    contentGeneratorConfig.apiKey = openaiApiKey;
    return contentGeneratorConfig;
  }

  // If we are using Azure OpenAI (API key only for now)
  if (authType === AuthType.AZURE_OPENAI) {
    if (!azureApiKey) {
      throw new Error('AZURE_OPENAI_API_KEY environment variable is required for Azure OpenAI authentication');
    }
    if (!azureEndpoint) {
      throw new Error('AZURE_OPENAI_ENDPOINT environment variable is required for Azure OpenAI');
    }
    if (!azureDeploymentName) {
      throw new Error('AZURE_OPENAI_DEPLOYMENT_NAME environment variable is required for Azure OpenAI');
    }
    contentGeneratorConfig.apiKey = azureApiKey;
    contentGeneratorConfig.azureEndpoint = azureEndpoint;
    contentGeneratorConfig.azureDeploymentName = azureDeploymentName;
    contentGeneratorConfig.azureApiVersion = azureApiVersion;
    return contentGeneratorConfig;
  }

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    contentGeneratorConfig.vertexai = false;

    return contentGeneratorConfig;
  }

  if (
    authType === AuthType.USE_VERTEX_AI &&
    (googleApiKey || (googleCloudProject && googleCloudLocation))
  ) {
    contentGeneratorConfig.apiKey = googleApiKey;
    contentGeneratorConfig.vertexai = true;

    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  const version = process.env['CLI_VERSION'] || process.version;
  const userAgent = `GeminiCLI/${version} (${process.platform}; ${process.arch})`;
  const baseHeaders: Record<string, string> = {
    'User-Agent': userAgent,
  };

  if (
    config.authType === AuthType.LOGIN_WITH_GOOGLE ||
    config.authType === AuthType.CLOUD_SHELL
  ) {
    const httpOptions = { headers: baseHeaders };
    return new LoggingContentGenerator(
      await createCodeAssistContentGenerator(
        httpOptions,
        config.authType,
        gcConfig,
        sessionId,
      ),
      gcConfig,
    );
  }

  if (config.authType === AuthType.GITHUB_COPILOT) {
    const copilotModels = await createGitHubCopilotContentGenerator(gcConfig);
    return copilotModels;
  }

  if (config.authType === AuthType.OPENAI) {
    const { OpenAIContentGenerator } = await import('../github-copilot/openaiContentGenerator.js');
    return new OpenAIContentGenerator(config.apiKey!, config.model, gcConfig);
  }

  if (config.authType === AuthType.AZURE_OPENAI) {
    const { AzureOpenAIContentGenerator } = await import('../github-copilot/azureOpenAIContentGenerator.js');
    if (!config.azureEndpoint || !config.azureApiVersion) {
      throw new Error('Azure OpenAI configuration missing endpoint or apiVersion');
    }
    return new AzureOpenAIContentGenerator(
      config.apiKey!,
      config.azureDeploymentName || config.model,
      gcConfig,
      { endpoint: config.azureEndpoint, apiVersion: config.azureApiVersion },
    );
  }

  if (
    config.authType === AuthType.USE_GEMINI ||
    config.authType === AuthType.USE_VERTEX_AI
  ) {
    let headers: Record<string, string> = { ...baseHeaders };
    if (gcConfig?.getUsageStatisticsEnabled()) {
      const installationId = getInstallationId();
      headers = {
        ...headers,
        'x-gemini-api-privileged-user-id': `${installationId}`,
      };
    }
    const httpOptions = { headers };

    const googleGenAI = new GoogleGenAI({
      apiKey: config.apiKey === '' ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });
    return new LoggingContentGenerator(googleGenAI.models, gcConfig);
  }
  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}
