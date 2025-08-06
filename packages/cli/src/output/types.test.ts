/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  JsonOutput,
  JsonOutputError,
  JsonOutputMetadata,
  ToolCallResult,
} from './types.js';

describe('Output Types', () => {
  describe('ToolCallResult', () => {
    it('should accept valid tool call result with required fields', () => {
      const toolCall: ToolCallResult = {
        id: 'tool-123',
        name: 'TestTool',
        arguments: { input: 'test' },
        result: 'success',
        status: 'success',
        timestamp: '2025-08-06T12:00:00.000Z',
      };

      expect(toolCall.id).toBe('tool-123');
      expect(toolCall.name).toBe('TestTool');
      expect(toolCall.arguments).toEqual({ input: 'test' });
      expect(toolCall.result).toBe('success');
      expect(toolCall.status).toBe('success');
      expect(toolCall.timestamp).toBe('2025-08-06T12:00:00.000Z');
      expect(toolCall.duration).toBeUndefined();
    });

    it('should accept valid tool call result with optional duration', () => {
      const toolCall: ToolCallResult = {
        id: 'tool-456',
        name: 'SlowTool',
        arguments: {},
        result: 'completed',
        status: 'success',
        timestamp: '2025-08-06T12:00:00.000Z',
        duration: 1500,
      };

      expect(toolCall.duration).toBe(1500);
    });

    it('should accept error status', () => {
      const toolCall: ToolCallResult = {
        id: 'tool-error',
        name: 'FailingTool',
        arguments: { retries: 3 },
        result: 'failed after 3 retries',
        status: 'error',
        timestamp: '2025-08-06T12:00:00.000Z',
      };

      expect(toolCall.status).toBe('error');
    });

    it('should handle complex arguments object', () => {
      const complexArgs = {
        stringArg: 'test',
        numberArg: 42,
        booleanArg: true,
        arrayArg: [1, 2, 3],
        objectArg: {
          nested: 'value',
          count: 10,
        },
      };

      const toolCall: ToolCallResult = {
        id: 'complex-tool',
        name: 'ComplexTool',
        arguments: complexArgs,
        result: 'processed complex arguments',
        status: 'success',
        timestamp: '2025-08-06T12:00:00.000Z',
      };

      expect(toolCall.arguments).toEqual(complexArgs);
    });
  });

  describe('JsonOutputError', () => {
    it('should accept error with required fields only', () => {
      const error: JsonOutputError = {
        type: 'ValidationError',
        message: 'Input validation failed',
      };

      expect(error.type).toBe('ValidationError');
      expect(error.message).toBe('Input validation failed');
      expect(error.details).toBeUndefined();
    });

    it('should accept error with optional details', () => {
      const details = {
        field: 'email',
        value: 'invalid-email',
        code: 'INVALID_FORMAT',
        suggestions: ['user@example.com'],
      };

      const error: JsonOutputError = {
        type: 'ValidationError',
        message: 'Email format is invalid',
        details,
      };

      expect(error.details).toEqual(details);
    });

    it('should handle different error types', () => {
      const errorTypes = [
        'ValidationError',
        'NetworkError',
        'AuthenticationError',
        'FileSystemError',
        'TimeoutError',
      ];

      errorTypes.forEach((type) => {
        const error: JsonOutputError = {
          type,
          message: `This is a ${type}`,
        };
        expect(error.type).toBe(type);
      });
    });

    it('should handle complex details object', () => {
      const error: JsonOutputError = {
        type: 'SystemError',
        message: 'System encountered multiple errors',
        details: {
          errors: [
            { code: 'ERR001', message: 'First error' },
            { code: 'ERR002', message: 'Second error' },
          ],
          context: {
            operation: 'file_processing',
            timestamp: '2025-08-06T12:00:00.000Z',
            user: 'test-user',
          },
          recovery: {
            possible: true,
            steps: ['retry operation', 'check permissions', 'contact support'],
          },
        },
      };

      expect(error.details).toBeDefined();
      expect((error.details as any).errors).toHaveLength(2);
      expect((error.details as any).recovery.possible).toBe(true);
    });
  });

  describe('JsonOutputMetadata', () => {
    it('should accept valid metadata with all required fields', () => {
      const metadata: JsonOutputMetadata = {
        sessionId: 'session-abc-123',
        promptId: 'prompt-def-456',
        model: 'claude-3-sonnet',
        turnCount: 5,
        timestamp: '2025-08-06T12:00:00.000Z',
      };

      expect(metadata.sessionId).toBe('session-abc-123');
      expect(metadata.promptId).toBe('prompt-def-456');
      expect(metadata.model).toBe('claude-3-sonnet');
      expect(metadata.turnCount).toBe(5);
      expect(metadata.timestamp).toBe('2025-08-06T12:00:00.000Z');
    });

    it('should handle different model names', () => {
      const models = [
        'claude-3-sonnet',
        'claude-3-haiku',
        'gpt-4',
        'gpt-3.5-turbo',
        'gemini-pro',
      ];

      models.forEach((model) => {
        const metadata: JsonOutputMetadata = {
          sessionId: 'session-1',
          promptId: 'prompt-1',
          model,
          turnCount: 1,
          timestamp: '2025-08-06T12:00:00.000Z',
        };
        expect(metadata.model).toBe(model);
      });
    });

    it('should handle different turn counts', () => {
      [0, 1, 10, 100, 999].forEach((turnCount) => {
        const metadata: JsonOutputMetadata = {
          sessionId: 'session-1',
          promptId: 'prompt-1',
          model: 'test-model',
          turnCount,
          timestamp: '2025-08-06T12:00:00.000Z',
        };
        expect(metadata.turnCount).toBe(turnCount);
      });
    });

    it('should handle ISO timestamp formats', () => {
      const timestamps = [
        '2025-08-06T12:00:00.000Z',
        '2025-08-06T12:00:00Z',
        '2025-12-31T23:59:59.999Z',
        '2025-01-01T00:00:00.000Z',
      ];

      timestamps.forEach((timestamp) => {
        const metadata: JsonOutputMetadata = {
          sessionId: 'session-1',
          promptId: 'prompt-1',
          model: 'test-model',
          turnCount: 1,
          timestamp,
        };
        expect(metadata.timestamp).toBe(timestamp);
      });
    });
  });

  describe('JsonOutput', () => {
    const createBasicMetadata = (): JsonOutputMetadata => ({
      sessionId: 'session-1',
      promptId: 'prompt-1',
      model: 'test-model',
      turnCount: 1,
      timestamp: '2025-08-06T12:00:00.000Z',
    });

    it('should accept success output with minimal fields', () => {
      const output: JsonOutput = {
        status: 'success',
        message: 'Operation completed successfully',
        metadata: createBasicMetadata(),
        content: '',
        toolCalls: [],
        schemaVersion: 1,
      };

      expect(output.status).toBe('success');
      expect(output.message).toBe('Operation completed successfully');
      expect(output.error).toBeUndefined();
      expect(output.content).toBe('');
      expect(output.toolCalls).toEqual([]);
      expect(output.schemaVersion).toBe(1);
    });

    it('should accept error output with error object', () => {
      const error: JsonOutputError = {
        type: 'TestError',
        message: 'Test error occurred',
      };

      const output: JsonOutput = {
        status: 'error',
        message: 'Operation failed',
        error,
        metadata: createBasicMetadata(),
        content: 'Error details in content',
        toolCalls: [],
        schemaVersion: 1,
      };

      expect(output.status).toBe('error');
      expect(output.error).toEqual(error);
      expect(output.content).toBe('Error details in content');
    });

    it('should accept partial output', () => {
      const output: JsonOutput = {
        status: 'partial',
        message: 'Operation partially completed',
        metadata: createBasicMetadata(),
        content: 'Partial results',
        toolCalls: [],
        schemaVersion: 1,
      };

      expect(output.status).toBe('partial');
      expect(output.content).toBe('Partial results');
    });

    it('should accept output with tool calls', () => {
      const toolCalls: ToolCallResult[] = [
        {
          id: 'tool-1',
          name: 'ReadFile',
          arguments: { path: '/test.txt' },
          result: 'file content',
          status: 'success',
          timestamp: '2025-08-06T12:00:00.000Z',
          duration: 50,
        },
        {
          id: 'tool-2',
          name: 'WriteFile',
          arguments: { path: '/output.txt', content: 'new content' },
          result: 'file written',
          status: 'success',
          timestamp: '2025-08-06T12:00:01.000Z',
          duration: 75,
        },
      ];

      const output: JsonOutput = {
        status: 'success',
        message: 'Files processed',
        metadata: createBasicMetadata(),
        content: 'Processing completed',
        toolCalls,
        schemaVersion: 1,
      };

      expect(output.toolCalls).toEqual(toolCalls);
      expect(output.toolCalls).toHaveLength(2);
    });

    it('should accept output with rich content', () => {
      const output: JsonOutput = {
        status: 'success',
        message: 'Generated comprehensive report',
        metadata: createBasicMetadata(),
        content: `# Analysis Report

## Summary
The analysis completed successfully with the following results:

- **Files processed**: 42
- **Errors found**: 3
- **Warnings**: 7
- **Performance score**: 85/100

## Recommendations
1. Fix the identified errors
2. Address performance bottlenecks
3. Update documentation

## Next Steps
- Review error details
- Implement suggested improvements
- Schedule follow-up analysis`,
        toolCalls: [],
        schemaVersion: 1,
      };

      expect(output.content).toContain('# Analysis Report');
      expect(output.content).toContain('**Files processed**: 42');
    });

    it('should validate schema version', () => {
      const output: JsonOutput = {
        status: 'success',
        message: 'Test',
        metadata: createBasicMetadata(),
        content: '',
        toolCalls: [],
        schemaVersion: 1,
      };

      expect(output.schemaVersion).toBe(1);
    });

    it('should handle all status types', () => {
      const statuses: Array<'success' | 'error' | 'partial'> = ['success', 'error', 'partial'];

      statuses.forEach((status) => {
        const output: JsonOutput = {
          status,
          message: `Test ${status} message`,
          metadata: createBasicMetadata(),
          content: '',
          toolCalls: [],
          schemaVersion: 1,
        };
        expect(output.status).toBe(status);
      });
    });
  });

  describe('Type compatibility and structure', () => {
    it('should ensure JsonOutput contains all expected top-level fields', () => {
      const output: JsonOutput = {
        status: 'success',
        message: 'test',
        metadata: {
          sessionId: 'session',
          promptId: 'prompt',
          model: 'model',
          turnCount: 1,
          timestamp: '2025-08-06T12:00:00.000Z',
        },
        content: 'content',
        toolCalls: [],
        schemaVersion: 1,
      };

      // Verify all expected properties exist on the type
      expect(typeof output.status).toBe('string');
      expect(typeof output.message).toBe('string');
      expect(typeof output.metadata).toBe('object');
      expect(typeof output.content).toBe('string');
      expect(Array.isArray(output.toolCalls)).toBe(true);
      expect(typeof output.schemaVersion).toBe('number');
    });

    it('should validate that optional error field can be omitted', () => {
      const outputWithoutError: JsonOutput = {
        status: 'success',
        message: 'test',
        metadata: {
          sessionId: 'session',
          promptId: 'prompt',
          model: 'model',
          turnCount: 1,
          timestamp: '2025-08-06T12:00:00.000Z',
        },
        content: '',
        toolCalls: [],
        schemaVersion: 1,
      };

      expect(outputWithoutError.error).toBeUndefined();
    });

    it('should validate that metadata contains all required fields', () => {
      const metadata: JsonOutputMetadata = {
        sessionId: 'test-session',
        promptId: 'test-prompt',
        model: 'test-model',
        turnCount: 5,
        timestamp: '2025-08-06T12:00:00.000Z',
      };

      // Ensure all required fields are present
      expect(metadata).toHaveProperty('sessionId');
      expect(metadata).toHaveProperty('promptId');
      expect(metadata).toHaveProperty('model');
      expect(metadata).toHaveProperty('turnCount');
      expect(metadata).toHaveProperty('timestamp');
    });
  });
});