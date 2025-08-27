/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, Kind, ToolResult } from './tools.js';
import { Type } from '@google/genai';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { getErrorMessage } from '../utils/errors.js';
import { Config } from '../config/config.js';
import { getTavilyToken, setTavilyToken } from '../utils/tavilyToken.js';

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilySearchResponse {
  answer?: string;
  query: string;
  response_time: number;
  results: TavilySearchResult[];
}

interface WebSearchSource {
  title: string;
  url: string;
  content?: string;
  score?: number;
}

/**
 * Parameters for the TavilyWebSearchTool.
 */
export interface TavilyWebSearchToolParams {
  /**
   * The search query.
   */
  query: string;
  /**
   * Maximum number of results to return (optional, defaults to 5).
   */
  max_results?: number;
  /**
   * Search depth - 'basic' or 'advanced' (optional, defaults to 'basic').
   */
  search_depth?: 'basic' | 'advanced';
  /**
   * Include domains to search within (optional).
   */
  include_domains?: string[];
  /**
   * Exclude domains from search (optional).
   */
  exclude_domains?: string[];
}

/**
 * Extends ToolResult to include sources for web search.
 */
export interface TavilyWebSearchToolResult extends ToolResult {
  sources?: WebSearchSource[];
  answer?: string;
  response_time?: number;
}

/**
 * A tool to perform web searches using Tavily Search API.
 */
export class TavilyWebSearchTool extends BaseTool<
  TavilyWebSearchToolParams,
  TavilyWebSearchToolResult
> {
  static readonly Name: string = 'tavily_web_search';

  /**
   * Sets the Tavily API token for web search functionality.
   * @param token The Tavily API token
   * @returns True if successful, false otherwise
   */
  static setToken(token: string): boolean {
    return setTavilyToken(token);
  }

  /**
   * Gets the current Tavily API token.
   * @returns The token or null if not set
   */
  static getToken(): string | null {
    return getTavilyToken();
  }

  constructor(_config: Config) {
    super(
      TavilyWebSearchTool.Name,
      'TavilySearch',
      'Performs a web search using Tavily Search API and returns the results. This tool is useful for finding information on the internet based on a query.',
      Kind.Fetch,
      {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'The search query to find information on the web.',
          },
          max_results: {
            type: Type.NUMBER,
            description: 'Maximum number of results to return (optional, defaults to 5).',
          },
          search_depth: {
            type: Type.STRING,
            description: 'Search depth - "basic" or "advanced" (optional, defaults to "basic").',
            enum: ['basic', 'advanced'],
          },
          include_domains: {
            type: Type.ARRAY,
            description: 'Include domains to search within (optional).',
            items: { type: Type.STRING },
          },
          exclude_domains: {
            type: Type.ARRAY,
            description: 'Exclude domains from search (optional).',
            items: { type: Type.STRING },
          },
        },
        required: ['query'],
      },
    );
  }

  /**
   * Validates the parameters for the TavilyWebSearchTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
  validateParams(params: TavilyWebSearchToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }

    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  override getDescription(params: TavilyWebSearchToolParams): string {
    return `Searching the web for: "${params.query}"`;
  }

  async execute(
    params: TavilyWebSearchToolParams,
    signal: AbortSignal,
  ): Promise<TavilyWebSearchToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
      };
    }

    // Get Tavily API token
    let tavilyToken = getTavilyToken();
    if (!tavilyToken) {
      return {
        llmContent: `Error: Tavily API token not found. Please provide your Tavily API token.`,
        returnDisplay: 'Tavily API token required. Please set your token.',
      };
    }

    try {
      // Prepare request body for Tavily API
      const requestBody: any = {
        query: params.query,
        search_depth: params.search_depth || 'basic',
        include_answer: true,
        include_domains: params.include_domains || [],
        exclude_domains: params.exclude_domains || [],
        max_results: params.max_results || 5,
      };

      // Remove empty arrays to keep request clean
      if (requestBody.include_domains.length === 0) {
        delete requestBody.include_domains;
      }
      if (requestBody.exclude_domains.length === 0) {
        delete requestBody.exclude_domains;
      }

      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tavilyToken}`,
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          return {
            llmContent: `Error: Invalid Tavily API token. Please check your token.`,
            returnDisplay: 'Invalid Tavily API token.',
          };
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: TavilySearchResponse = await response.json();

      if (!data.results || data.results.length === 0) {
        return {
          llmContent: `No search results found for query: "${params.query}"`,
          returnDisplay: 'No search results found.',
        };
      }

      // Format results
      const sources: WebSearchSource[] = data.results.map((result) => ({
        title: result.title,
        url: result.url,
        content: result.content,
        score: result.score,
      }));

      const sourceListFormatted: string[] = data.results.map((result, index) => 
        `[${index + 1}] ${result.title} (${result.url})`
      );

      let formattedResponse = '';
      
      // Include AI-generated answer if available
      if (data.answer) {
        formattedResponse += `Answer: ${data.answer}\n\n`;
      }

      // Add search results
      formattedResponse += 'Search Results:\n';
      data.results.forEach((result, index) => {
        formattedResponse += `\n${index + 1}. **${result.title}**\n`;
        formattedResponse += `   ${result.url}\n`;
        if (result.content) {
          formattedResponse += `   ${result.content}\n`;
        }
      });

      // Add sources list
      if (sourceListFormatted.length > 0) {
        formattedResponse += '\n\nSources:\n' + sourceListFormatted.join('\n');
      }

      return {
        llmContent: `Web search results for "${params.query}":\n\n${formattedResponse}`,
        returnDisplay: `Search results for "${params.query}" returned (${data.results.length} results).`,
        sources,
        answer: data.answer,
        response_time: data.response_time,
      };
    } catch (error: unknown) {
      const errorMessage = `Error during web search for query "${params.query}": ${getErrorMessage(error)}`;
      console.error(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web search.`,
      };
    }
  }
}