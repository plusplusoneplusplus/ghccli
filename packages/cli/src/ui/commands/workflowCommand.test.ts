/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { workflowCommand } from './workflowCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';

// Mock the workflow tool module
vi.mock('@google/gemini-cli-core', () => ({
  WorkflowTool: class MockWorkflowTool {
    execute = vi.fn();
  },
}));

describe('workflowCommand', () => {
  it('should display an error if config is not loaded', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: null,
      },
    });

    if (!workflowCommand.action) throw new Error('Action not defined');
    const result = await workflowCommand.action(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Config not loaded.',
    });
  });

  it('should display usage when no subcommand is provided', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {},
      },
    });

    if (!workflowCommand.action) throw new Error('Action not defined');
    const result = await workflowCommand.action(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('Usage: /workflow <subcommand>'),
    });
  });

  it('should handle run subcommand without workflow name', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {},
      },
    });

    if (!workflowCommand.action) throw new Error('Action not defined');
    const result = await workflowCommand.action(mockContext, 'run');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Usage: /workflow run <name> [variables]',
    });
  });

  it('should handle invalid JSON variables for run subcommand', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {},
      },
    });

    if (!workflowCommand.action) throw new Error('Action not defined');
    const result = await workflowCommand.action(mockContext, 'run test-workflow invalid-json');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Invalid variables format. Use JSON format: {"key": "value"}',
    });
  });

  it('should handle status subcommand without workflow name', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {},
      },
    });

    if (!workflowCommand.action) throw new Error('Action not defined');
    const result = await workflowCommand.action(mockContext, 'status');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Usage: /workflow status <name>',
    });
  });

  it('should handle validate subcommand without workflow name', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {},
      },
    });

    if (!workflowCommand.action) throw new Error('Action not defined');
    const result = await workflowCommand.action(mockContext, 'validate');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Usage: /workflow validate <name>',
    });
  });

  it('should handle validate subcommand with workflow name', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {},
      },
    });

    if (!workflowCommand.action) throw new Error('Action not defined');
    const result = await workflowCommand.action(mockContext, 'validate test-workflow');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'Validate functionality for workflow "test-workflow" is not yet implemented.',
    });
  });

  it('should handle unknown subcommand', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {},
      },
    });

    if (!workflowCommand.action) throw new Error('Action not defined');
    const result = await workflowCommand.action(mockContext, 'unknown');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('Unknown subcommand: unknown'),
    });
  });

  it('should provide completion for subcommands', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {},
      },
    });

    if (!workflowCommand.completion) throw new Error('Completion not defined');
    const completions = await workflowCommand.completion(mockContext, 'r');

    expect(completions).toContain('run');
    expect(completions).not.toContain('list');
    expect(completions).not.toContain('status');
  });

  it('should provide all subcommands when no partial match', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: {},
      },
    });

    if (!workflowCommand.completion) throw new Error('Completion not defined');
    const completions = await workflowCommand.completion(mockContext, '');

    expect(completions).toEqual(['run', 'list', 'status', 'validate']);
  });

  it('should return empty completions when config is not available', async () => {
    const mockContext = createMockCommandContext({
      services: {
        config: null,
      },
    });

    if (!workflowCommand.completion) throw new Error('Completion not defined');
    const completions = await workflowCommand.completion(mockContext, 'run test');

    expect(completions).toEqual([]);
  });
});