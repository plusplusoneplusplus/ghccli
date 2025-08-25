/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modelCommand } from './modelCommand.js';
import { CommandContext, CommandKind } from '../commands/types.js';

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
    expect(modelCommand.description).toBe('switch AI models interactively (/model) or directly (/model <name>)');
    expect(modelCommand.kind).toBe(CommandKind.BUILT_IN);
  });

  it('should open model dialog when no args provided', async () => {
    const result = await modelCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'dialog',
      dialog: 'model',
    });
  });

  it('should switch to a valid model', async () => {
    const result = await modelCommand.action!(mockContext, 'gpt-4o');

    expect(mockConfig.setModel).toHaveBeenCalledWith('gpt-4o');
    expect(mockGeminiClient.setHistory).toHaveBeenCalled();
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: '✅ Switched from gemini-2.5-pro to gpt-4o',
    });
  });
});