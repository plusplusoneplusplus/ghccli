/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Result of a tool call execution
 */
export interface ToolCallResult {
  id: string;
  name: string;
  arguments: object;
  result: string;
  status: 'success' | 'error';
  timestamp: string;
  duration?: number;
}

/**
 * Error information for JSON output
 */
export interface JsonOutputError {
  type: string;
  message: string;
  details?: object;
}

/**
 * Metadata for JSON output
 */
export interface JsonOutputMetadata {
  sessionId: string;
  promptId: string;
  model: string;
  turnCount: number;
  timestamp: string;
}

/**
 * Main JSON output schema for non-interactive mode
 */
export interface JsonOutput {
  status: 'success' | 'error' | 'partial';
  message: string;
  error?: JsonOutputError;
  metadata: JsonOutputMetadata;
  content: string;
  toolCalls: ToolCallResult[];
  schemaVersion: 1;
}