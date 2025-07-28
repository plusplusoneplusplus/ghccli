/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AgentSystemPrompt {
  type: 'content' | 'file';
  value: string;
}

export interface AgentLanguageModel {
  preferred: string;
}

export interface AgentPromptSupport {
  supportsPrompts: boolean;
  supportsTsxMessages: boolean;
  promptParameterName: string;
  variableResolution: boolean;
}

export interface AgentToolPreferences {
  allowedToolRegex?: string[];
  blockedToolsRegex?: string[];
}

export interface AgentExecutionConfig {
  maxRounds: number;
  maxContextTokens: number;
}

export interface AgentMetadata {
  supportsStreaming: boolean;
  supportsTools: boolean;
  requiresWorkspace: boolean;
  supportsPromptSelection: boolean;
  languageModel: AgentLanguageModel;
  promptSupport: AgentPromptSupport;
  toolPreferences?: AgentToolPreferences;
  specialization: string;
  executionConfig: AgentExecutionConfig;
}

export interface AgentConfig {
  name: string;
  description: string;
  methods: string[];
  availableAgents: string[];
  metadata: AgentMetadata;
  systemPrompt: AgentSystemPrompt;
}