/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionDeclaration } from '@google/genai';
import { AnyDeclarativeTool, Kind, ToolResult, BaseTool } from './tools.js';
import { Config } from '../config/config.js';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { discoverMcpTools } from './mcp-client.js';
import { DiscoveredMCPTool } from './mcp-tool.js';
import { parse } from 'shell-quote';

type ToolParams = Record<string, unknown>;

export class DiscoveredTool extends BaseTool<ToolParams, ToolResult> {
  constructor(
    private readonly config: Config,
    name: string,
    override readonly description: string,
    override readonly parameterSchema: Record<string, unknown>,
  ) {
    const discoveryCmd = config.getToolDiscoveryCommand()!;
    const callCommand = config.getToolCallCommand()!;
    description += `

This tool was discovered from the project by executing the command \`${discoveryCmd}\` on project root.
When called, this tool will execute the command \`${callCommand} ${name}\` on project root.
Tool discovery and call commands can be configured in project or user settings.

When called, the tool call command is executed as a subprocess.
On success, tool output is returned as a json string.
Otherwise, the following information is returned:

Stdout: Output on stdout stream. Can be \`(empty)\` or partial.
Stderr: Output on stderr stream. Can be \`(empty)\` or partial.
Error: Error or \`(none)\` if no error was reported for the subprocess.
Exit Code: Exit code or \`(none)\` if terminated by signal.
Signal: Signal number or \`(none)\` if no signal was received.
`;
    super(
      name,
      name,
      description,
      Kind.Other,
      parameterSchema,
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  async execute(params: ToolParams): Promise<ToolResult> {
    const callCommand = this.config.getToolCallCommand()!;
    const child = spawn(callCommand, [this.name]);
    child.stdin.write(JSON.stringify(params));
    child.stdin.end();

    let stdout = '';
    let stderr = '';
    let error: Error | null = null;
    let code: number | null = null;
    let signal: NodeJS.Signals | null = null;

    await new Promise<void>((resolve) => {
      const onStdout = (data: Buffer) => {
        stdout += data?.toString();
      };

      const onStderr = (data: Buffer) => {
        stderr += data?.toString();
      };

      const onError = (err: Error) => {
        error = err;
      };

      const onClose = (
        _code: number | null,
        _signal: NodeJS.Signals | null,
      ) => {
        code = _code;
        signal = _signal;
        cleanup();
        resolve();
      };

      const cleanup = () => {
        child.stdout.removeListener('data', onStdout);
        child.stderr.removeListener('data', onStderr);
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
        if (child.connected) {
          child.disconnect();
        }
      };

      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);
      child.on('error', onError);
      child.on('close', onClose);
    });

    // if there is any error, non-zero exit code, signal, or stderr, return error details instead of stdout
    if (error || code !== 0 || signal || stderr) {
      const llmContent = [
        `Stdout: ${stdout || '(empty)'}`,
        `Stderr: ${stderr || '(empty)'}`,
        `Error: ${error ?? '(none)'}`,
        `Exit Code: ${code ?? '(none)'}`,
        `Signal: ${signal ?? '(none)'}`,
      ].join('\n');
      return {
        llmContent,
        returnDisplay: llmContent,
      };
    }

    return {
      llmContent: stdout,
      returnDisplay: stdout,
    };
  }
}

export class ToolRegistry {
  private tools: Map<string, AnyDeclarativeTool> = new Map();
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Registers a tool definition.
   * @param tool - The tool object containing schema and execution logic.
   */
  registerTool(tool: AnyDeclarativeTool): void {
    if (this.tools.has(tool.name)) {
      if (tool instanceof DiscoveredMCPTool) {
        tool = tool.asFullyQualifiedTool();
      } else {
        // Decide on behavior: throw error, log warning, or allow overwrite
        console.warn(
          `Tool with name "${tool.name}" is already registered. Overwriting.`,
        );
      }
    }
    this.tools.set(tool.name, tool);
  }

  private removeDiscoveredTools(): void {
    for (const tool of this.tools.values()) {
      if (tool instanceof DiscoveredTool || tool instanceof DiscoveredMCPTool) {
        this.tools.delete(tool.name);
      }
    }
  }

  /**
   * Removes all tools from a specific MCP server.
   * @param serverName The name of the server to remove tools from.
   */
  removeMcpToolsByServer(serverName: string): void {
    for (const [name, tool] of this.tools.entries()) {
      if (tool instanceof DiscoveredMCPTool && tool.serverName === serverName) {
        this.tools.delete(name);
      }
    }
  }

  /**
   * Discovers tools from project (if available and configured).
   * Can be called multiple times to update discovered tools.
   * This will discover tools from the command line and from MCP servers.
   */
  async discoverAllTools(): Promise<void> {
    // remove any previously discovered tools
    this.removeDiscoveredTools();

    this.config.getPromptRegistry().clear();

    await this.discoverAndRegisterToolsFromCommand();

    // discover tools using MCP servers, if configured
    await discoverMcpTools(
      this.config.getMcpServers() ?? {},
      this.config.getMcpServerCommand(),
      this,
      this.config.getPromptRegistry(),
      this.config.getDebugMode(),
      this.config.getWorkspaceContext(),
    );
  }

