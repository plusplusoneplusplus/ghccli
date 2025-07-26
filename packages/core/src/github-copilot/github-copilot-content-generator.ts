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
  GenerateContentResponse,
  Content,
  ContentListUnion,
  ContentUnion,
  Part,
  PartUnion,
  FinishReason,
  Tool,
  ToolListUnion,
  FunctionDeclaration,
  FunctionCall
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
function convertToOpenAIMessages(contents: Content[]): Array<any> {
  const messages: Array<any> = [];
  const toolCallIdMap = new Map<string, string>(); // Track tool call IDs by function name
  
  for (const content of contents) {
    const role = content.role === 'user' ? 'user' : 'assistant';
    
    if (!content.parts || content.parts.length === 0) {
      messages.push({ role, content: '' });
      continue;
    }
    
    // Separate text parts from function calls and function responses
    const textParts: string[] = [];
    const functionCalls: any[] = [];
    const functionResponses: any[] = [];
    
    for (const part of content.parts) {
      if (typeof part === 'string') {
        textParts.push(part);
      } else if (part && typeof part === 'object') {
        if ('text' in part && part.text) {
          textParts.push(part.text);
        } else if ('functionCall' in part && part.functionCall) {
          // Convert Gemini function call to OpenAI tool call format
          const toolCallId = `call_${Math.random().toString(36).substr(2, 9)}`;
          const functionName = part.functionCall.name;
          if (functionName) {
            toolCallIdMap.set(functionName, toolCallId);
          }
          
          functionCalls.push({
            id: toolCallId,
            type: 'function',
            function: {
              name: functionName,
              arguments: JSON.stringify(part.functionCall.args || {})
            }
          });
        } else if ('functionResponse' in part && part.functionResponse) {
          // Function responses will be converted to separate tool messages
          functionResponses.push(part.functionResponse);
        }
      }
    }
    
    // Create the main message
    const textContent = textParts.join(' ').trim();
    
    if (role === 'assistant' && functionCalls.length > 0) {
      // Assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: textContent || null,
        tool_calls: functionCalls
      });
    } else if (textContent) {
      // Regular message with text content
      messages.push({ role, content: textContent });
    }
    
    // Add function responses as separate tool messages
    for (const functionResponse of functionResponses) {
      const functionName = functionResponse.name;
      if (functionName) {
        const toolCallId = toolCallIdMap.get(functionName) || `call_${functionName}_${Math.random().toString(36).substr(2, 9)}`;
        
        messages.push({
          role: 'tool',
          content: JSON.stringify(functionResponse.response || {}),
          tool_call_id: toolCallId,
          name: functionName
        });
      }
    }
  }
  
  return messages;
}

/**
 * Convert Gemini tools to OpenAI tools format based on the model
 */
function convertGeminiToolsToOpenAI(tools?: ToolListUnion, model?: string): any[] | undefined {
  if (!tools) {
    return undefined;
  }

  // Check if we should use Gemini-style tools (for Gemini models) or OpenAI-style tools
  const isGeminiModel = model?.includes('gemini') || model?.includes('pro') || model?.includes('flash');

  // Convert ToolListUnion to array of tools
  const toolArray = Array.isArray(tools) ? tools : [tools];

  // For non-Gemini models, convert to OpenAI tools format
  const openAITools: any[] = [];

  for (const tool of toolArray) {
    if (tool && typeof tool === 'object' && 'functionDeclarations' in tool && tool.functionDeclarations) {
      for (const funcDecl of tool.functionDeclarations) {
        openAITools.push({
            type: "function",
            function : {
              name: funcDecl.name,
              description: funcDecl.description,
              parameters: funcDecl.parameters
            }
        });
      }
    }
  }

  return openAITools.length > 0 ? openAITools : undefined;
}

/**
 * Convert OpenAI tool calls to Gemini function calls
 */
function convertOpenAIToolCallsToGemini(toolCalls: any[]): Part[] {
  const parts: Part[] = [];
  
  for (const toolCall of toolCalls) {
    if (toolCall.type === 'function' && toolCall.function) {
      let args: Record<string, unknown> = {};
      if (toolCall.function.arguments) {
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (error) {
          console.error('Failed to parse tool call arguments:', error);
        }
      }
      
      parts.push({
        functionCall: {
          name: toolCall.function.name,
          args
        } as FunctionCall
      });
    }
  }
  
  return parts;
}

/**
 * A ContentGenerator implementation that uses GitHub Copilot bearer tokens
 * to authenticate with the GitHub Copilot chat completions API using Gemini 2.5 Pro
 */
export class GitHubCopilotGeminiServer implements ContentGenerator {
  private streamingToolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
  private toolCallIdMap = new Map<string, string>(); // Maps OpenAI tool call IDs to function names

  constructor(
    private readonly tokenManager: GitHubCopilotTokenManager,
    private readonly model: string = DEFAULT_GEMINI_MODEL,
  ) {}

