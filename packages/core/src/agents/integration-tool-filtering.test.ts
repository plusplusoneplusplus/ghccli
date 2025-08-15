/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Config } from '../config/config.js';
import { ContentGenerator } from '../core/contentGenerator.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { MockTool } from '../test-utils/tools.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock the Config and ContentGenerator
vi.mock('../config/config.js');
vi.mock('../core/contentGenerator.js');

// Mock the getCoreSystemPrompt function
vi.mock('../core/prompts.js', () => ({
  getCoreSystemPrompt: vi.fn(() => null),
}));

// Create mock tools for testing
// Mock tools are now imported from test-utils

describe('AgentChat Tool Filtering Integration', () => {
  let mockConfig: Config;
  let mockContentGenerator: ContentGenerator;
  let toolRegistry: ToolRegistry;
  let tempConfigDir: string;
  let agentConfigPath: string;

  beforeEach(async () => {
    // Create temporary directory for agent config
    tempConfigDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-test-'));
    agentConfigPath = path.join(tempConfigDir, 'test-agent.yaml');

    // Create test agent configuration
    const agentConfig = `
name: test-agent
description: Test agent for tool filtering
methods: []
availableAgents: []
metadata:
  supportsStreaming: true
  supportsTools: true
  requiresWorkspace: false
  supportsPromptSelection: false
  languageModel:
    preferred: gemini-2.0-flash-exp
  promptSupport:
    supportsPrompts: true
    supportsTsxMessages: false
    promptParameterName: prompt
    variableResolution: false
  toolPreferences:
    allowedToolRegex:
      - "read_.*"
      - "write_.*"
  specialization: file operations
  executionConfig:
    maxRounds: 10
    maxContextTokens: 1000000
systemPrompt:
  type: content
  value: "You are a test agent for file operations only"
`;

    await fs.promises.writeFile(agentConfigPath, agentConfig);

    // Mock config
    mockConfig = {
      getUserMemory: vi.fn(() => null),
      getAgentConfigsDir: vi.fn(() => tempConfigDir),
      getToolRegistry: vi.fn(),
    } as any;

    mockContentGenerator = {} as ContentGenerator;

    // Create tool registry and register test tools
    toolRegistry = new ToolRegistry(mockConfig);
    toolRegistry.registerTool(new MockTool('read_file', 'Read File', 'Reads content from a file'));
    toolRegistry.registerTool(new MockTool('write_file', 'Write File', 'Writes content to a file'));
    toolRegistry.registerTool(new MockTool('run_shell_command', 'Run Shell Command', 'Executes a shell command'));
    toolRegistry.registerTool(new MockTool('web_search', 'Web Search', 'Searches the web'));

    // Mock the config to return our tool registry
    (mockConfig.getToolRegistry as any).mockResolvedValue(toolRegistry);
  });

  afterEach(async () => {
    // Clean up temporary files
    try {
      await fs.promises.unlink(agentConfigPath);
      await fs.promises.rmdir(tempConfigDir);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should filter tools based on agent allowedToolRegex configuration', async () => {
    // Test the tool registry filtering directly
    const allTools = toolRegistry.getFunctionDeclarations();
    expect(allTools).toHaveLength(4);
    expect(allTools.map(t => t.name).sort()).toEqual([
      'read_file',
      'run_shell_command',
      'web_search',
      'write_file'
    ]);

    // Test filtered tools with patterns that match file operations
    const filteredTools = toolRegistry.getFilteredFunctionDeclarations(['read_.*', 'write_.*']);
    expect(filteredTools).toHaveLength(2);
    expect(filteredTools.map(t => t.name).sort()).toEqual(['read_file', 'write_file']);

    // Test with pattern that matches nothing
    const noMatchTools = toolRegistry.getFilteredFunctionDeclarations(['^memory_.*']);
    expect(noMatchTools).toHaveLength(0);

    // Test with pattern that matches shell command
    const shellTools = toolRegistry.getFilteredFunctionDeclarations(['^run_shell.*']);
    expect(shellTools).toHaveLength(1);
    expect(shellTools[0].name).toBe('run_shell_command');
  });

  it('should load agent configuration and extract tool preferences', async () => {
    const { AgentLoader } = await import('./agentLoader.js');
    
    const agentLoader = new AgentLoader(tempConfigDir);
    const agentConfig = await agentLoader.loadAgentConfig('test-agent');

    expect(agentConfig.name).toBe('test-agent');
    expect(agentConfig.metadata.toolPreferences?.allowedToolRegex).toEqual(['read_.*', 'write_.*']);
    
    // Test that the filtering would work as expected
    const allowedRegex = agentConfig.metadata.toolPreferences?.allowedToolRegex || [];
    const filteredTools = toolRegistry.getFilteredFunctionDeclarations(allowedRegex);
    
    expect(filteredTools).toHaveLength(2);
    expect(filteredTools.map(t => t.name).sort()).toEqual(['read_file', 'write_file']);
  });

  it('should work with AgentChat getAllowedToolRegex method', async () => {
    const { AgentChat } = await import('./agentChat.js');
    
    const agentChat = await AgentChat.fromAgentConfig(
      mockConfig,
      mockContentGenerator,
      'test-agent',
      tempConfigDir,
      {},
      []
    );

    const allowedRegex = agentChat.getAllowedToolRegex();
    expect(allowedRegex).toEqual(['read_.*', 'write_.*']);

    // Verify that this would filter tools correctly
    const filteredTools = toolRegistry.getFilteredFunctionDeclarations(allowedRegex);
    expect(filteredTools.map(t => t.name).sort()).toEqual(['read_file', 'write_file']);
  });

  it('should work with blockedToolsRegex patterns', async () => {
    // Create agent config with blocked tools
    const agentConfigWithBlocked = `
 name: secure-agent
 description: Security-focused agent with blocked tools
 methods: []
 availableAgents: []
 metadata:
   supportsStreaming: true
   supportsTools: true
   requiresWorkspace: false
   supportsPromptSelection: false
   languageModel:
     preferred: gemini-2.0-flash-exp
   promptSupport:
     supportsPrompts: true
     supportsTsxMessages: false
     promptParameterName: prompt
     variableResolution: false
   toolPreferences:
     blockedToolsRegex:
       - "run_shell.*"
       - "web_.*"
   specialization: secure operations
   executionConfig:
     maxRounds: 10
     maxContextTokens: 1000000
 systemPrompt:
   type: content
   value: "You are a secure agent that cannot execute shell commands or access the web"
 `;

    const secureAgentPath = path.join(tempConfigDir, 'secure-agent.yaml');
    await fs.promises.writeFile(secureAgentPath, agentConfigWithBlocked);

    try {
      const { AgentChat } = await import('./agentChat.js');
      
      const agentChat = await AgentChat.fromAgentConfig(
        mockConfig,
        mockContentGenerator,
        'secure-agent',
        tempConfigDir,
        {},
        []
      );

      const blockedRegex = agentChat.getBlockedToolsRegex();
      expect(blockedRegex).toEqual(['run_shell.*', 'web_.*']);

      // Test filtering with blocking
      const filteredTools = toolRegistry.getFilteredFunctionDeclarationsWithBlocking(
        undefined, // no allowed patterns (include all)
        blockedRegex
      );
      
      // Should exclude shell and web tools
      expect(filteredTools.map(t => t.name).sort()).toEqual(['read_file', 'write_file']);
    } finally {
      await fs.promises.unlink(secureAgentPath);
    }
  });

  it('should work with both allowed and blocked patterns', async () => {
    // Create agent config with both allowed and blocked patterns
    const hybridAgentConfig = `
 name: hybrid-agent
 description: Agent with both allowed and blocked patterns
 methods: []
 availableAgents: []
 metadata:
   supportsStreaming: true
   supportsTools: true
   requiresWorkspace: false
   supportsPromptSelection: false
   languageModel:
     preferred: gemini-2.0-flash-exp
   promptSupport:
     supportsPrompts: true
     supportsTsxMessages: false
     promptParameterName: prompt
     variableResolution: false
   toolPreferences:
     allowedToolRegex:
       - ".*file.*"
       - ".*search.*"
     blockedToolsRegex:
       - ".*web.*"
   specialization: file operations with restricted web access
   executionConfig:
     maxRounds: 10
     maxContextTokens: 1000000
 systemPrompt:
   type: content
   value: "You can work with files but not access the web"
 `;

    const hybridAgentPath = path.join(tempConfigDir, 'hybrid-agent.yaml');
    await fs.promises.writeFile(hybridAgentPath, hybridAgentConfig);

    try {
      const { AgentChat } = await import('./agentChat.js');
      
      const agentChat = await AgentChat.fromAgentConfig(
        mockConfig,
        mockContentGenerator,
        'hybrid-agent',
        tempConfigDir,
        {},
        []
      );

      const allowedRegex = agentChat.getAllowedToolRegex();
      const blockedRegex = agentChat.getBlockedToolsRegex();
      
      expect(allowedRegex).toEqual(['.*file.*', '.*search.*']);
      expect(blockedRegex).toEqual(['.*web.*']);

      // Test combined filtering - should allow file tools but block web_search
      const filteredTools = toolRegistry.getFilteredFunctionDeclarationsWithBlocking(
        allowedRegex,
        blockedRegex
      );
      
      // Should include read_file, write_file but exclude web_search and run_shell_command
      expect(filteredTools.map(t => t.name).sort()).toEqual(['read_file', 'write_file']);
    } finally {
      await fs.promises.unlink(hybridAgentPath);
    }
  });
}); 