  /**
   * Discovers tools from project (if available and configured).
   * Can be called multiple times to update discovered tools.
   * This will NOT discover tools from the command line, only from MCP servers.
   */
  async discoverMcpTools(): Promise<void> {
    // remove any previously discovered tools
    this.removeDiscoveredTools();

    this.config.getPromptRegistry().clear();

    // discover tools using MCP servers, if configured
    await discoverMcpTools(
      this.config.getMcpServers() ?? {},
      this.config.getMcpServerCommand(),
      this,
      this.config.getPromptRegistry(),
      this.config.getDebugMode(),
      this.config.getWorkspaceContext(),
    );
  }

  /**
   * Discover or re-discover tools for a single MCP server.
   * @param serverName - The name of the server to discover tools from.
   */
  async discoverToolsForServer(serverName: string): Promise<void> {
    // Remove any previously discovered tools from this server
    for (const [name, tool] of this.tools.entries()) {
      if (tool instanceof DiscoveredMCPTool && tool.serverName === serverName) {
        this.tools.delete(name);
      }
    }

    this.config.getPromptRegistry().removePromptsByServer(serverName);

    const mcpServers = this.config.getMcpServers() ?? {};
    const serverConfig = mcpServers[serverName];
    if (serverConfig) {
      await discoverMcpTools(
        { [serverName]: serverConfig },
        undefined,
        this,
        this.config.getPromptRegistry(),
        this.config.getDebugMode(),
        this.config.getWorkspaceContext(),
      );
    }
  }

  private async discoverAndRegisterToolsFromCommand(): Promise<void> {
    const discoveryCmd = this.config.getToolDiscoveryCommand();
    if (!discoveryCmd) {
      return;
    }

    try {
      const cmdParts = parse(discoveryCmd);
      if (cmdParts.length === 0) {
        throw new Error(
          'Tool discovery command is empty or contains only whitespace.',
        );
      }
      const proc = spawn(cmdParts[0] as string, cmdParts.slice(1) as string[]);
      let stdout = '';
      const stdoutDecoder = new StringDecoder('utf8');
      let stderr = '';
      const stderrDecoder = new StringDecoder('utf8');
      let sizeLimitExceeded = false;
      const MAX_STDOUT_SIZE = 10 * 1024 * 1024; // 10MB limit
      const MAX_STDERR_SIZE = 10 * 1024 * 1024; // 10MB limit

      let stdoutByteLength = 0;
      let stderrByteLength = 0;

      proc.stdout.on('data', (data) => {
        if (sizeLimitExceeded) return;
        if (stdoutByteLength + data.length > MAX_STDOUT_SIZE) {
          sizeLimitExceeded = true;
          proc.kill();
          return;
        }
        stdoutByteLength += data.length;
        stdout += stdoutDecoder.write(data);
      });

      proc.stderr.on('data', (data) => {
        if (sizeLimitExceeded) return;
        if (stderrByteLength + data.length > MAX_STDERR_SIZE) {
          sizeLimitExceeded = true;
          proc.kill();
          return;
        }
        stderrByteLength += data.length;
        stderr += stderrDecoder.write(data);
      });

      await new Promise<void>((resolve, reject) => {
        proc.on('error', reject);
        proc.on('close', (code) => {
          stdout += stdoutDecoder.end();
          stderr += stderrDecoder.end();

          if (sizeLimitExceeded) {
            return reject(
              new Error(
                `Tool discovery command output exceeded size limit of ${MAX_STDOUT_SIZE} bytes.`,
              ),
            );
          }

          if (code !== 0) {
            console.error(`Command failed with code ${code}`);
            console.error(stderr);
            return reject(
              new Error(`Tool discovery command failed with exit code ${code}`),
            );
          }
          resolve();
        });
      });

      // execute discovery command and extract function declarations (w/ or w/o "tool" wrappers)
      const functions: FunctionDeclaration[] = [];
      const discoveredItems = JSON.parse(stdout.trim());

      if (!discoveredItems || !Array.isArray(discoveredItems)) {
        throw new Error(
          'Tool discovery command did not return a JSON array of tools.',
        );
      }

      for (const tool of discoveredItems) {
        if (tool && typeof tool === 'object') {
          if (Array.isArray(tool['function_declarations'])) {
            functions.push(...tool['function_declarations']);
          } else if (Array.isArray(tool['functionDeclarations'])) {
            functions.push(...tool['functionDeclarations']);
          } else if (tool['name']) {
            functions.push(tool as FunctionDeclaration);
          }
        }
      }
      // register each function as a tool
      for (const func of functions) {
        if (!func.name) {
          console.warn('Discovered a tool with no name. Skipping.');
          continue;
        }
        const parameters =
          func.parametersJsonSchema &&
          typeof func.parametersJsonSchema === 'object' &&
          !Array.isArray(func.parametersJsonSchema)
            ? func.parametersJsonSchema
            : {};
        this.registerTool(
          new DiscoveredTool(
            this.config,
            func.name,
            func.description ?? '',
            parameters as Record<string, unknown>,
          ),
        );
      }
    } catch (e) {
      console.error(`Tool discovery command "${discoveryCmd}" failed:`, e);
      throw e;
    }
  }

