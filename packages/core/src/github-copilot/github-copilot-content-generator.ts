/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GitHubCopilotTokenManager } from './github-copilot-auth.js';
import { 
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
  Content,
  ContentListUnion,
  ContentUnion,
  Part,
  PartUnion,
  FinishReason
} from '@google/genai';
import { ContentGenerator } from '../core/contentGenerator.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';

/**
 * Type guard to check if content is a Content object (has parts property)
 */
function isContent(content: Content | Part): content is Content {
  return 'parts' in content && Array.isArray((content as Content).parts);
}

/**
 * Convert ContentListUnion to Content[] array
 */
function toContents(contents: ContentListUnion): Content[] {
  if (Array.isArray(contents)) {
    return contents.map((item) => toContent(item));
  }
  return [toContent(contents)];
}

/**
 * Convert ContentUnion to Content
 */
function toContent(content: ContentUnion): Content {
  if (typeof content === 'string') {
    return { parts: [{ text: content }], role: 'user' };
  }
  if (Array.isArray(content)) {
    return { parts: content.map(toPart), role: 'user' };
  }
  if ('parts' in content) {
    return content as Content;
  }
  return content as Content;
}

/**
 * Convert PartUnion to Part
 */
function toPart(part: PartUnion): Part {
  if (typeof part === 'string') {
    return { text: part };
  }
  return part;
}

/**
 * Convert Gemini request format to OpenAI chat messages format
 */
function convertToOpenAIMessages(contents: Content[]): Array<{ role: string; content: string }> {
  return contents.map(content => {
    const role = content.role === 'user' ? 'user' : 'assistant';
    let text = '';
    
    if (content.parts) {
      text = content.parts
        .map((part: Part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && 'text' in part) return part.text;
          return '';
        })
        .join(' ');
    }
    
    return { role, content: text };
  });
}

/**
 * A ContentGenerator implementation that uses GitHub Copilot bearer tokens
 * to authenticate with the GitHub Copilot chat completions API using Gemini 2.5 Pro
 */
export class GitHubCopilotGeminiServer implements ContentGenerator {
  constructor(
    private readonly tokenManager: GitHubCopilotTokenManager,
    private readonly model: string = DEFAULT_GEMINI_MODEL,
  ) {}

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    const endpoint = "https://api.githubcopilot.com/chat/completions";
    
    // Ensure we have a fresh GitHub Copilot token
    const tokenInfo = await this.tokenManager.getCachedOrFreshToken();
    if (!tokenInfo) {
      throw new Error('Failed to get GitHub Copilot bearer token');
    }

    // Convert Gemini format to OpenAI chat messages format
    const contents = toContents(request.contents || []);
    const messages = convertToOpenAIMessages(contents);

    const requestBody = {
      intent: false,
      model: this.model, // Use Gemini 2.5 Pro as the model
      temperature: request.config?.temperature || 0,
      top_p: request.config?.topP || 1,
      n: 1,
      stream: false, // Non-streaming for generateContent
      messages,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        "authorization": `Bearer ${tokenInfo.token}`,
        "Editor-Version": `${this.tokenManager['config'].editorName}/${this.tokenManager['config'].editorVersion}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: request.config?.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub Copilot chat completions request failed: ${response.status} ${errorText}`);
    }

    const responseData = await response.json();
    
    // Convert OpenAI response back to Gemini format
    const openAIResponse = responseData;
    const choice = openAIResponse.choices?.[0];
    const content = choice?.message?.content || '';

    const geminiResponse = new GenerateContentResponse();
    geminiResponse.candidates = [{
      content: {
        parts: [{ text: content }],
        role: 'model'
      },
      finishReason: FinishReason.STOP,
      index: 0
    }];
    geminiResponse.usageMetadata = {
      promptTokenCount: openAIResponse.usage?.prompt_tokens || Math.ceil((JSON.stringify(messages)).length / 4),
      candidatesTokenCount: openAIResponse.usage?.completion_tokens || Math.ceil(content.length / 4),
      totalTokenCount: openAIResponse.usage?.total_tokens || Math.ceil((JSON.stringify(messages) + content).length / 4)
    };

    return geminiResponse;
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const endpoint = "https://api.githubcopilot.com/chat/completions";
    
    // Ensure we have a fresh GitHub Copilot token
    const tokenInfo = await this.tokenManager.getCachedOrFreshToken();
    if (!tokenInfo) {
      throw new Error('Failed to get GitHub Copilot bearer token');
    }

    // Convert Gemini format to OpenAI chat messages format
    const contents = toContents(request.contents || []);
    const messages = convertToOpenAIMessages(contents);

    const requestBody = {
      intent: false,
      model: this.model, // Use Gemini 2.5 Pro as the model
      temperature: request.config?.temperature || 0,
      top_p: request.config?.topP || 1,
      n: 1,
      stream: true, // Streaming for generateContentStream
      messages,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        "authorization": `Bearer ${tokenInfo.token}`,
        "Editor-Version": `${this.tokenManager['config'].editorName}/${this.tokenManager['config'].editorVersion}`,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(requestBody),
      signal: request.config?.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub Copilot streaming request failed: ${response.status} ${errorText}`);
    }

    return this.parseStreamingResponse(response);
  }

  private async *parseStreamingResponse(response: Response): AsyncGenerator<GenerateContentResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let _accumulatedContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }

            try {
              const jsonData = JSON.parse(data);
              const delta = jsonData.choices?.[0]?.delta;
              const content = delta?.content || '';
              
              if (content) {
                _accumulatedContent += content;
                
                const geminiResponse = new GenerateContentResponse();
                geminiResponse.candidates = [{
                  content: {
                    parts: [{ text: content }],
                    role: 'model'
                  },
                  finishReason: delta.finish_reason === 'stop' ? FinishReason.STOP : undefined,
                  index: 0
                }];
                geminiResponse.usageMetadata = {
                  promptTokenCount: 0,
                  candidatesTokenCount: Math.ceil(content.length / 4),
                  totalTokenCount: Math.ceil(content.length / 4)
                };

                yield geminiResponse;
              }
            } catch (error) {
              // Ignore JSON parse errors for streaming
              console.debug('Error parsing streaming JSON:', error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // Convert contents to text for rough token estimation
    let text = '';
    if (request.contents && Array.isArray(request.contents)) {
      text = request.contents
        .map(content => {
          if (typeof content === 'string') return content;
          if (isContent(content) && content.parts) {
            return content.parts
              .map((part: Part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object' && 'text' in part) return part.text;
                return '';
              })
              .join(' ');
          }
          return '';
        })
        .join(' ');
    }

    // Rough token estimation (1 token ≈ 4 characters for English text)
    const tokenCount = Math.ceil(text.length / 4);
    
    return {
      totalTokens: tokenCount
    };
  }

  async embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse> {
    // GitHub Copilot authentication may not support embedding endpoints
    // Throw an appropriate error
    throw new Error('Content embedding is not supported with GitHub Copilot authentication');
  }
}

/**
 * Creates a ContentGenerator that uses GitHub Copilot authentication
 * to access the GitHub Copilot chat completions API with Gemini 2.5 Pro as the model
 */
export async function createGitHubCopilotContentGenerator(
  model: string = DEFAULT_GEMINI_MODEL
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

  console.log(`GitHub Copilot content generator initialized successfully with model: ${model}`);
  return new GitHubCopilotGeminiServer(tokenManager, model);
} 