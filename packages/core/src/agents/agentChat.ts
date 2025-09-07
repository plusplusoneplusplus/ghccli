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
import { isModelAvailable } from '../config/supportedModels.js';
import { createLogger, LogLevel } from '../utils/logging.js';
import { getEnvironmentContext } from '../utils/environmentContext.js';

import os from 'os';

const logger = createLogger('AgentChat');

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
    
    logger.debug(`chat initialized with agent ${agentConfig.name}`, LogLevel.VERBOSE);
  }

  /**
   * Generates the system prompt using the agent's configuration
   */
  protected override async generateSystemPrompt(): Promise<ContentUnion | null> {
    // Check if agentConfig is available (might not be during construction)
    if (this.agentConfig && this.agentConfig.systemPrompt.type === 'content') {
      let promptContent = this.agentConfig.systemPrompt.value;

      // Handle variable resolution if enabled
      promptContent = await this.resolvePromptVariables(promptContent);

      // Add environment context like the main agent receives
      const envParts = await this.getEnvironmentContext();
      const envText = envParts.map(part => part.text).join('\n');
      
      // Prepend environment context to the agent prompt
      const fullPromptContent = `${envText}\n\n---\n\n${promptContent}`;

      return {
        role: 'system',
        parts: [{ text: fullPromptContent }],
      };
    }

    // Fallback to parent implementation if no agent-specific prompt
    return super.generateSystemPrompt();
  }

  /**
   * Resolves variables in the prompt content
   */
  private async resolvePromptVariables(promptContent: string): Promise<string> {
    // Check if {{.AvailableAgents}} placeholder exists
    const hasAvailableAgentsPlaceholder = promptContent.includes('{{.AvailableAgents}}');
    
    if (hasAvailableAgentsPlaceholder) {
      // Replace available agents placeholder with detailed information
      const availableAgentsText = await this.getAvailableAgentsAsText();
      promptContent = promptContent.replace(
        '{{.AvailableAgents}}',
        availableAgentsText
      );
    } else {
      // Check if we have any available agents (including regex matches)
      const resolvedAgents = await this.getResolvedAvailableAgents();
      if (Array.isArray(resolvedAgents) && resolvedAgents.length > 0) {
        // If no placeholder but agents exist, append the information
        const availableAgentsText = await this.getAvailableAgentsAsText();
        promptContent += `\n\nAvailable sub-agents you can invoke:\n${availableAgentsText}`;
      }
    }

    // Replace current date placeholder
    const currentDate = new Date().toISOString().split('T')[0];
    promptContent = promptContent.replace(
      '{{.CurrentDate}}',
      currentDate
    );

    // Replace OS placeholder
    if (promptContent.includes('{{.OS}}')) {
      const osType = os.type();
      promptContent = promptContent.replace(
        '{{.OS}}',
        osType
      );
    }

    // Replace UserName placeholder
    if (promptContent.includes('{{.UserName}}')) {
      let userName = '';
      try {
        userName = os.userInfo().username;
      } catch (_e) {
        userName = process.env['USER'] || process.env['USERNAME'] || '';
      }
      promptContent = promptContent.replace(
        '{{.UserName}}',
        userName
      );
    }

    // Replace MachineName placeholder
    if (promptContent.includes('{{.MachineName}}')) {
      const machineName = os.hostname();
      promptContent = promptContent.replace(
        '{{.MachineName}}',
        machineName
      );
    }

    // Replace Shell placeholder
    if (promptContent.includes('{{.Shell}}')) {
      let shell = '';
      try {
        const platform = os.platform();
        
        if (platform === 'win32') {
          // Windows shell detection
          if (process.env['PSModulePath']) {
            shell = 'powershell';
          } else if (process.env['ComSpec']) {
            const comSpec = process.env['ComSpec'].toLowerCase();
            if (comSpec.includes('powershell')) {
              shell = 'powershell';
            } else if (comSpec.includes('cmd')) {
              shell = 'cmd';
            } else {
              shell = 'cmd'; // Default for Windows
            }
          } else {
            shell = 'cmd'; // Default fallback
          }
        } else {
          // Unix-like systems (Linux, macOS)
          shell = process.env['SHELL'] || '';
          if (shell) {
            // Extract shell name from path (e.g., /bin/bash -> bash)
            shell = shell.split('/').pop() || shell;
          } else {
            shell = 'bash'; // Default for Unix-like systems
          }
        }
        
        if (!shell) {
          shell = 'unknown';
        }
      } catch (_e) {
        shell = 'unknown';
      }
      promptContent = promptContent.replace(
        '{{.Shell}}',
        shell
      );
    }

    return promptContent;
  }

  /**
   * Gets available agents formatted as text for prompt variable replacement
   */
  private async getAvailableAgentsAsText(): Promise<string> {
    try {
      const resolvedAgents = await this.getResolvedAvailableAgents();
      if (resolvedAgents.length === 0) {
        return '';
      }

      const agentDetails: string[] = [];
      
      for (const agentName of resolvedAgents) {
        try {
          const agentConfig = await this.agentLoader.loadAgentConfig(agentName);
          agentDetails.push(`- ${agentConfig.name}: ${agentConfig.description}`);
        } catch (_error) {
          // Fallback to just the name if config can't be loaded
          agentDetails.push(`- ${agentName}`);
        }
      }
      
      return agentDetails.join('\n');
    } catch (_error) {
      // Fallback to simple agent names if there's any error
      if (this.agentConfig.availableAgents && this.agentConfig.availableAgents.length > 0) {
        return this.agentConfig.availableAgents
          .map(agent => `- ${agent}`)
          .join('\n');
      }
      return '';
    }
  }

  /**
   * Creates an AgentChat instance from a YAML configuration
   */
  static async fromAgentConfig(
    config: Config,
    contentGenerator: ContentGenerator,
    agentName: string,
    configsDir: string | string[],
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
   * Gets environment context for the agent
   */
  private async getEnvironmentContext() {
    return await getEnvironmentContext(this.config);
  }

  /**
   * Gets the list of available agents that this agent can invoke (exact names only)
   */
  getAvailableAgents(): string[] {
    return this.agentConfig.availableAgents || [];
  }

  /**
   * Gets the resolved list of available agents including regex matches
   */
  async getResolvedAvailableAgents(): Promise<string[]> {
    return await this.agentLoader.resolveAvailableAgents(
      this.agentConfig.availableAgents || []
    );
  }

  /**
   * Override getCurrentModel to use the agent's preferred model if available
   */
  protected override getCurrentModel(): string {
    const preferredModel = this.agentConfig.metadata.languageModel.preferred;
    
    // Check if the preferred model is available
    if (preferredModel && isModelAvailable(preferredModel)) {
      return preferredModel;
    }
    
    // Fallback to global model
    return super.getCurrentModel();
  }
}