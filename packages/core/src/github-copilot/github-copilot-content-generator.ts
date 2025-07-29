/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { GitHubCopilotTokenManager } from './github-copilot-auth.js';
import { 
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse
} from '@google/genai';
import { ContentGenerator } from '../core/contentGenerator.js';
import { Config } from '../config/config.js';
import { OpenAIContentGenerator } from './openaiContentGenerator.js';
import OpenAI from 'openai';

/**
 * A ContentGenerator implementation that uses the OpenAI generator with GitHub Copilot endpoint and auth
 */
export class GitHubCopilotGeminiServer extends OpenAIContentGenerator {
  private tokenManager: GitHubCopilotTokenManager;

  constructor(tokenManager: GitHubCopilotTokenManager, config: Config) {
    // Use GitHub Copilot endpoint and dummy key (auth handled by headers)
    super('dummy-key', config.getModel() || 'gpt-4', config);
    this.tokenManager = tokenManager;
    
    // Update the client to use GitHub Copilot endpoint
    (this as any).client = new OpenAI({
      apiKey: 'dummy-key', // Not used due to auth header override
      baseURL: 'https://api.githubcopilot.com',
    });
  }

  /**
   * Override to provide GitHub Copilot Bearer token and required headers
   */
  protected async getAdditionalHeaders(): Promise<Record<string, string> | undefined> {
    const tokenInfo = await this.tokenManager.getCachedOrFreshToken();
    if (!tokenInfo) {
      throw new Error('Failed to get GitHub Copilot bearer token');
    }

    return {
      'Authorization': `Bearer ${tokenInfo.token}`,
      'Editor-Version': `${(this.tokenManager as any).config.editorName}/${(this.tokenManager as any).config.editorVersion}`,
      'Content-Type': 'application/json'
    };
  }

  async embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse> {
    // GitHub Copilot authentication may not support embedding endpoints
    throw new Error('Content embedding is not supported with GitHub Copilot authentication');
  }
}

/**
 * Creates a ContentGenerator that uses GitHub Copilot authentication
 * to access the GitHub Copilot chat completions API using the OpenAI generator
 */
export async function createGitHubCopilotContentGenerator(
  config: Config
): Promise<ContentGenerator> {
  // Get GitHub token using the device flow or from file/env
  const githubToken = await GitHubCopilotTokenManager.getGitHubToken(true);
  
  if (!githubToken) {
    throw new Error('Failed to obtain GitHub token for Copilot authentication');
  }

  const tokenManager = new GitHubCopilotTokenManager({ token: githubToken });
  
  // Validate the token
  const isValid = await tokenManager.validateToken();
  if (!isValid) {
    throw new Error('Invalid GitHub token provided');
  }

  // Test if we can get a Copilot bearer token
  const copilotTokenInfo = await tokenManager.getCopilotToken();
  if (!copilotTokenInfo) {
    throw new Error('Failed to obtain Copilot bearer token');
  }

  const currentModel = config.getModel() || 'gpt-4';
  console.log(`GitHub Copilot content generator initialized successfully with model: ${currentModel}`);
  return new GitHubCopilotGeminiServer(tokenManager, config);
} 