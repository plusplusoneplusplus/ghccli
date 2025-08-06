/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  JsonOutput,
  JsonOutputError,
  JsonOutputMetadata,
  ToolCallResult,
} from './types.js';

/**
 * Handler for JSON output formatting in non-interactive mode
 */
export class JsonOutputHandler {
  private prettyPrint: boolean;

  constructor(prettyPrint = true) {
    this.prettyPrint = prettyPrint;
  }

  /**
   * Create a JSON output response
   */
  createOutput(
    status: 'success' | 'error' | 'partial',
    message: string,
    metadata: JsonOutputMetadata,
    content = '',
    toolCalls: ToolCallResult[] = [],
    error?: JsonOutputError,
  ): JsonOutput {
    return {
      status,
      message,
      error,
      metadata,
      content,
      toolCalls,
      schemaVersion: 1,
    };
  }

  /**
   * Format a JSON output as string
   */
  format(output: JsonOutput): string {
    if (this.prettyPrint) {
      return JSON.stringify(output, null, 2);
    }
    return JSON.stringify(output);
  }

  /**
   * Create a success output
   */
  createSuccess(
    message: string,
    metadata: JsonOutputMetadata,
    content = '',
    toolCalls: ToolCallResult[] = [],
  ): JsonOutput {
    return this.createOutput('success', message, metadata, content, toolCalls);
  }

  /**
   * Create an error output
   */
  createError(
    message: string,
    metadata: JsonOutputMetadata,
    error: JsonOutputError,
    content = '',
    toolCalls: ToolCallResult[] = [],
  ): JsonOutput {
    return this.createOutput(
      'error',
      message,
      metadata,
      content,
      toolCalls,
      error,
    );
  }

  /**
   * Create a partial output (for incomplete operations)
   */
  createPartial(
    message: string,
    metadata: JsonOutputMetadata,
    content = '',
    toolCalls: ToolCallResult[] = [],
  ): JsonOutput {
    return this.createOutput('partial', message, metadata, content, toolCalls);
  }

  /**
   * Create metadata object
   */
  createMetadata(
    sessionId: string,
    promptId: string,
    model: string,
    turnCount: number,
  ): JsonOutputMetadata {
    return {
      sessionId,
      promptId,
      model,
      turnCount,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create tool call result
   */
  createToolCallResult(
    id: string,
    name: string,
    args: object,
    result: string,
    status: 'success' | 'error',
    duration?: number,
  ): ToolCallResult {
    return {
      id,
      name,
      arguments: args,
      result,
      status,
      timestamp: new Date().toISOString(),
      duration,
    };
  }
}