  /**
   * Retrieves the list of tool schemas (FunctionDeclaration array).
   * Extracts the declarations from the ToolListUnion structure.
   * Includes discovered (vs registered) tools if configured.
   * @returns An array of FunctionDeclarations.
   */
  getFunctionDeclarations(): FunctionDeclaration[] {
    const declarations: FunctionDeclaration[] = [];
    this.tools.forEach((tool) => {
      declarations.push(tool.schema);
    });
    return declarations;
  }

  /**
   * Retrieves the list of tool schemas (FunctionDeclaration array) filtered by allowed tool regex patterns.
   * Only includes tools whose names match at least one of the provided regex patterns.
   * @param allowedToolRegex - Array of regex patterns to match tool names against
   * @returns An array of FunctionDeclarations that match the allowed patterns.
   */
  getFilteredFunctionDeclarations(allowedToolRegex: string[]): FunctionDeclaration[] {
    if (!allowedToolRegex || allowedToolRegex.length === 0) {
      return this.getFunctionDeclarations();
    }

    const declarations: FunctionDeclaration[] = [];
    const compiledRegexes = allowedToolRegex.map(pattern => {
      try {
        return new RegExp(pattern);
      } catch (error) {
        console.warn(`Invalid regex pattern "${pattern}": ${error}`);
        return null;
      }
    }).filter(regex => regex !== null) as RegExp[];

    if (compiledRegexes.length === 0) {
      console.warn('No valid regex patterns provided, returning all tools');
      return this.getFunctionDeclarations();
    }

    this.tools.forEach((tool) => {
      const toolName = tool.name;
      const isAllowed = compiledRegexes.some(regex => regex.test(toolName));
      if (isAllowed) {
        declarations.push(tool.schema);
      }
    });

    return declarations;
  }

  /**
   * Retrieves a filtered list of tool schemas based on a list of tool names.
   * @param toolNames - An array of tool names to include.
   * @returns An array of FunctionDeclarations for the specified tools.
   */
  getFunctionDeclarationsFiltered(toolNames: string[]): FunctionDeclaration[] {
    const declarations: FunctionDeclaration[] = [];
    for (const name of toolNames) {
      const tool = this.tools.get(name);
      if (tool) {
        declarations.push(tool.schema);
      }
    }
    return declarations;
  }

  /**
   * Retrieves the list of tool schemas (FunctionDeclaration array) filtered by both allowed and blocked tool regex patterns.
   * First applies allowedToolRegex filter (if provided), then removes tools matching blockedToolsRegex.
   * @param allowedToolRegex - Array of regex patterns for tools to include (whitelist). If empty, includes all tools.
   * @param blockedToolsRegex - Array of regex patterns for tools to exclude (blacklist).
   * @returns An array of FunctionDeclarations that match the criteria.
   */
  getFilteredFunctionDeclarationsWithBlocking(
    allowedToolRegex?: string[],
    blockedToolsRegex?: string[]
  ): FunctionDeclaration[] {
    // Start with allowed tools (or all tools if no allowlist)
    const allowedDeclarations = allowedToolRegex && allowedToolRegex.length > 0
      ? this.getFilteredFunctionDeclarations(allowedToolRegex)
      : this.getFunctionDeclarations();

    // If no blocked patterns, return allowed tools
    if (!blockedToolsRegex || blockedToolsRegex.length === 0) {
      return allowedDeclarations;
    }

    // Compile blocked regex patterns
    const compiledBlockedRegexes = blockedToolsRegex.map(pattern => {
      try {
        return new RegExp(pattern);
      } catch (error) {
        console.warn(`Invalid blocked regex pattern "${pattern}": ${error}`);
        return null;
      }
    }).filter(regex => regex !== null) as RegExp[];

    if (compiledBlockedRegexes.length === 0) {
      console.warn('No valid blocked regex patterns, returning allowed tools');
      return allowedDeclarations;
    }

    // Filter out blocked tools
    const filteredDeclarations = allowedDeclarations.filter(declaration => {
      const toolName = declaration.name!;
      const isBlocked = compiledBlockedRegexes.some(regex => regex.test(toolName));
      return !isBlocked;
    });

    return filteredDeclarations;
  }

  /**
   * Returns an array of all registered and discovered tool instances.
   */
  getAllTools(): AnyDeclarativeTool[] {
    return Array.from(this.tools.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  /**
   * Returns an array of tools registered from a specific MCP server.
   */
  getToolsByServer(serverName: string): AnyDeclarativeTool[] {
    const serverTools: AnyDeclarativeTool[] = [];
    for (const tool of this.tools.values()) {
      if ((tool as DiscoveredMCPTool)?.serverName === serverName) {
        serverTools.push(tool);
      }
    }
    return serverTools.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get the definition of a specific tool.
   */
  getTool(name: string): AnyDeclarativeTool | undefined {
    return this.tools.get(name);
  }
}
