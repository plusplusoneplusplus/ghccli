/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { ContentUnion, Content, GenerateContentConfig } from '@google/genai';
import { GeminiChat } from '../core/geminiChat.js';
import { ContentGenerator } from '../core/contentGenerator.js';
import { Config } from '../config/config.js';
import { AgentConfig } from './agentTypes.js';
import { AgentLoader } from './agentLoader.js';

/**
 * A specialized GeminiChat instance that loads configuration from YAML agent files
 */
export class AgentChat extends GeminiChat {
  private agentConfig: AgentConfig;
  private agentLoader: AgentLoader;

  constructor(
    config: Config,
    contentGenerator: ContentGenerator,
    agentConfig: AgentConfig,
    generationConfig: GenerateContentConfig = {},
    history: Content[] = [],
  ) {
    super(config, contentGenerator, generationConfig, history);
    this.agentConfig = agentConfig;
    this.agentLoader = new AgentLoader(''); // Will be set properly when needed
  }

  /**
   * Generates the system prompt using the agent's configuration
   */
  protected generateSystemPrompt(): ContentUnion | null {
    // Check if agentConfig is available (might not be during construction)
    if (this.agentConfig && this.agentConfig.systemPrompt.type === 'content') {
      let promptContent = this.agentConfig.systemPrompt.value;

      // Handle variable resolution if enabled
      if (this.agentConfig.metadata.promptSupport.variableResolution) {
        promptContent = this.resolvePromptVariables(promptContent);
      }

      return {
        role: 'system',
        parts: [{ text: promptContent }],
      };
    }

    // Fallback to parent implementation if no agent-specific prompt
    return super.generateSystemPrompt();
  }

  /**
   * Resolves variables in the prompt content
   */
  private resolvePromptVariables(promptContent: string): string {
    // Replace available agents placeholder
    const availableAgentsText = this.agentConfig.availableAgents
      .map(agent => `- ${agent}`)
      .join('\n');
    
    promptContent = promptContent.replace(
      '{{availableAgents}}',
      availableAgentsText
    );

    // Replace current date placeholder
    const currentDate = new Date().toISOString().split('T')[0];
    promptContent = promptContent.replace(
      '{{.CurrentDate}}',
      currentDate
    );

    return promptContent;
  }

  /**
   * Creates an AgentChat instance from a YAML configuration
   */
  static async fromAgentConfig(
    config: Config,
    contentGenerator: ContentGenerator,
    agentName: string,
    configsDir: string,
    generationConfig: GenerateContentConfig = {},
    history: Content[] = [],
  ): Promise<AgentChat> {
    const agentLoader = new AgentLoader(configsDir);
    const agentConfig = await agentLoader.loadAgentConfig(agentName);

    const instance = new AgentChat(
      config,
      contentGenerator,
      agentConfig,
      generationConfig,
      history,
    );

    instance.agentLoader = agentLoader;
    return instance;
  }

  /**
   * Gets the agent configuration
   */
  getAgentConfig(): AgentConfig {
    return this.agentConfig;
  }

  /**
   * Gets the agent's name
   */
  getAgentName(): string {
    return this.agentConfig.name;
  }

  /**
   * Gets the agent's description
   */
  getAgentDescription(): string {
    return this.agentConfig.description;
  }

  /**
   * Gets the agent's specialization
   */
  getSpecialization(): string {
    return this.agentConfig.metadata.specialization;
  }

  /**
   * Checks if the agent supports streaming
   */
  supportsStreaming(): boolean {
    return this.agentConfig.metadata.supportsStreaming;
  }

  /**
   * Checks if the agent supports tools
   */
  supportsTools(): boolean {
    return this.agentConfig.metadata.supportsTools;
  }

  /**
   * Gets the maximum number of rounds for this agent
   */
  getMaxRounds(): number {
    return this.agentConfig.metadata.executionConfig.maxRounds;
  }

  /**
   * Gets the maximum context tokens for this agent
   */
  getMaxContextTokens(): number {
    return this.agentConfig.metadata.executionConfig.maxContextTokens;
  }

  /**
   * Gets the allowed tool regex patterns for this agent
   */
  getAllowedToolRegex(): string[] {
    return this.agentConfig.metadata.toolPreferences?.allowedToolRegex || [];
  }

  /**
   * Gets the blocked tools regex patterns for this agent
   */
  getBlockedToolsRegex(): string[] {
    return this.agentConfig.metadata.toolPreferences?.blockedToolsRegex || [];
  }

  /**
   * Gets the list of available agents that this agent can invoke
   */
  getAvailableAgents(): string[] {
    return this.agentConfig.availableAgents;
  }
}