  /**
   * Creates common headers for GitHub Copilot API requests
   */
  private createHeaders(token: string, isStreaming: boolean = false): Record<string, string> {
    const headers: Record<string, string> = {
      "authorization": `Bearer ${token}`,
      "editor-version": `${this.tokenManager['config'].editorName}/${this.tokenManager['config'].editorVersion}`,
      "content-type": "application/json",
    };

    if (isStreaming) {
      headers["accept"] = "text/event-stream";
    } else {
      headers["Accept"] = "application/json";
    }

    return headers;
  }

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

    // Convert tools based on the model
    const openAITools = convertGeminiToolsToOpenAI(request.config?.tools, this.model);

    const requestBody = {
      intent: false,
      model: this.model, // Use Gemini 2.5 Pro as the model
      temperature: request.config?.temperature || 0,
      top_p: request.config?.topP || 1,
      n: 1,
      stream: false, // Non-streaming for generateContent
      messages,
      ...(openAITools && { tools: openAITools }),
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.createHeaders(tokenInfo.token, false),
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
    const toolCalls = choice?.message?.tool_calls;

    const geminiResponse = new GenerateContentResponse();
    const parts: Part[] = [];
    
    // Add text content if present
    if (content) {
      parts.push({ text: content });
    }
    
    // Add tool calls if present
    if (toolCalls && toolCalls.length > 0) {
      parts.push(...convertOpenAIToolCallsToGemini(toolCalls));
    }

    geminiResponse.candidates = [{
      content: {
        parts: parts.length > 0 ? parts : [{ text: '' }],
        role: 'model'
      },
      finishReason: choice?.finish_reason === 'tool_calls' ? FinishReason.FINISH_REASON_UNSPECIFIED : FinishReason.STOP,
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

    // Convert tools based on the model
    const openAITools = convertGeminiToolsToOpenAI(request.config?.tools, this.model);

    const requestBody = {
      intent: false,
      model: this.model, // Use Gemini 2.5 Pro as the model
      temperature: request.config?.temperature || 0,
      top_p: request.config?.topP || 1,
      n: 1,
      stream: true, // Streaming for generateContentStream
      messages,
      tools: openAITools,
    };

    const body = JSON.stringify(requestBody);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.createHeaders(tokenInfo.token, true),
      body: body,
      signal: request.config?.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub Copilot streaming request failed: ${response.status} ${errorText}`);
    }

    const finalResponse = this.parseStreamingResponse(response);
    return finalResponse;
  }

  private async *parseStreamingResponse(response: Response): AsyncGenerator<GenerateContentResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';

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
              const choice = jsonData.choices?.[0];
              const delta = choice?.delta;
              
              if (!delta) continue;

              const parts: Part[] = [];
              
              // Handle text content
              const content = delta?.content || '';
              if (content) {
                accumulatedContent += content;
                parts.push({ text: content });
              }

              // Handle tool calls
              if (delta?.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  const index = toolCall.index ?? 0;
                  
                  // Get or create the tool call accumulator for this index
                  let accumulatedCall = this.streamingToolCalls.get(index);
                  if (!accumulatedCall) {
                    accumulatedCall = { arguments: '' };
                    this.streamingToolCalls.set(index, accumulatedCall);
                  }

                  // Update accumulated data
                  if (toolCall.id) {
                    accumulatedCall.id = toolCall.id;
                  }
                  if (toolCall.function?.name) {
                    accumulatedCall.name = toolCall.function.name;
                    // Store the mapping for later use with tool responses
                    if (toolCall.id) {
                      this.toolCallIdMap.set(toolCall.function.name, toolCall.id);
                    }
                  }
                  if (toolCall.function?.arguments) {
                    accumulatedCall.arguments += toolCall.function.arguments;
                  }
                }
              }

              // Only emit function calls when streaming is complete (finish_reason is present)
              if (choice?.finish_reason) {
                for (const [, accumulatedCall] of this.streamingToolCalls) {
                  if (accumulatedCall.name) {
                    let args: Record<string, unknown> = {};
                    if (accumulatedCall.arguments) {
                      try {
                        args = JSON.parse(accumulatedCall.arguments);
                      } catch (error) {
                        console.error('Failed to parse final tool call arguments:', error);
                      }
                    }
                    
                    parts.push({
                      functionCall: {
                        name: accumulatedCall.name,
                        args
                      } as FunctionCall
                    });
                  }
                }
                // Clear all accumulated tool calls
                this.streamingToolCalls.clear();
              }
              
              if (parts.length > 0) {
                const geminiResponse = new GenerateContentResponse();
                geminiResponse.candidates = [{
                  content: {
                    parts,
                    role: 'model'
                  },
                  finishReason: choice?.finish_reason 
                    ? (choice.finish_reason === 'tool_calls' ? FinishReason.FINISH_REASON_UNSPECIFIED : FinishReason.STOP)
                    : undefined,
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