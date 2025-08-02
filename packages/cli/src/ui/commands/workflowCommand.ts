/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  SlashCommandActionReturn,
  CommandContext,
  CommandKind,
} from './types.js';
import { MessageType } from '../types.js';
import { WorkflowTool } from '@google/gemini-cli-core';
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { cwd } from 'node:process';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

async function findWorkflowFiles(searchPath: string = cwd()): Promise<string[]> {
  try {
    const entries = await readdir(searchPath, { withFileTypes: true });
    const workflowFiles: string[] = [];
    
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === '.yml' || ext === '.yaml') {
          try {
            const fullPath = join(searchPath, entry.name);
            const content = await readFile(fullPath, 'utf-8');
            const data = parseYaml(content);
            if (data && typeof data === 'object' && 'name' in data && 'steps' in data) {
              workflowFiles.push(data.name as string);
            }
          } catch {
            // Skip invalid workflow files
          }
        }
      }
    }
    
    return workflowFiles;
  } catch {
    return [];
  }
}

export const workflowCommand: SlashCommand = {
  name: 'workflow',
  description: 'manage and execute workflows',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const { config } = context.services;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Config not loaded.',
      };
    }

    const trimmedArgs = args.trim();
    const [subCommand, ...subArgs] = trimmedArgs.split(/\s+/);

    if (!subCommand) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'Usage: /workflow <subcommand> [args]\n\nAvailable subcommands:\n  run <name> [variables] - Execute a workflow\n  list [path] - List available workflows\n  status <name> - Show workflow execution status\n  validate <name> - Validate workflow definition',
      };
    }

    const workflowTool = new WorkflowTool(config);

    switch (subCommand.toLowerCase()) {
      case 'run': {
        const workflowName = subArgs[0];
        if (!workflowName) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /workflow run <name> [variables]',
          };
        }

        let variables = {};
        if (subArgs.length > 1) {
          try {
            variables = JSON.parse(subArgs.slice(1).join(' '));
          } catch {
            return {
              type: 'message',
              messageType: 'error',
              content: 'Invalid variables format. Use JSON format: {"key": "value"}',
            };
          }
        }

        const signal = new AbortController().signal;
        let progressMessage = '';
        
        const updateOutput = (output: string) => {
          progressMessage += output;
          context.ui.setPendingItem({
            type: MessageType.INFO,
            text: `Executing workflow "${workflowName}"...\n\n${progressMessage}`,
          });
        };

        try {
          context.ui.setPendingItem({
            type: MessageType.INFO,
            text: `Starting workflow "${workflowName}"...`,
          });

          const result = await workflowTool.execute({
            action: 'runWorkflow',
            name: workflowName,
            variables,
          }, signal, updateOutput);

          context.ui.setPendingItem(null);
          const errorCheck = typeof result.llmContent === 'string' && result.llmContent.includes('Error');
          context.ui.addItem({
            type: errorCheck ? MessageType.ERROR : MessageType.INFO,
            text: (typeof result.returnDisplay === 'string' ? result.returnDisplay : JSON.stringify(result.returnDisplay)) || (typeof result.llmContent === 'string' ? result.llmContent : JSON.stringify(result.llmContent)),
          }, Date.now());

          return {
            type: 'message',
            messageType: 'info',
            content: '',
          };
        } catch (error) {
          context.ui.setPendingItem(null);
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to execute workflow: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      case 'list': {
        const searchPath = subArgs[0] || cwd();
        
        try {
          const result = await workflowTool.execute({
            action: 'listWorkflows',
            path: searchPath,
          }, new AbortController().signal);

          context.ui.addItem({
            type: MessageType.INFO,
            text: (typeof result.returnDisplay === 'string' ? result.returnDisplay : JSON.stringify(result.returnDisplay)) || (typeof result.llmContent === 'string' ? result.llmContent : JSON.stringify(result.llmContent)),
          }, Date.now());

          return {
            type: 'message',
            messageType: 'info',
            content: '',
          };
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to list workflows: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      case 'status': {
        const workflowName = subArgs[0];
        if (!workflowName) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /workflow status <name>',
          };
        }

        try {
          const result = await workflowTool.execute({
            action: 'workflowStatus',
            name: workflowName,
          }, new AbortController().signal);

          context.ui.addItem({
            type: MessageType.INFO,
            text: (typeof result.returnDisplay === 'string' ? result.returnDisplay : JSON.stringify(result.returnDisplay)) || (typeof result.llmContent === 'string' ? result.llmContent : JSON.stringify(result.llmContent)),
          }, Date.now());

          return {
            type: 'message',
            messageType: 'info',
            content: '',
          };
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to get workflow status: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      case 'validate': {
        const workflowName = subArgs[0];
        if (!workflowName) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /workflow validate <name>',
          };
        }

        return {
          type: 'message',
          messageType: 'info',
          content: `Validate functionality for workflow "${workflowName}" is not yet implemented.`,
        };
      }

      default:
        return {
          type: 'message',
          messageType: 'error',
          content: `Unknown subcommand: ${subCommand}\n\nAvailable subcommands: run, list, status, validate`,
        };
    }
  },
  completion: async (
    context: CommandContext,
    partialArg: string,
  ): Promise<string[]> => {
    const { config } = context.services;
    if (!config) {
      return [];
    }

    const args = partialArg.trim().split(/\s+/);
    const [subCommand, ...subArgs] = args;

    // Complete subcommands
    if (args.length <= 1) {
      const subCommands = ['run', 'list', 'status', 'validate'];
      return subCommands.filter(cmd => 
        cmd.toLowerCase().startsWith((subCommand || '').toLowerCase())
      );
    }

    // Complete workflow names for run, status, and validate subcommands
    if ((subCommand === 'run' || subCommand === 'status' || subCommand === 'validate') && args.length === 2) {
      try {
        const workflowNames = await findWorkflowFiles();
        const partial = subArgs[0] || '';
        return workflowNames.filter(name => 
          name.toLowerCase().startsWith(partial.toLowerCase())
        );
      } catch {
        return [];
      }
    }

    return [];
  },
};