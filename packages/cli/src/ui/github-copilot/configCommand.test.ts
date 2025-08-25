/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { configCommand } from './configCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import { TelemetryTarget } from '@google/gemini-cli-core';

describe('configCommand', () => {
  let mockContext: CommandContext;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear environment variables for clean tests
    delete process.env.GOOGLE_CLOUD_PROJECT;
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('when config is not loaded', () => {
    beforeEach(() => {
      mockContext = createMockCommandContext({
        services: {
          config: null,
        },
        ui: {
          addItem: vi.fn(),
        },
      } as unknown as CommandContext);
    });

    it('should display error message', async () => {
      await configCommand.action!(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.ERROR,
          text: 'Configuration not loaded.',
        },
        expect.any(Number),
      );
    });
  });

  describe('when config is loaded', () => {
    beforeEach(() => {
      const mockConfig = {
        getModel: vi.fn().mockReturnValue('gemini-1.5-pro'),
        getAgent: vi.fn().mockReturnValue('research-lead-agent'),
        getMaxSessionTurns: vi.fn().mockReturnValue(-1),
        getSandbox: vi.fn().mockReturnValue(undefined),
        getCoreTools: vi.fn().mockReturnValue(['shell', 'file_system']),
        getExcludeTools: vi.fn().mockReturnValue(['web_search']),
        getToolRegistry: vi.fn().mockResolvedValue({
          getAllTools: vi.fn().mockReturnValue(['tool1', 'tool2', 'tool3']),
        }),
        getMcpServers: vi.fn().mockReturnValue({}),
        getFileFilteringRespectGitIgnore: vi.fn().mockReturnValue(true),
        getFileFilteringRespectGeminiIgnore: vi.fn().mockReturnValue(true),
        getEnableRecursiveFileSearch: vi.fn().mockReturnValue(true),
        getShowMemoryUsage: vi.fn().mockReturnValue(false),
        getFullContext: vi.fn().mockReturnValue(false),
        getDebugMode: vi.fn().mockReturnValue(false),
        getCheckpointingEnabled: vi.fn().mockReturnValue(false),
        getIdeMode: vi.fn().mockReturnValue(false),
        getExperimentalAcp: vi.fn().mockReturnValue(false),
        getTelemetryEnabled: vi.fn().mockReturnValue(false),
        getTelemetryLogPromptsEnabled: vi.fn().mockReturnValue(true),
        getTelemetryTarget: vi.fn().mockReturnValue(TelemetryTarget.LOCAL),
        getTelemetryOutfile: vi.fn().mockReturnValue(undefined),
        getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
        getEnableOpenAILogging: vi.fn().mockReturnValue(true),
        getProxy: vi.fn().mockReturnValue(undefined),
        getNoBrowser: vi.fn().mockReturnValue(false),
        getExtensions: vi.fn().mockReturnValue([]),
        getWorkingDir: vi.fn().mockReturnValue('/test/working/dir'),
        getTargetDir: vi.fn().mockReturnValue('/test/target/dir'),
        getToolDiscoveryCommand: vi.fn().mockReturnValue(undefined),
        getToolCallCommand: vi.fn().mockReturnValue(undefined),
        getMcpServerCommand: vi.fn().mockReturnValue(undefined),
      };

      mockContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          addItem: vi.fn(),
        },
      } as unknown as CommandContext);
    });

    it('should display basic configuration', async () => {
      await configCommand.action!(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: expect.stringContaining('=== Gemini CLI Configuration ==='),
        },
        expect.any(Number),
      );

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      // Check core configuration
      expect(message).toContain('model: \u001b[32mgemini-1.5-pro\u001b[0m');
      expect(message).toContain('agent: \u001b[32mresearch-lead-agent\u001b[0m');
      expect(message).toContain('maxSessionTurns: \u001b[32munlimited\u001b[0m');
    });

    it('should display sandbox as disabled when not configured', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('sandbox.enabled: \u001b[90mfalse\u001b[0m');
    });

    it('should display tools configuration', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('coreTools: \u001b[32mshell, file_system\u001b[0m');
      expect(message).toContain('excludeTools: \u001b[32mweb_search\u001b[0m');
      expect(message).toContain('totalAvailableTools: \u001b[32m3\u001b[0m');
    });

    it('should display file filtering settings', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('fileFiltering.respectGitIgnore: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('fileFiltering.respectGeminiIgnore: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('fileFiltering.enableRecursiveFileSearch: \u001b[32mtrue\u001b[0m');
    });

    it('should display telemetry and logging settings', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('telemetry.enabled: \u001b[32mfalse\u001b[0m');
      expect(message).toContain('usageStatisticsEnabled: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('enableOpenAILogging: \u001b[32mtrue\u001b[0m');
    });

    it('should display paths', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('workingDir: \u001b[32m/test/working/dir\u001b[0m');
      expect(message).toContain('targetDir: \u001b[32m/test/target/dir\u001b[0m');
    });
  });

  describe('with sandbox enabled', () => {
    beforeEach(() => {
      const mockConfig = {
        getModel: vi.fn().mockReturnValue('gemini-1.5-pro'),
        getAgent: vi.fn().mockReturnValue('default'),
        getMaxSessionTurns: vi.fn().mockReturnValue(50),
        getSandbox: vi.fn().mockReturnValue({
          command: 'docker',
          image: 'test-image:latest',
        }),
        getCoreTools: vi.fn().mockReturnValue(undefined),
        getExcludeTools: vi.fn().mockReturnValue(undefined),
        getToolRegistry: vi.fn().mockResolvedValue({
          getAllTools: vi.fn().mockReturnValue([]),
        }),
        getMcpServers: vi.fn().mockReturnValue({}),
        getFileFilteringRespectGitIgnore: vi.fn().mockReturnValue(false),
        getFileFilteringRespectGeminiIgnore: vi.fn().mockReturnValue(false),
        getEnableRecursiveFileSearch: vi.fn().mockReturnValue(false),
        getShowMemoryUsage: vi.fn().mockReturnValue(true),
        getFullContext: vi.fn().mockReturnValue(true),
        getDebugMode: vi.fn().mockReturnValue(true),
        getCheckpointingEnabled: vi.fn().mockReturnValue(true),
        getIdeMode: vi.fn().mockReturnValue(true),
        getExperimentalAcp: vi.fn().mockReturnValue(true),
        getTelemetryEnabled: vi.fn().mockReturnValue(true),
        getTelemetryLogPromptsEnabled: vi.fn().mockReturnValue(false),
        getTelemetryTarget: vi.fn().mockReturnValue(TelemetryTarget.GCP),
        getTelemetryOutfile: vi.fn().mockReturnValue('/tmp/telemetry.log'),
        getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
        getEnableOpenAILogging: vi.fn().mockReturnValue(true),
        getProxy: vi.fn().mockReturnValue('http://proxy.example.com:8080'),
        getNoBrowser: vi.fn().mockReturnValue(true),
        getExtensions: vi.fn().mockReturnValue([]),
        getWorkingDir: vi.fn().mockReturnValue('/test/working/dir'),
        getTargetDir: vi.fn().mockReturnValue('/test/target/dir'),
        getToolDiscoveryCommand: vi.fn().mockReturnValue('discovery-cmd'),
        getToolCallCommand: vi.fn().mockReturnValue('call-cmd'),
        getMcpServerCommand: vi.fn().mockReturnValue('mcp-cmd'),
      };

      mockContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          addItem: vi.fn(),
        },
      } as unknown as CommandContext);
    });

    it('should display sandbox configuration when enabled', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('sandbox.enabled: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('sandbox.command: \u001b[32mdocker\u001b[0m');
      expect(message).toContain('sandbox.image: \u001b[32mtest-image:latest\u001b[0m');
    });

    it('should display limited session turns when configured', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('maxSessionTurns: \u001b[32m50\u001b[0m');
    });

    it('should display all boolean flags as true when enabled', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('showMemoryUsage: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('fullContext: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('debugMode: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('checkpointing: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('ideMode: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('experimentalAcp: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('enableOpenAILogging: \u001b[32mtrue\u001b[0m');
      expect(message).toContain('noBrowser: \u001b[32mtrue\u001b[0m');
    });

    it('should display proxy when configured', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('proxy: \u001b[32mhttp://proxy.example.com:8080\u001b[0m');
    });

    it('should display telemetry outfile when configured', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('telemetry.outfile: \u001b[32m/tmp/telemetry.log\u001b[0m');
    });

    it('should display commands when configured', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('toolDiscoveryCommand: \u001b[32mdiscovery-cmd\u001b[0m');
      expect(message).toContain('toolCallCommand: \u001b[32mcall-cmd\u001b[0m');
      expect(message).toContain('mcpServerCommand: \u001b[32mmcp-cmd\u001b[0m');
    });
  });

  describe('with MCP servers configured', () => {
    beforeEach(() => {
      const mockConfig = {
        getModel: vi.fn().mockReturnValue('gemini-1.5-pro'),
        getAgent: vi.fn().mockReturnValue('default'),
        getMaxSessionTurns: vi.fn().mockReturnValue(-1),
        getSandbox: vi.fn().mockReturnValue(undefined),
        getCoreTools: vi.fn().mockReturnValue(undefined),
        getExcludeTools: vi.fn().mockReturnValue(undefined),
        getToolRegistry: vi.fn().mockResolvedValue({
          getAllTools: vi.fn().mockReturnValue([]),
        }),
        getMcpServers: vi.fn().mockReturnValue({
          'test-server': {
            command: 'node server.js',
            description: 'Test MCP server',
          },
          'web-server': {
            url: 'http://localhost:3000',
            description: 'Web-based MCP server',
          },
        }),
        getFileFilteringRespectGitIgnore: vi.fn().mockReturnValue(true),
        getFileFilteringRespectGeminiIgnore: vi.fn().mockReturnValue(true),
        getEnableRecursiveFileSearch: vi.fn().mockReturnValue(true),
        getShowMemoryUsage: vi.fn().mockReturnValue(false),
        getFullContext: vi.fn().mockReturnValue(false),
        getDebugMode: vi.fn().mockReturnValue(false),
        getCheckpointingEnabled: vi.fn().mockReturnValue(false),
        getIdeMode: vi.fn().mockReturnValue(false),
        getExperimentalAcp: vi.fn().mockReturnValue(false),
        getTelemetryEnabled: vi.fn().mockReturnValue(false),
        getTelemetryLogPromptsEnabled: vi.fn().mockReturnValue(true),
        getTelemetryTarget: vi.fn().mockReturnValue(TelemetryTarget.LOCAL),
        getTelemetryOutfile: vi.fn().mockReturnValue(undefined),
        getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
        getEnableOpenAILogging: vi.fn().mockReturnValue(true),
        getProxy: vi.fn().mockReturnValue(undefined),
        getNoBrowser: vi.fn().mockReturnValue(false),
        getExtensions: vi.fn().mockReturnValue([]),
        getWorkingDir: vi.fn().mockReturnValue('/test/working/dir'),
        getTargetDir: vi.fn().mockReturnValue('/test/target/dir'),
        getToolDiscoveryCommand: vi.fn().mockReturnValue(undefined),
        getToolCallCommand: vi.fn().mockReturnValue(undefined),
        getMcpServerCommand: vi.fn().mockReturnValue(undefined),
      };

      mockContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          addItem: vi.fn(),
        },
      } as unknown as CommandContext);
    });

    it('should display MCP servers when configured', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('mcpServers.test-server:');
      expect(message).toContain('command: \u001b[32mnode server.js\u001b[0m');
      expect(message).toContain('description: \u001b[90mTest MCP server\u001b[0m');

      expect(message).toContain('mcpServers.web-server:');
      expect(message).toContain('url: \u001b[32mhttp://localhost:3000\u001b[0m');
      expect(message).toContain('description: \u001b[90mWeb-based MCP server\u001b[0m');
    });
  });

  describe('with extensions configured', () => {
    beforeEach(() => {
      const mockConfig = {
        getModel: vi.fn().mockReturnValue('gemini-1.5-pro'),
        getAgent: vi.fn().mockReturnValue('default'),
        getMaxSessionTurns: vi.fn().mockReturnValue(-1),
        getSandbox: vi.fn().mockReturnValue(undefined),
        getCoreTools: vi.fn().mockReturnValue(undefined),
        getExcludeTools: vi.fn().mockReturnValue(undefined),
        getToolRegistry: vi.fn().mockResolvedValue({
          getAllTools: vi.fn().mockReturnValue([]),
        }),
        getMcpServers: vi.fn().mockReturnValue({}),
        getFileFilteringRespectGitIgnore: vi.fn().mockReturnValue(true),
        getFileFilteringRespectGeminiIgnore: vi.fn().mockReturnValue(true),
        getEnableRecursiveFileSearch: vi.fn().mockReturnValue(true),
        getShowMemoryUsage: vi.fn().mockReturnValue(false),
        getFullContext: vi.fn().mockReturnValue(false),
        getDebugMode: vi.fn().mockReturnValue(false),
        getCheckpointingEnabled: vi.fn().mockReturnValue(false),
        getIdeMode: vi.fn().mockReturnValue(false),
        getExperimentalAcp: vi.fn().mockReturnValue(false),
        getTelemetryEnabled: vi.fn().mockReturnValue(false),
        getTelemetryLogPromptsEnabled: vi.fn().mockReturnValue(true),
        getTelemetryTarget: vi.fn().mockReturnValue(TelemetryTarget.LOCAL),
        getTelemetryOutfile: vi.fn().mockReturnValue(undefined),
        getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
        getEnableOpenAILogging: vi.fn().mockReturnValue(true),
        getProxy: vi.fn().mockReturnValue(undefined),
        getNoBrowser: vi.fn().mockReturnValue(false),
        getExtensions: vi.fn().mockReturnValue([
          {
            name: 'test-extension',
            version: '1.0.0',
            isActive: true,
          },
          {
            name: 'inactive-extension',
            version: '2.1.0',
            isActive: false,
          },
        ]),
        getWorkingDir: vi.fn().mockReturnValue('/test/working/dir'),
        getTargetDir: vi.fn().mockReturnValue('/test/target/dir'),
        getToolDiscoveryCommand: vi.fn().mockReturnValue(undefined),
        getToolCallCommand: vi.fn().mockReturnValue(undefined),
        getMcpServerCommand: vi.fn().mockReturnValue(undefined),
      };

      mockContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          addItem: vi.fn(),
        },
      } as unknown as CommandContext);
    });

    it('should display extensions with their status', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('extensions.test-extension: \u001b[36mv1.0.0\u001b[0m (\u001b[32mactive\u001b[0m)');
      expect(message).toContain('extensions.inactive-extension: \u001b[36mv2.1.0\u001b[0m (\u001b[90minactive\u001b[0m)');
    });
  });

  describe('with GOOGLE_CLOUD_PROJECT environment variable', () => {
    beforeEach(() => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-gcp-project';

      const mockConfig = {
        getModel: vi.fn().mockReturnValue('gemini-1.5-pro'),
        getAgent: vi.fn().mockReturnValue('default'),
        getMaxSessionTurns: vi.fn().mockReturnValue(-1),
        getSandbox: vi.fn().mockReturnValue(undefined),
        getCoreTools: vi.fn().mockReturnValue(undefined),
        getExcludeTools: vi.fn().mockReturnValue(undefined),
        getToolRegistry: vi.fn().mockResolvedValue({
          getAllTools: vi.fn().mockReturnValue([]),
        }),
        getMcpServers: vi.fn().mockReturnValue({}),
        getFileFilteringRespectGitIgnore: vi.fn().mockReturnValue(true),
        getFileFilteringRespectGeminiIgnore: vi.fn().mockReturnValue(true),
        getEnableRecursiveFileSearch: vi.fn().mockReturnValue(true),
        getShowMemoryUsage: vi.fn().mockReturnValue(false),
        getFullContext: vi.fn().mockReturnValue(false),
        getDebugMode: vi.fn().mockReturnValue(false),
        getCheckpointingEnabled: vi.fn().mockReturnValue(false),
        getIdeMode: vi.fn().mockReturnValue(false),
        getExperimentalAcp: vi.fn().mockReturnValue(false),
        getTelemetryEnabled: vi.fn().mockReturnValue(false),
        getTelemetryLogPromptsEnabled: vi.fn().mockReturnValue(true),
        getTelemetryTarget: vi.fn().mockReturnValue(TelemetryTarget.LOCAL),
        getTelemetryOutfile: vi.fn().mockReturnValue(undefined),
        getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
        getEnableOpenAILogging: vi.fn().mockReturnValue(true),
        getProxy: vi.fn().mockReturnValue(undefined),
        getNoBrowser: vi.fn().mockReturnValue(false),
        getExtensions: vi.fn().mockReturnValue([]),
        getWorkingDir: vi.fn().mockReturnValue('/test/working/dir'),
        getTargetDir: vi.fn().mockReturnValue('/test/target/dir'),
        getToolDiscoveryCommand: vi.fn().mockReturnValue(undefined),
        getToolCallCommand: vi.fn().mockReturnValue(undefined),
        getMcpServerCommand: vi.fn().mockReturnValue(undefined),
      };

      mockContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          addItem: vi.fn(),
        },
      } as unknown as CommandContext);
    });

    it('should display GOOGLE_CLOUD_PROJECT when set', async () => {
      await configCommand.action!(mockContext, '');

      const callArgs = vi.mocked(mockContext.ui.addItem).mock.calls[0];
      const message = callArgs[0].text;

      expect(message).toContain('GOOGLE_CLOUD_PROJECT: \u001b[32mtest-gcp-project\u001b[0m');
    });
  });

  describe('command metadata', () => {
    it('should have correct command properties', () => {
      expect(configCommand.name).toBe('config');
      expect(configCommand.altNames).toEqual(['config']);
      expect(configCommand.description).toBe('display current configuration settings');
      expect(configCommand.kind).toBe('built-in');
    });
  });
});