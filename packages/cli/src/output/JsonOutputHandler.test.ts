/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonOutputHandler } from './JsonOutputHandler.js';
import {
  JsonOutput,
  JsonOutputError,
  JsonOutputMetadata,
  ToolCallResult,
} from './types.js';

describe('JsonOutputHandler', () => {
  let handler: JsonOutputHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-08-06T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create handler with prettyPrint enabled by default', () => {
      handler = new JsonOutputHandler();
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const output = handler.createSuccess('test', metadata);
      const formatted = handler.format(output);
      expect(formatted).toContain('\n');
      expect(formatted).toContain('  ');
    });

    it('should create handler with prettyPrint disabled when specified', () => {
      handler = new JsonOutputHandler(false);
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const output = handler.createSuccess('test', metadata);
      const formatted = handler.format(output);
      expect(formatted).not.toContain('\n');
      expect(formatted).not.toContain('  ');
    });

    it('should create handler with prettyPrint enabled when explicitly set to true', () => {
      handler = new JsonOutputHandler(true);
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const output = handler.createSuccess('test', metadata);
      const formatted = handler.format(output);
      expect(formatted).toContain('\n');
      expect(formatted).toContain('  ');
    });
  });

  describe('createOutput', () => {
    beforeEach(() => {
      handler = new JsonOutputHandler();
    });

    it('should create basic output with required fields', () => {
      const metadata: JsonOutputMetadata = {
        sessionId: 'session1',
        promptId: 'prompt1',
        model: 'model1',
        turnCount: 1,
        timestamp: '2025-08-06T12:00:00.000Z',
      };

      const output = handler.createOutput('success', 'Test message', metadata);

      expect(output).toEqual({
        status: 'success',
        message: 'Test message',
        error: undefined,
        metadata,
        content: '',
        toolCalls: [],
        schemaVersion: 1,
      });
    });

    it('should create output with all optional fields', () => {
      const metadata: JsonOutputMetadata = {
        sessionId: 'session1',
        promptId: 'prompt1',
        model: 'model1',
        turnCount: 1,
        timestamp: '2025-08-06T12:00:00.000Z',
      };

      const error: JsonOutputError = {
        type: 'ValidationError',
        message: 'Test error',
        details: { field: 'value' },
      };

      const toolCalls: ToolCallResult[] = [
        {
          id: 'tool1',
          name: 'TestTool',
          arguments: { arg: 'value' },
          result: 'success',
          status: 'success',
          timestamp: '2025-08-06T12:00:00.000Z',
          duration: 100,
        },
      ];

      const output = handler.createOutput(
        'error',
        'Error message',
        metadata,
        'test content',
        toolCalls,
        error,
      );

      expect(output).toEqual({
        status: 'error',
        message: 'Error message',
        error,
        metadata,
        content: 'test content',
        toolCalls,
        schemaVersion: 1,
      });
    });

    it('should handle different status values', () => {
      const metadata: JsonOutputMetadata = {
        sessionId: 'session1',
        promptId: 'prompt1',
        model: 'model1',
        turnCount: 1,
        timestamp: '2025-08-06T12:00:00.000Z',
      };

      const statuses: Array<'success' | 'error' | 'partial'> = ['success', 'error', 'partial'];

      statuses.forEach((status) => {
        const output = handler.createOutput(status, 'Test', metadata);
        expect(output.status).toBe(status);
      });
    });
  });

  describe('format', () => {
    beforeEach(() => {
      handler = new JsonOutputHandler();
    });

    it('should format output with pretty print enabled', () => {
      handler = new JsonOutputHandler(true);
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const output = handler.createSuccess('test', metadata);
      const formatted = handler.format(output);

      expect(formatted).toContain('\n');
      expect(formatted).toContain('  ');
      expect(JSON.parse(formatted)).toEqual(output);
    });

    it('should format output with pretty print disabled', () => {
      handler = new JsonOutputHandler(false);
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const output = handler.createSuccess('test', metadata);
      const formatted = handler.format(output);

      expect(formatted).not.toContain('\n');
      expect(formatted).not.toContain('  ');
      expect(JSON.parse(formatted)).toEqual(output);
    });

    it('should handle complex nested objects', () => {
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const error: JsonOutputError = {
        type: 'ComplexError',
        message: 'Complex error message',
        details: {
          nested: {
            level: 2,
            array: [1, 2, 3],
            object: { key: 'value' },
          },
        },
      };

      const output = handler.createError('Error', metadata, error);
      const formatted = handler.format(output);
      const parsed = JSON.parse(formatted);

      expect(parsed.error.details.nested.level).toBe(2);
      expect(parsed.error.details.nested.array).toEqual([1, 2, 3]);
      expect(parsed.error.details.nested.object.key).toBe('value');
    });
  });

  describe('createSuccess', () => {
    beforeEach(() => {
      handler = new JsonOutputHandler();
    });

    it('should create success output with minimal parameters', () => {
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const output = handler.createSuccess('Success message', metadata);

      expect(output.status).toBe('success');
      expect(output.message).toBe('Success message');
      expect(output.error).toBeUndefined();
      expect(output.content).toBe('');
      expect(output.toolCalls).toEqual([]);
    });

    it('should create success output with content and tool calls', () => {
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const toolCalls: ToolCallResult[] = [
        handler.createToolCallResult('tool1', 'TestTool', {}, 'result', 'success', 50),
      ];

      const output = handler.createSuccess('Success', metadata, 'content', toolCalls);

      expect(output.status).toBe('success');
      expect(output.content).toBe('content');
      expect(output.toolCalls).toEqual(toolCalls);
    });
  });

  describe('createError', () => {
    beforeEach(() => {
      handler = new JsonOutputHandler();
    });

    it('should create error output with required parameters', () => {
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const error: JsonOutputError = {
        type: 'TestError',
        message: 'Error occurred',
      };

      const output = handler.createError('Error message', metadata, error);

      expect(output.status).toBe('error');
      expect(output.message).toBe('Error message');
      expect(output.error).toEqual(error);
      expect(output.content).toBe('');
      expect(output.toolCalls).toEqual([]);
    });

    it('should create error output with all parameters', () => {
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const error: JsonOutputError = {
        type: 'DetailedError',
        message: 'Detailed error',
        details: { code: 500, context: 'test' },
      };
      const toolCalls: ToolCallResult[] = [
        handler.createToolCallResult('tool1', 'FailedTool', {}, 'error', 'error', 25),
      ];

      const output = handler.createError('Error', metadata, error, 'error content', toolCalls);

      expect(output.status).toBe('error');
      expect(output.error).toEqual(error);
      expect(output.content).toBe('error content');
      expect(output.toolCalls).toEqual(toolCalls);
    });
  });

  describe('createPartial', () => {
    beforeEach(() => {
      handler = new JsonOutputHandler();
    });

    it('should create partial output with minimal parameters', () => {
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const output = handler.createPartial('Partial result', metadata);

      expect(output.status).toBe('partial');
      expect(output.message).toBe('Partial result');
      expect(output.error).toBeUndefined();
      expect(output.content).toBe('');
      expect(output.toolCalls).toEqual([]);
    });

    it('should create partial output with content and tool calls', () => {
      const metadata = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      const toolCalls: ToolCallResult[] = [
        handler.createToolCallResult('tool1', 'PartialTool', {}, 'partial', 'success', 75),
      ];

      const output = handler.createPartial('Partial', metadata, 'partial content', toolCalls);

      expect(output.status).toBe('partial');
      expect(output.content).toBe('partial content');
      expect(output.toolCalls).toEqual(toolCalls);
    });
  });

  describe('createMetadata', () => {
    beforeEach(() => {
      handler = new JsonOutputHandler();
    });

    it('should create metadata with current timestamp', () => {
      const metadata = handler.createMetadata('session123', 'prompt456', 'gpt-4', 5);

      expect(metadata).toEqual({
        sessionId: 'session123',
        promptId: 'prompt456',
        model: 'gpt-4',
        turnCount: 5,
        timestamp: '2025-08-06T12:00:00.000Z',
      });
    });

    it('should create unique timestamps for different calls', () => {
      const metadata1 = handler.createMetadata('session1', 'prompt1', 'model1', 1);
      
      vi.setSystemTime(new Date('2025-08-06T12:00:01.000Z'));
      
      const metadata2 = handler.createMetadata('session2', 'prompt2', 'model2', 2);

      expect(metadata1.timestamp).not.toBe(metadata2.timestamp);
      expect(metadata2.timestamp).toBe('2025-08-06T12:00:01.000Z');
    });
  });

  describe('createToolCallResult', () => {
    beforeEach(() => {
      handler = new JsonOutputHandler();
    });

    it('should create tool call result with required parameters', () => {
      const args = { input: 'test', count: 5 };
      const result = handler.createToolCallResult(
        'tool123',
        'TestTool',
        args,
        'operation successful',
        'success',
      );

      expect(result).toEqual({
        id: 'tool123',
        name: 'TestTool',
        arguments: args,
        result: 'operation successful',
        status: 'success',
        timestamp: '2025-08-06T12:00:00.000Z',
        duration: undefined,
      });
    });

    it('should create tool call result with duration', () => {
      const result = handler.createToolCallResult(
        'tool456',
        'SlowTool',
        { timeout: 30 },
        'completed after timeout',
        'success',
        1500,
      );

      expect(result.duration).toBe(1500);
      expect(result.status).toBe('success');
    });

    it('should create failed tool call result', () => {
      const result = handler.createToolCallResult(
        'tool789',
        'FailingTool',
        { retries: 3 },
        'maximum retries exceeded',
        'error',
        250,
      );

      expect(result.status).toBe('error');
      expect(result.result).toBe('maximum retries exceeded');
      expect(result.duration).toBe(250);
    });

    it('should handle empty arguments object', () => {
      const result = handler.createToolCallResult(
        'simple-tool',
        'SimpleTool',
        {},
        'done',
        'success',
      );

      expect(result.arguments).toEqual({});
      expect(result.name).toBe('SimpleTool');
    });
  });

  describe('integration tests', () => {
    beforeEach(() => {
      handler = new JsonOutputHandler(true);
    });

    it('should create complete success workflow', () => {
      const metadata = handler.createMetadata('session1', 'prompt1', 'claude-3', 1);
      const toolCall = handler.createToolCallResult(
        'file-read-1',
        'ReadFile',
        { path: '/test/file.txt' },
        'file content retrieved',
        'success',
        45,
      );

      const output = handler.createSuccess(
        'File read successfully',
        metadata,
        'This is the file content',
        [toolCall],
      );

      const formatted = handler.format(output);
      const parsed = JSON.parse(formatted);

      expect(parsed.status).toBe('success');
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.metadata.model).toBe('claude-3');
      expect(parsed.toolCalls[0].name).toBe('ReadFile');
      expect(parsed.content).toBe('This is the file content');
    });

    it('should create complete error workflow', () => {
      const metadata = handler.createMetadata('session2', 'prompt2', 'gpt-4', 3);
      const error: JsonOutputError = {
        type: 'FileNotFoundError',
        message: 'The requested file does not exist',
        details: {
          path: '/non/existent/file.txt',
          errno: -2,
          code: 'ENOENT',
        },
      };

      const failedToolCall = handler.createToolCallResult(
        'file-read-2',
        'ReadFile',
        { path: '/non/existent/file.txt' },
        'ENOENT: no such file or directory',
        'error',
        12,
      );

      const output = handler.createError(
        'Failed to read file',
        metadata,
        error,
        '',
        [failedToolCall],
      );

      const formatted = handler.format(output);
      const parsed = JSON.parse(formatted);

      expect(parsed.status).toBe('error');
      expect(parsed.error.type).toBe('FileNotFoundError');
      expect(parsed.error.details.code).toBe('ENOENT');
      expect(parsed.toolCalls[0].status).toBe('error');
    });
  });
});