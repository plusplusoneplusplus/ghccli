/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { AgentConfig } from './agentTypes.js';

export class AgentLoader {
  private configsDirs: string[];

  constructor(configsDir: string | string[]) {
    this.configsDirs = Array.isArray(configsDir) ? configsDir : [configsDir];
  }

  /**
   * Loads an agent configuration from YAML file and its associated prompt file
   */
  async loadAgentConfig(agentName: string): Promise<AgentConfig> {
    let lastError: Error | null = null;
    
    // Try each directory in order until we find the agent
    for (const configsDir of this.configsDirs) {
      const yamlPath = path.join(configsDir, `${agentName}.yaml`);
      
      try {
        const yamlContent = await fs.readFile(yamlPath, 'utf-8');
        const config = YAML.parse(yamlContent) as AgentConfig;
        
        if (!config) {
          throw new Error(`Failed to parse YAML config for agent: ${agentName}`);
        }

        // If the system prompt is a file reference, load its content
        if (config.systemPrompt.type === 'file') {
          const promptPath = path.join(configsDir, config.systemPrompt.value);
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
        lastError = error as Error;
        continue;
      }
    }
    
    throw new Error(`Failed to load agent config for ${agentName}: ${lastError?.message || 'Agent not found in any directory'}`);
  }


  /**
   * Lists all available agent names across all configs directories
   */
  async listAvailableAgents(): Promise<string[]> {
    const allAgents = new Set<string>();
    
    for (const configsDir of this.configsDirs) {
      try {
        const files = await fs.readdir(configsDir);
        files
          .filter(file => file.endsWith('.yaml'))
          .map(file => file.replace('.yaml', ''))
          .forEach(agent => allAgents.add(agent));
      } catch (error) {
        // Skip directories that don't exist or can't be read
        continue;
      }
    }
    
    return Array.from(allAgents).sort();
  }

  /**
   * Checks if an agent config exists in any of the directories
   */
  async agentExists(agentName: string): Promise<boolean> {
    for (const configsDir of this.configsDirs) {
      const yamlPath = path.join(configsDir, `${agentName}.yaml`);
      try {
        await fs.access(yamlPath);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * Resolves agent names from patterns (can be exact names or regex patterns)
   */
  async resolveAvailableAgents(patterns: string[]): Promise<string[]> {
    const resolvedAgents = new Set<string>();
    const allAvailableAgents = await this.listAvailableAgents();
    
    for (const pattern of patterns) {
      // First try exact match
      if (await this.agentExists(pattern)) {
        resolvedAgents.add(pattern);
        continue;
      }
      
      // Then try as regex pattern
      try {
        const regex = new RegExp(pattern);
        for (const agentName of allAvailableAgents) {
          if (regex.test(agentName)) {
            resolvedAgents.add(agentName);
          }
        }
      } catch (error) {
        // Skip invalid regex patterns
        console.warn(`Invalid regex pattern in availableAgents: ${pattern}`, error);
      }
    }
    
    return Array.from(resolvedAgents).sort();
  }
}