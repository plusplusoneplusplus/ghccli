/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GitHubCopilotTokenManager, GitHubCopilotChatClient } from './github-copilot-auth.js';
import { 
  GoogleGenAI, 
  GenerateContentResponse,
  GenerateContentParameters,
  Content,
  Part,
  FinishReason
} from '@google/genai';

/**
 * Type guard to check if content is a Content object (has parts property)
 */
function isContent(content: Content | Part): content is Content {
  return 'parts' in content && Array.isArray((content as Content).parts);
}

/**
 * Creates a ContentGenerator that uses GitHub Copilot as the backend
 * but provides responses through the standard Gemini interface
 */
export async function createGitHubCopilotContentGenerator(
  model: string = 'gpt-4o'
) {
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

  const chatClient = new GitHubCopilotChatClient(tokenManager, model);

  // Create a GoogleGenAI instance as a proxy (we'll override its methods)
  const googleGenAI = new GoogleGenAI({
    apiKey: 'github-copilot-proxy', // placeholder
    vertexai: false,
    httpOptions: {
      headers: {
        'User-Agent': 'GeminiCLI-GitHubCopilot/1.0.0',
      },
    },
  });

  // Override the generateContent method to use GitHub Copilot
  const originalGenerateContent = googleGenAI.models.generateContent.bind(googleGenAI.models);
  googleGenAI.models.generateContent = async (request: GenerateContentParameters): Promise<GenerateContentResponse> => {
    try {
      // Extract text from the request
      let prompt = '';
      if (typeof request === 'string') {
        prompt = request;
      } else if (request.contents && Array.isArray(request.contents)) {
        prompt = request.contents
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
      } else {
        prompt = String(request);
      }

      // Get response from GitHub Copilot
      const copilotResponse = await chatClient.sendMessage(prompt);

      // Create a proper GenerateContentResponse object
      const response = new GenerateContentResponse();
      response.candidates = [{
        content: {
          parts: [{ text: copilotResponse }],
          role: 'model'
        },
        finishReason: FinishReason.STOP,
        index: 0
      }];
      response.usageMetadata = {
        promptTokenCount: Math.ceil(prompt.length / 4),
        candidatesTokenCount: Math.ceil(copilotResponse.length / 4),
        totalTokenCount: Math.ceil((prompt.length + copilotResponse.length) / 4)
      };
      
      return response;
    } catch (error) {
      console.warn('GitHub Copilot request failed, falling back to error response:', error);
      throw new Error(`GitHub Copilot content generation failed: ${error}`);
    }
  };

  // Override the generateContentStream method
  const originalGenerateContentStream = googleGenAI.models.generateContentStream.bind(googleGenAI.models);
  googleGenAI.models.generateContentStream = async (request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> => {
    return (async function* () {
      try {
        const result = await googleGenAI.models.generateContent(request);
        yield result;
      } catch (error) {
        throw new Error(`GitHub Copilot streaming failed: ${error}`);
      }
    })();
  };

  // Override the countTokens method
  const originalCountTokens = googleGenAI.models.countTokens.bind(googleGenAI.models);
  googleGenAI.models.countTokens = async (request) => {
    // Extract text from the request for token counting
    let text = '';
    if (typeof request === 'string') {
      text = request;
    } else if (request.contents && Array.isArray(request.contents)) {
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
    } else {
      text = String(request);
    }

    // Rough token estimation (1 token ≈ 4 characters for English text)
    const tokenCount = Math.ceil(text.length / 4);
    
    return {
      totalTokens: tokenCount
    };
  };

  // Override the embedContent method to throw an error
  const originalEmbedContent = googleGenAI.models.embedContent?.bind(googleGenAI.models);
  if (googleGenAI.models.embedContent) {
    googleGenAI.models.embedContent = async () => {
      throw new Error('GitHub Copilot does not support content embedding');
    };
  }

  console.log('GitHub Copilot content generator initialized successfully');
  return googleGenAI.models;
} 