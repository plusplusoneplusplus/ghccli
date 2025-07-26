/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modelCommand } from './modelCommand.js';
import { CommandContext, CommandKind } from './types.js';

describe('modelCommand', () => {
  let mockContext: CommandContext;
  let mockConfig: any;
  let mockGeminiClient: any;

  beforeEach(() => {
    mockGeminiClient = {
      getHistory: vi.fn(() => []),
      setHistory: vi.fn(),
    };

    mockConfig = {
      getModel: vi.fn(() => 'gemini-2.5-pro'),
      setModel: vi.fn(),
      getGeminiClient: vi.fn(() => mockGeminiClient),
    };

    mockContext = {
      services: {
        config: mockConfig,
        settings: {} as any,
        git: undefined,
        logger: {} as any,
      },
      ui: {
        addItem: vi.fn(),
        clear: vi.fn(),
        setDebugMessage: vi.fn(),
        toggleCorgiMode: vi.fn(),
        pendingItem: null,
        setPendingItem: vi.fn(),
        loadHistory: vi.fn(),
      },
      session: {
        stats: {} as any,
      },
    };
  });

  it('should have correct metadata', () => {
    expect(modelCommand.name).toBe('model');
    expect(modelCommand.description).toBe('switch between AI models (Gemini, GPT, Claude) or show current model');
    expect(modelCommand.kind).toBe(CommandKind.BUILT_IN);
  });

  it('should show current model and available models when no args provided', async () => {
    const result = await modelCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('🤖 Current model: gemini-2.5-pro'),
    });
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('📋 Available models:'),
    });
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: expect.stringContaining('▶️ gemini-2.5-pro'),
    });
  });

  it('should switch to a valid model', async () => {
    const result = await modelCommand.action!(mockContext, 'gemini-2.5-flash');

    expect(mockConfig.setModel).toHaveBeenCalledWith('gemini-2.5-flash');
    expect(mockGeminiClient.setHistory).toHaveBeenCalled();
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: '✅ Switched from gemini-2.5-pro to gemini-2.5-flash',
    });
  });

  it('should return error for invalid model', async () => {
    const result = await modelCommand.action!(mockContext, 'invalid-model');

    expect(mockConfig.setModel).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('❌ Unknown model: invalid-model'),
    });
  });

  it('should return error when config is not loaded', async () => {
    mockContext.services.config = null;

    const result = await modelCommand.action!(mockContext, 'gemini-2.5-flash');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Config not loaded.',
    });
  });

  it('should handle completion correctly', async () => {
    const completions = await modelCommand.completion!(mockContext, 'gemini-2.5');

    expect(completions).toContain('gemini-2.5-pro');
    expect(completions).toContain('gemini-2.5-flash');
    expect(completions).toContain('gemini-2.5-pro-preview-05-06');
    expect(completions).toContain('gemini-2.5-pro-preview-06-05');
    expect(completions).toContain('gemini-2.5-flash-preview-05-20');
  });

  it('should filter completions based on partial input', async () => {
    const completions = await modelCommand.completion!(mockContext, 'gemini-1.5');

    expect(completions).toContain('gemini-1.5-pro');
    expect(completions).toContain('gemini-1.5-flash');
    expect(completions).not.toContain('gemini-2.5-pro');
  });

  it('should work without gemini client', async () => {
    mockConfig.getGeminiClient.mockReturnValue(null);

    const result = await modelCommand.action!(mockContext, 'gemini-2.5-flash');

    expect(mockConfig.setModel).toHaveBeenCalledWith('gemini-2.5-flash');
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: '✅ Switched from gemini-2.5-pro to gemini-2.5-flash',
    });
  });

  it('should support non-Gemini models like GPT and Claude', async () => {
    const result1 = await modelCommand.action!(mockContext, 'gpt-4o');
    expect(mockConfig.setModel).toHaveBeenCalledWith('gpt-4o');
    expect(result1).toEqual({
      type: 'message',
      messageType: 'info',
      content: '✅ Switched from gemini-2.5-pro to gpt-4o',
    });

    const result2 = await modelCommand.action!(mockContext, 'claude-sonnet-4');
    expect(mockConfig.setModel).toHaveBeenCalledWith('claude-sonnet-4');
    expect(result2).toEqual({
      type: 'message',
      messageType: 'info',
      content: '✅ Switched from gemini-2.5-pro to claude-sonnet-4',
    });
  });
});
