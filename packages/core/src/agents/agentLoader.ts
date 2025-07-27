/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { AgentConfig } from './agentTypes.js';

export class AgentLoader {
  private configsDir: string;

  constructor(configsDir: string) {
    this.configsDir = configsDir;
  }

  /**
   * Loads an agent configuration from YAML file and its associated prompt file
   */
  async loadAgentConfig(agentName: string): Promise<AgentConfig> {
    const yamlPath = path.join(this.configsDir, `${agentName}.yaml`);
    
    try {
      const yamlContent = await fs.readFile(yamlPath, 'utf-8');
      const config = YAML.parse(yamlContent) as AgentConfig;
      
      if (!config) {
        throw new Error(`Failed to parse YAML config for agent: ${agentName}`);
      }

      // If the system prompt is a file reference, load its content
      if (config.systemPrompt.type === 'file') {
        const promptPath = path.join(this.configsDir, config.systemPrompt.value);
        try {
          const promptContent = await fs.readFile(promptPath, 'utf-8');
          config.systemPrompt = {
            type: 'content',
            value: promptContent
          };
        } catch (error) {
          throw new Error(`Failed to load prompt file ${promptPath}: ${error}`);
        }
      }

      return config;
    } catch (error) {
      throw new Error(`Failed to load agent config for ${agentName}: ${error}`);
    }
  }


  /**
   * Lists all available agent names in the configs directory
   */
  async listAvailableAgents(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.configsDir);
      return files
        .filter(file => file.endsWith('.yaml'))
        .map(file => file.replace('.yaml', ''));
    } catch (error) {
      throw new Error(`Failed to list agents in ${this.configsDir}: ${error}`);
    }
  }

  /**
   * Checks if an agent config exists
   */
  async agentExists(agentName: string): Promise<boolean> {
    const yamlPath = path.join(this.configsDir, `${agentName}.yaml`);
    try {
      await fs.access(yamlPath);
      return true;
    } catch {
      return false;
    }
  }
}