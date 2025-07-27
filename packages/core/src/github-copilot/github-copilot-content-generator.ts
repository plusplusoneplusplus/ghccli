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
import { Config } from '../config/config.js';
import { tokenLimit } from '../core/tokenLimits.js';
import { logApiResponse } from '../telemetry/loggers.js';
import { ApiResponseEvent } from '../telemetry/types.js';

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
function convertGeminiToolsToOpenAI(tools?: ToolListUnion, model?: string, parameterConverter?: (params: Record<string, unknown>) => Record<string, unknown> | undefined): any[] | undefined {
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
        // Convert parameters using the provided converter function
        const convertedParameters = parameterConverter && funcDecl.parameters 
          ? parameterConverter(funcDecl.parameters as Record<string, unknown>)
          : funcDecl.parameters;

        openAITools.push({
            type: "function",
            function : {
              name: funcDecl.name,
              description: funcDecl.description,
              parameters: convertedParameters
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
 * Handle system instruction from config and add it to the messages array
 */
function handleSystemInstruction(messages: any[], systemInstruction: any): void {
  let systemText = '';

  if (Array.isArray(systemInstruction)) {
    systemText = systemInstruction
      .map((content) => {
        if (typeof content === 'string') return content;
        if ('parts' in content) {
          const contentObj = content as Content;
          return (
            contentObj.parts
              ?.map((p: Part) =>
                typeof p === 'string' ? p : 'text' in p ? p.text : '',
              )
              .join('\n') || ''
          );
        }
        return '';
      })
      .join('\n');
  } else if (typeof systemInstruction === 'string') {
    systemText = systemInstruction;
  } else if (
    typeof systemInstruction === 'object' &&
    'parts' in systemInstruction
  ) {
    const systemContent = systemInstruction as Content;
    systemText =
      systemContent.parts
        ?.map((p: Part) =>
          typeof p === 'string' ? p : 'text' in p ? p.text : '',
        )
        .join('\n') || '';
  }

  if (systemText) {
    messages.unshift({
      role: 'system' as const,
      content: systemText,
    });
  }
}

/**
 * A ContentGenerator implementation that uses GitHub Copilot bearer tokens
 * to authenticate with the GitHub Copilot chat completions API using Gemini 2.5 Pro
 */
export class GitHubCopilotGeminiServer implements ContentGenerator {
  private streamingToolCalls = new Map<number, { id?: string; name?: string; arguments: string; functionCallComplete?: boolean }>();
  private toolCallIdMap = new Map<string, string>(); // Maps OpenAI tool call IDs to function names

  constructor(
    private readonly tokenManager: GitHubCopilotTokenManager,
    private readonly config: Config,
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

  /**
   * Convert Gemini function parameters to OpenAI JSON Schema format with proper type conversion
   */
  private convertGeminiParametersToOpenAI(
    parameters: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!parameters || typeof parameters !== 'object') {
      return parameters;
    }

    const converted = JSON.parse(JSON.stringify(parameters));

    const convertTypes = (obj: unknown): unknown => {
      if (typeof obj !== 'object' || obj === null) {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map(convertTypes);
      }

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'type' && typeof value === 'string') {
          // Convert Gemini types to OpenAI JSON Schema types
          const lowerValue = value.toLowerCase();
          if (lowerValue === 'integer') {
            result[key] = 'integer';
          } else if (lowerValue === 'number') {
            result[key] = 'number';
          } else {
            result[key] = lowerValue;
          }
        } else if (
          key === 'minimum' ||
          key === 'maximum' ||
          key === 'multipleOf'
        ) {
          // Ensure numeric constraints are actual numbers, not strings
          if (typeof value === 'string' && !isNaN(Number(value))) {
            result[key] = Number(value);
          } else {
            result[key] = value;
          }
        } else if (
          key === 'minLength' ||
          key === 'maxLength' ||
          key === 'minItems' ||
          key === 'maxItems'
        ) {
          // Ensure length constraints are integers, not strings
          if (typeof value === 'string' && !isNaN(Number(value))) {
            result[key] = parseInt(value, 10);
          } else {
            result[key] = value;
          }
        } else if (typeof value === 'object') {
          result[key] = convertTypes(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    };

    return convertTypes(converted) as Record<string, unknown> | undefined;
  }

  /**
   * Estimate tokens for the complete request including messages and tools
   */
  private estimateRequestTokens(messages: any[], tools?: any[]): number {
    // Estimate tokens for messages
    let messageTokens = 0;
    for (const message of messages) {
      if (message.content) {
        // Rough estimation: 1 token ≈ 4 characters for English text
        messageTokens += Math.ceil(message.content.length / 4);
      }
      // Account for tool calls in messages
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.function) {
            messageTokens += Math.ceil((toolCall.function.name || '').length / 4);
            messageTokens += Math.ceil((toolCall.function.arguments || '').length / 4);
          }
        }
      }
    }

    // Estimate tokens for tools (function definitions)
    let toolTokens = 0;
    if (tools && tools.length > 0) {
      for (const tool of tools) {
        if (tool.function) {
          // Function name and description
          toolTokens += Math.ceil((tool.function.name || '').length / 4);
          toolTokens += Math.ceil((tool.function.description || '').length / 4);
          
          // Function parameters (schema)
          if (tool.function.parameters) {
            const parameterJson = JSON.stringify(tool.function.parameters);
            toolTokens += Math.ceil(parameterJson.length / 4);
          }
        }
      }
    }

    // Add some overhead for request structure and formatting
    const overhead = Math.ceil((messageTokens + toolTokens) * 0.1);
    
    return messageTokens + toolTokens + overhead;
  }

  /**
   * Validate that the request doesn't exceed token limits
   */
  private validateTokenLimits(messages: any[], tools?: any[], model?: string): void {
    const currentModel = model || this.config.getModel() || DEFAULT_GEMINI_MODEL;
    const maxTokens = tokenLimit(currentModel);
    const estimatedTokens = this.estimateRequestTokens(messages, tools);

    // Use 90% of the limit as a safety margin to account for estimation inaccuracies
    const safetyThreshold = Math.floor(maxTokens * 0.9);

    if (estimatedTokens > safetyThreshold) {
      throw new Error(
        `Request would exceed token limit for model '${currentModel}'. ` +
        `Estimated tokens: ${estimatedTokens}, ` +
        `Safe limit: ${safetyThreshold} (90% of ${maxTokens}). ` +
        `Please reduce the message history or tool count before retrying.`
      );
    }
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

    // Handle system instruction from config
    if (request.config?.systemInstruction) {
      handleSystemInstruction(messages, request.config.systemInstruction);
    }

    // Convert tools based on the model
    const modelToUse = this.config.getModel() || DEFAULT_GEMINI_MODEL;
    const openAITools = convertGeminiToolsToOpenAI(
      request.config?.tools, 
      modelToUse, 
      this.convertGeminiParametersToOpenAI.bind(this)
    );

    // Validate token limits
    this.validateTokenLimits(messages, openAITools, modelToUse);

    const requestBody = {
      intent: false,
      model: modelToUse, // Use current model from config
      temperature: request.config?.temperature || 0,
      top_p: request.config?.topP || 1,
      n: 1,
      stream: false, // Non-streaming for generateContent
      messages,
      tools: openAITools
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

    // Handle system instruction from config
    if (request.config?.systemInstruction) {
      handleSystemInstruction(messages, request.config.systemInstruction);
    }

    // Convert tools based on the model
    const modelToUse = this.config.getModel() || DEFAULT_GEMINI_MODEL;
    const openAITools = convertGeminiToolsToOpenAI(
      request.config?.tools, 
      modelToUse, 
      this.convertGeminiParametersToOpenAI.bind(this)
    );

    // Validate token limits
    this.validateTokenLimits(messages, openAITools, modelToUse);

    const requestBody = {
      intent: false,
      model: modelToUse, // Use current model from config
      temperature: request.config?.temperature || 0,
      top_p: request.config?.topP || 1,
      n: 1,
      stream: true, // Streaming for generateContentStream
      messages,
      tools: openAITools
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
    let finalUsageMetadata: any = null;

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
              
              // Check for usage metadata in the streaming chunk
              if (jsonData.usage) {
                finalUsageMetadata = jsonData.usage;
              }

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
                    accumulatedCall = { arguments: '', functionCallComplete: false };
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
                        // Trim whitespace and validate JSON structure
                        const trimmedArgs = accumulatedCall.arguments.trim();
                        if (trimmedArgs && (trimmedArgs.startsWith('{') || trimmedArgs.startsWith('['))) {
                          // Check if we have multiple JSON objects concatenated together
                          // This can happen when streaming multiple tool calls
                          if (trimmedArgs.includes('}{') || trimmedArgs.includes('][')) {
                            // Find the first complete JSON object
                            let depth = 0;
                            let firstObjectEnd = -1;
                            let inString = false;
                            let escapeNext = false;
                            
                            for (let i = 0; i < trimmedArgs.length; i++) {
                              const char = trimmedArgs[i];
                              
                              if (escapeNext) {
                                escapeNext = false;
                                continue;
                              }
                              
                              if (char === '\\') {
                                escapeNext = true;
                                continue;
                              }
                              
                              if (char === '"') {
                                inString = !inString;
                                continue;
                              }
                              
                              if (!inString) {
                                if (char === '{' || char === '[') {
                                  depth++;
                                } else if (char === '}' || char === ']') {
                                  depth--;
                                  if (depth === 0) {
                                    firstObjectEnd = i;
                                    break;
                                  }
                                }
                              }
                            }
                            
                            if (firstObjectEnd !== -1) {
                              const firstJsonObject = trimmedArgs.substring(0, firstObjectEnd + 1);
                              args = JSON.parse(firstJsonObject);
                              console.warn('Multiple JSON objects detected in tool call arguments, using first object only');
                            } else {
                              console.warn('Could not find complete JSON object in concatenated arguments:', trimmedArgs);
                            }
                          } else {
                            args = JSON.parse(trimmedArgs);
                          }
                        } else {
                          console.warn('Invalid JSON structure in tool call arguments:', trimmedArgs);
                        }
                      } catch (error) {
                        console.error('Failed to parse final tool call arguments:', error);
                        console.error('Raw arguments string:', JSON.stringify(accumulatedCall.arguments));
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
              
              if (parts.length > 0 || finalUsageMetadata) {
                const geminiResponse = new GenerateContentResponse();

                if (parts.length > 0) {
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
                }

                // Only include usage metadata when we have real data from the API
                // This typically comes in the final chunk and contains complete totals
                if (finalUsageMetadata) {
                  geminiResponse.usageMetadata = {
                    promptTokenCount: finalUsageMetadata.prompt_tokens || 0,
                    candidatesTokenCount: finalUsageMetadata.completion_tokens || 0,
                    totalTokenCount: finalUsageMetadata.total_tokens || 0
                  };

                  // Log API response event for UI telemetry
                  const responseEvent = new ApiResponseEvent(
                    this.config.getModel(),
                    Date.now(),
                    `openai-stream-${Date.now()}`, // Generate a prompt ID
                    'github-copilot', // Use string literal instead of AuthType.GITHUB_COPILOT
                    finalUsageMetadata,
                  );
                  logApiResponse(this.config, responseEvent);
                }
                // For intermediate chunks, usageMetadata remains undefined
                // The consuming code (like getFinalUsageMetadata) will extract it from
                // the chunk that has it after streaming is complete

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
    // Convert Gemini format to OpenAI messages for accurate estimation
    const contents = toContents(request.contents || []);
    const messages = convertToOpenAIMessages(contents);

    // Account for tools if present in the request config
    const tools = request.config?.tools ? convertGeminiToolsToOpenAI(
      request.config.tools,
      request.model || this.config.getModel() || DEFAULT_GEMINI_MODEL,
      this.convertGeminiParametersToOpenAI.bind(this)
    ) : undefined;

    // Use the same estimation logic as our token limit validation
    const tokenCount = this.estimateRequestTokens(messages, tools);
    
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

  const currentModel = config.getModel() || DEFAULT_GEMINI_MODEL;
  console.log(`GitHub Copilot content generator initialized successfully with model: ${currentModel}`);
  return new GitHubCopilotGeminiServer(tokenManager, config);
} 