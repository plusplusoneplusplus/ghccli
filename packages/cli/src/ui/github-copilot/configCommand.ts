/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageType } from '../types.js';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from '../commands/types.js';

export const configCommand: SlashCommand = {
  name: 'config',
  altNames: ['config'],
  description: 'display current configuration settings',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext): Promise<void> => {
    const { config } = context.services;
    
    if (!config) {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Configuration not loaded.',
        },
        Date.now(),
      );
      return;
    }

    // Build configuration display message
    let message = '\u001b[36m=== Gemini CLI Configuration ===\u001b[0m\n\n';
    
    // Core Configuration
    message += `  model: \u001b[32m${config.getModel()}\u001b[0m\n`;
    message += `  agent: \u001b[32m${config.getAgent()}\u001b[0m\n`;
    message += `  maxSessionTurns: \u001b[32m${config.getMaxSessionTurns() === -1 ? 'unlimited' : config.getMaxSessionTurns()}\u001b[0m\n`;
    if (process.env['GOOGLE_CLOUD_PROJECT']) {
      message += `  GOOGLE_CLOUD_PROJECT: \u001b[32m${process.env['GOOGLE_CLOUD_PROJECT']}\u001b[0m\n`;
    }

    // Sandbox Configuration
    const sandboxConfig = config.getSandbox();
    if (sandboxConfig) {
      message += `  sandbox.enabled: \u001b[32mtrue\u001b[0m\n`;
      message += `  sandbox.command: \u001b[32m${sandboxConfig.command}\u001b[0m\n`;
      message += `  sandbox.image: \u001b[32m${sandboxConfig.image}\u001b[0m\n`;
    } else {
      message += `  sandbox.enabled: \u001b[90mfalse\u001b[0m\n`;
    }

    // Tools Configuration
    const coreTools = config.getCoreTools();
    if (coreTools && coreTools.length > 0) {
      message += `  coreTools: \u001b[32m${coreTools.join(', ')}\u001b[0m\n`;
    }
    const excludeTools = config.getExcludeTools();
    if (excludeTools && excludeTools.length > 0) {
      message += `  excludeTools: \u001b[32m${excludeTools.join(', ')}\u001b[0m\n`;
    }
    const toolRegistry = await config.getToolRegistry();
    if (toolRegistry) {
      const allTools = toolRegistry.getAllTools();
      message += `  totalAvailableTools: \u001b[32m${allTools.length}\u001b[0m\n`;
    }

    // MCP Servers
    const mcpServers = config.getMcpServers();
    if (mcpServers && Object.keys(mcpServers).length > 0) {
      Object.entries(mcpServers).forEach(([name, serverConfig]) => {
        message += `  mcpServers.${name}:\n`;
        if (serverConfig.command) {
          message += `    command: \u001b[32m${serverConfig.command}\u001b[0m\n`;
        }
        if (serverConfig.url) {
          message += `    url: \u001b[32m${serverConfig.url}\u001b[0m\n`;
        }
        if (serverConfig.description) {
          message += `    description: \u001b[90m${serverConfig.description}\u001b[0m\n`;
        }
      });
    } else {
      message += `  mcpServers: \u001b[90mnone\u001b[0m\n`;
    }

    // File Filtering
    message += `  fileFiltering.respectGitIgnore: \u001b[32m${config.getFileFilteringRespectGitIgnore()}\u001b[0m\n`;
    message += `  fileFiltering.respectGeminiIgnore: \u001b[32m${config.getFileFilteringRespectGeminiIgnore()}\u001b[0m\n`;
    message += `  fileFiltering.enableRecursiveFileSearch: \u001b[32m${config.getEnableRecursiveFileSearch()}\u001b[0m\n`;

    // Display and Behavior
    message += `  showMemoryUsage: \u001b[32m${config.getShowMemoryUsage()}\u001b[0m\n`;
    message += `  fullContext: \u001b[32m${config.getFullContext()}\u001b[0m\n`;
    message += `  debugMode: \u001b[32m${config.getDebugMode()}\u001b[0m\n`;
    message += `  checkpointing: \u001b[32m${config.getCheckpointingEnabled()}\u001b[0m\n`;
    message += `  ideMode: \u001b[32m${config.getIdeMode()}\u001b[0m\n`;
    message += `  experimentalZedIntegration: \u001b[32m${config.getExperimentalZedIntegration()}\u001b[0m\n`;

    // Telemetry and Logging
    message += `  telemetry.enabled: \u001b[32m${config.getTelemetryEnabled()}\u001b[0m\n`;
    message += `  telemetry.logPrompts: \u001b[32m${config.getTelemetryLogPromptsEnabled()}\u001b[0m\n`;
    message += `  telemetry.target: \u001b[32m${config.getTelemetryTarget()}\u001b[0m\n`;
    const telemetryOutfile = config.getTelemetryOutfile();
    if (telemetryOutfile) {
      message += `  telemetry.outfile: \u001b[32m${telemetryOutfile}\u001b[0m\n`;
    }
    message += `  usageStatisticsEnabled: \u001b[32m${config.getUsageStatisticsEnabled()}\u001b[0m\n`;
    message += `  enableOpenAILogging: \u001b[32m${config.getEnableOpenAILogging()}\u001b[0m\n`;

    // Network and Proxy
    const proxy = config.getProxy();
    if (proxy) {
      message += `  proxy: \u001b[32m${proxy}\u001b[0m\n`;
    }
    message += `  noBrowser: \u001b[32m${config.getNoBrowser()}\u001b[0m\n`;

    // Extensions
    const extensions = config.getExtensions();
    if (extensions && extensions.length > 0) {
      extensions.forEach((ext) => {
        const status = ext.isActive ? '\u001b[32mactive\u001b[0m' : '\u001b[90minactive\u001b[0m';
        message += `  extensions.${ext.name}: \u001b[36mv${ext.version}\u001b[0m (${status})\n`;
      });
    } else {
      message += `  extensions: \u001b[90mnone\u001b[0m\n`;
    }

    // Paths and Directories
    message += `  workingDir: \u001b[32m${config.getWorkingDir()}\u001b[0m\n`;
    message += `  targetDir: \u001b[32m${config.getTargetDir()}\u001b[0m\n`;

    // Commands
    const toolDiscoveryCommand = config.getToolDiscoveryCommand();
    if (toolDiscoveryCommand) {
      message += `  toolDiscoveryCommand: \u001b[32m${toolDiscoveryCommand}\u001b[0m\n`;
    }
    const toolCallCommand = config.getToolCallCommand();
    if (toolCallCommand) {
      message += `  toolCallCommand: \u001b[32m${toolCallCommand}\u001b[0m\n`;
    }
    const mcpServerCommand = config.getMcpServerCommand();
    if (mcpServerCommand) {
      message += `  mcpServerCommand: \u001b[32m${mcpServerCommand}\u001b[0m\n`;
    }

    // Reset color at the end
    message += '\u001b[0m';

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: message,
      },
      Date.now(),
    );
  },
};