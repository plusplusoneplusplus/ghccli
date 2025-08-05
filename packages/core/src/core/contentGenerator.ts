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
import { getEffectiveModel } from './modelCheck.js';
import { UserTierId } from '../code_assist/types.js';

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
  const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  const googleApiKey = process.env.GOOGLE_API_KEY || undefined;
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT || undefined;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION || undefined;
  const openaiApiKey = process.env.OPENAI_API_KEY || undefined;

  // Use runtime model from config if available; otherwise, fall back to parameter or default
  // For OpenAI, use OPENAI_MODEL env var or default to gpt-4 if no model specified
  let effectiveModel = config.getModel() || DEFAULT_GEMINI_MODEL;
  if (authType === AuthType.OPENAI) {
    effectiveModel = config.getModel() || process.env.OPENAI_MODEL || 'gpt-4';
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

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;
    contentGeneratorConfig.vertexai = false;
    getEffectiveModel(
      contentGeneratorConfig.apiKey,
      contentGeneratorConfig.model,
      contentGeneratorConfig.proxy,
    );

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
  const version = process.env.CLI_VERSION || process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `GeminiCLI/${version} (${process.platform}; ${process.arch})`,
    },
  };
  if (
    config.authType === AuthType.LOGIN_WITH_GOOGLE ||
    config.authType === AuthType.CLOUD_SHELL
  ) {
    throw new Error('LOGIN_WITH_GOOGLE and CLOUD_SHELL authentication methods have been disabled for privacy reasons. Please use GEMINI_API_KEY, VERTEX_AI, GITHUB_COPILOT, or OPENAI instead.');
  }

  if (config.authType === AuthType.GITHUB_COPILOT) {
    const copilotModels = await createGitHubCopilotContentGenerator(gcConfig);
    return copilotModels;
  }

  if (config.authType === AuthType.OPENAI) {
    const { OpenAIContentGenerator } = await import('../github-copilot/openaiContentGenerator.js');
    return new OpenAIContentGenerator(config.apiKey!, config.model, gcConfig);
  }

  if (
    config.authType === AuthType.USE_GEMINI ||
    config.authType === AuthType.USE_VERTEX_AI
  ) {
    const googleGenAI = new GoogleGenAI({
      apiKey: config.apiKey === '' ? undefined : config.apiKey,
      vertexai: config.vertexai,
      httpOptions,
    });

    return googleGenAI.models;
  }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}
