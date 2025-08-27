/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { GitHubCopilotTokenManager } from './github-copilot-auth.js';
import { 
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters
} from '@google/genai';
import { ContentGenerator } from '../core/contentGenerator.js';
import { Config } from '../config/config.js';
import { OpenAIContentGenerator } from './openaiContentGenerator.js';
import { getCoreSystemPrompt } from '../core/prompts.js';
import OpenAI from 'openai';
import { createLogger, LogLevel } from '../utils/logging.js';

const logger = createLogger('GitHubCopilotContentGenerator');
let globalTokenManager: GitHubCopilotTokenManager | null = null;

/**
 * A ContentGenerator implementation that uses the OpenAI generator with GitHub Copilot endpoint and auth
 */
export class GitHubCopilotGeminiServer extends OpenAIContentGenerator {
  private tokenManager: GitHubCopilotTokenManager;

  constructor(tokenManager: GitHubCopilotTokenManager, config: Config) {
    // Use GitHub Copilot endpoint and dummy key (auth handled by headers)
    super('dummy-key', config.getModel() || 'gpt-4.1', config);
    this.tokenManager = tokenManager;
    
    // Update the client to use GitHub Copilot endpoint
    (this as any).client = new OpenAI({
      apiKey: 'dummy-key', // Not used due to auth header override
      baseURL: 'https://api.githubcopilot.com',
    });
  }

  /**
   * Apply GitHub Copilot specific cache control strategy.
   * Only the very last message gets cache control for efficient prefix caching,
   * regardless of its role (user, assistant, tool, system).
   */
  protected override applyProviderSpecificTransforms(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
  ): Array<OpenAI.Chat.ChatCompletionMessageParam & { copilot_cache_control?: { type: 'ephemeral' } }> {
    if (messages.length === 0) return messages as any;

    // Copy messages without modifying the originals
    const messagesWithCache: Array<OpenAI.Chat.ChatCompletionMessageParam & { copilot_cache_control?: { type: 'ephemeral' } }> = 
      messages.map(msg => ({ ...msg }));

    // Add cache control to the very last message (regardless of role)
    // This creates a cache breakpoint at the latest message being sent
    if (messagesWithCache.length > 0) {
      const lastIndex = messagesWithCache.length - 1;
      messagesWithCache[lastIndex] = {
        ...messagesWithCache[lastIndex],
        copilot_cache_control: { type: 'ephemeral' as const }
      };
    }

    return messagesWithCache;
  }

  /**
   * Override to include getCoreSystemPrompt when converting to OpenAI format
   */
  protected override convertToOpenAIFormat(
    request: GenerateContentParameters,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    // First, add the core system prompt
    const coreSystemPrompt = getCoreSystemPrompt();
    if (coreSystemPrompt) {
      messages.push({
        role: 'system' as const,
        content: coreSystemPrompt,
      });
    }

    // Then get messages from the parent implementation
    const parentMessages = super.convertToOpenAIFormat(request);
    
    // Add all non-system messages from parent (system messages come after core prompt)
    messages.push(...parentMessages);
    
    return messages;
  }

  /**
   * Override to provide GitHub Copilot Bearer token and required headers
   */
  protected override async getAdditionalHeaders(): Promise<Record<string, string> | undefined> {
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

  override async embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse> {
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
  // Use global token manager if available, otherwise create a new one
  if (!globalTokenManager) {
    // Get GitHub token using the device flow or from file/env
    const githubToken = await GitHubCopilotTokenManager.getGitHubToken(true);
    
    if (!githubToken) {
      throw new Error('Failed to obtain GitHub token for Copilot authentication');
    }

    globalTokenManager = new GitHubCopilotTokenManager({ token: githubToken });
    
    // Validate the token
    const isValid = await globalTokenManager.validateToken();
    if (!isValid) {
      throw new Error('Invalid GitHub token provided');
    }

    // Test if we can get a Copilot bearer token
    const copilotTokenInfo = await globalTokenManager.getCopilotToken();
    if (!copilotTokenInfo) {
      throw new Error('Failed to obtain Copilot bearer token');
    }

    const currentModel = config.getModel() || 'gpt-4';
    logger.debug(`GitHub Copilot content generator initialized successfully with model: ${currentModel}`, LogLevel.NORMAL);
  }

  return new GitHubCopilotGeminiServer(globalTokenManager, config);
} 