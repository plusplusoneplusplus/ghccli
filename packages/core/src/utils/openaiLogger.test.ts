/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OpenAILogger, createSessionLogger } from './openaiLogger.js';

describe('OpenAILogger', () => {
  let tempDir: string;
  let logger: OpenAILogger;
  const testSessionId = 'test-session-123';

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openai-logger-test-'));
    logger = new OpenAILogger(testSessionId, tempDir);
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('constructor', () => {
    it('should create logger with provided session ID', () => {
      expect(logger.getSessionId()).toBe(testSessionId);
    });

    it('should create logger with generated session ID when not provided', () => {
      const loggerWithoutSession = new OpenAILogger(undefined, tempDir);
      expect(loggerWithoutSession.getSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should use custom log directory', () => {
      const customDir = '/custom/path';
      const customLogger = new OpenAILogger('session', customDir);
      expect(customLogger.getSessionLogPath()).toBe(path.join(customDir, 'openai-session-session.jsonl'));
    });
  });

  describe('initialization', () => {
    it('should create log directory on first use', async () => {
      const mockRequest = { model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] };
      
      await logger.logInteraction(mockRequest);
      
      const dirExists = await fs.access(tempDir).then(() => true).catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('should handle initialization errors gracefully', async () => {
      const invalidLogger = new OpenAILogger('test', '/invalid/readonly/path');
      
      await expect(invalidLogger.logInteraction({})).rejects.toThrow();
    });
  });

  describe('logInteraction', () => {
    const mockRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello, world!' }],
      temperature: 0.7
    };

    const mockResponse = {
      id: 'chatcmpl-test123',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello! How can I help you today?' },
          finish_reason: 'stop'
        }
      ]
    };

    const mockTokenUsage = {
      promptTokens: 10,
      completionTokens: 12,
      totalTokens: 22,
      cachedTokens: 0
    };

    it('should log successful interaction in JSONL format', async () => {
      const filePath = await logger.logInteraction(
        mockRequest,
        mockResponse,
        'gpt-4',
        mockTokenUsage
      );

      expect(filePath).toBe(logger.getSessionLogPath());

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const logEntry = JSON.parse(lines[0]);
      expect(logEntry).toMatchObject({
        sessionId: testSessionId,
        model: 'gpt-4',
        tokenUsage: mockTokenUsage,
        request: mockRequest,
        response: mockResponse
      });
      expect(logEntry.error).toBeUndefined();
      expect(logEntry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(logEntry.interactionId).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should append multiple interactions to same file', async () => {
      await logger.logInteraction(mockRequest, mockResponse, 'gpt-4', mockTokenUsage);
      await logger.logInteraction(mockRequest, mockResponse, 'gpt-4', mockTokenUsage);

      const content = await fs.readFile(logger.getSessionLogPath(), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      const entry1 = JSON.parse(lines[0]);
      const entry2 = JSON.parse(lines[1]);
      expect(entry1.interactionId).not.toBe(entry2.interactionId);
      expect(entry1.sessionId).toBe(entry2.sessionId);
    });

    it('should log interaction without token usage', async () => {
      await logger.logInteraction(mockRequest, mockResponse, 'gpt-4');

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries).toHaveLength(1);
      expect(entries[0].tokenUsage).toBeUndefined();
    });

    it('should log interaction without model', async () => {
      await logger.logInteraction(mockRequest, mockResponse);

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries).toHaveLength(1);
      expect(entries[0].model).toBe('unknown');
    });

    it('should handle null response', async () => {
      await logger.logInteraction(mockRequest, null, 'gpt-4', mockTokenUsage);

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries).toHaveLength(1);
      expect(entries[0].response).toBe(null);
    });
  });

  describe('error logging', () => {
    it('should log error interactions', async () => {
      const mockRequest = { model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] };
      const mockError = new Error('Rate limit exceeded');
      const mockTokenUsage = { promptTokens: 10, completionTokens: 0, totalTokens: 10 };

      await logger.logInteraction(
        mockRequest,
        undefined,
        'gpt-4',
        mockTokenUsage,
        mockError
      );

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        request: mockRequest,
        response: null,
        model: 'gpt-4',
        tokenUsage: mockTokenUsage,
        error: {
          message: 'Rate limit exceeded',
          stack: expect.any(String)
        }
      });
    });

    it('should handle error without stack trace', async () => {
      const mockRequest = { model: 'gpt-4', messages: [] };
      const mockError = new Error('Simple error');
      delete mockError.stack;

      await logger.logInteraction(mockRequest, undefined, 'gpt-4', undefined, mockError);

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries[0].error).toEqual({
        message: 'Simple error',
        stack: undefined
      });
    });
  });

  describe('readLogFile', () => {
    it('should read and parse JSONL file correctly', async () => {
      const mockEntries = [
        { request: { test: 1 }, model: 'gpt-4' },
        { request: { test: 2 }, model: 'gpt-3.5-turbo' }
      ];

      for (const entry of mockEntries) {
        await logger.logInteraction(entry.request, undefined, entry.model);
      }

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries).toHaveLength(2);
      expect(entries[0].request).toEqual({ test: 1 });
      expect(entries[1].request).toEqual({ test: 2 });
    });

    it('should handle empty log file', async () => {
      await fs.writeFile(logger.getSessionLogPath(), '', 'utf-8');
      
      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries).toEqual([]);
    });

    it('should handle file with empty lines', async () => {
      const validEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionId: 'test',
        interactionId: 'test',
        model: 'gpt-4',
        request: { test: true }
      });

      await fs.writeFile(logger.getSessionLogPath(), `${validEntry}\n\n\n${validEntry}\n`, 'utf-8');
      
      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries).toHaveLength(2);
    });

    it('should throw error for non-existent file', async () => {
      await expect(logger.readLogFile('/non/existent/file.jsonl')).rejects.toThrow();
    });

    it('should throw error for invalid JSON', async () => {
      await fs.writeFile(logger.getSessionLogPath(), 'invalid json\n', 'utf-8');
      
      await expect(logger.readLogFile(logger.getSessionLogPath())).rejects.toThrow();
    });
  });

  describe('getLogFiles', () => {
    it('should return log files in directory', async () => {
      // Create multiple session loggers
      const logger1 = new OpenAILogger('session-1', tempDir);
      const logger2 = new OpenAILogger('session-2', tempDir);
      
      await logger1.logInteraction({ test: 1 });
      await logger2.logInteraction({ test: 2 });

      const logFiles = await logger.getLogFiles();
      expect(logFiles).toHaveLength(2);
      expect(logFiles.some(f => f.includes('session-1'))).toBe(true);
      expect(logFiles.some(f => f.includes('session-2'))).toBe(true);
    });

    it('should limit number of returned files', async () => {
      const logger1 = new OpenAILogger('session-1', tempDir);
      const logger2 = new OpenAILogger('session-2', tempDir);
      const logger3 = new OpenAILogger('session-3', tempDir);
      
      await logger1.logInteraction({ test: 1 });
      await logger2.logInteraction({ test: 2 });
      await logger3.logInteraction({ test: 3 });

      const logFiles = await logger.getLogFiles(2);
      expect(logFiles).toHaveLength(2);
    });

    it('should return empty array for non-existent directory', async () => {
      const nonExistentLogger = new OpenAILogger('test', '/non/existent/dir');
      
      // This should handle the case gracefully and return empty array
      await expect(nonExistentLogger.getLogFiles()).resolves.toEqual([]);
    });

    it('should filter only JSONL log files', async () => {
      // Create some non-log files
      await fs.writeFile(path.join(tempDir, 'not-a-log.txt'), 'content');
      await fs.writeFile(path.join(tempDir, 'openai-session-test.json'), '{}');
      
      await logger.logInteraction({ test: true });

      const logFiles = await logger.getLogFiles();
      expect(logFiles).toHaveLength(1);
      expect(logFiles[0]).toContain('openai-session-');
      expect(logFiles[0]).toContain('.jsonl');
    });
  });

  describe('session-specific functionality', () => {
    it('should create separate files for different sessions', async () => {
      const logger1 = new OpenAILogger('session-1', tempDir);
      const logger2 = new OpenAILogger('session-2', tempDir);

      await logger1.logInteraction({ from: 'session-1' });
      await logger2.logInteraction({ from: 'session-2' });

      expect(logger1.getSessionLogPath()).not.toBe(logger2.getSessionLogPath());

      const entries1 = await logger1.readLogFile(logger1.getSessionLogPath());
      const entries2 = await logger2.readLogFile(logger2.getSessionLogPath());

      expect(entries1[0].sessionId).toBe('session-1');
      expect(entries2[0].sessionId).toBe('session-2');
      expect(entries1[0].request).toEqual({ from: 'session-1' });
      expect(entries2[0].request).toEqual({ from: 'session-2' });
    });

    it('should return correct session log path', () => {
      const sessionId = 'my-test-session';
      const testLogger = new OpenAILogger(sessionId, tempDir);
      
      const expectedPath = path.join(tempDir, `openai-session-${sessionId}.jsonl`);
      expect(testLogger.getSessionLogPath()).toBe(expectedPath);
    });
  });

  describe('createSessionLogger factory', () => {
    it('should create logger with provided session ID', () => {
      const sessionLogger = createSessionLogger('factory-test');
      expect(sessionLogger.getSessionId()).toBe('factory-test');
    });

    it('should create logger with generated session ID when not provided', () => {
      const sessionLogger = createSessionLogger();
      expect(sessionLogger.getSessionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('token usage tracking', () => {
    it('should log complete token usage information', async () => {
      const tokenUsage = {
        promptTokens: 150,
        completionTokens: 75,
        totalTokens: 225,
        cachedTokens: 25
      };

      await logger.logInteraction(
        { test: 'request' },
        { test: 'response' },
        'gpt-4',
        tokenUsage
      );

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries[0].tokenUsage).toEqual(tokenUsage);
    });

    it('should handle partial token usage information', async () => {
      const tokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
        // cachedTokens omitted
      };

      await logger.logInteraction(
        { test: 'request' },
        { test: 'response' },
        'gpt-4',
        tokenUsage
      );

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries[0].tokenUsage).toEqual(tokenUsage);
      expect(entries[0].tokenUsage?.cachedTokens).toBeUndefined();
    });
  });

  describe('large data handling', () => {
    it('should handle large request/response objects', async () => {
      const largeRequest = {
        model: 'gpt-4',
        messages: Array(100).fill(null).map((_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `This is message ${i} with some content that makes it longer`.repeat(10)
        }))
      };

      const largeResponse = {
        choices: [{
          message: {
            role: 'assistant',
            content: 'Very long response content '.repeat(1000)
          }
        }]
      };

      await logger.logInteraction(largeRequest, largeResponse, 'gpt-4');

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries).toHaveLength(1);
      expect(entries[0].request).toEqual(largeRequest);
      expect(entries[0].response).toEqual(largeResponse);
    });
  });

  describe('concurrent logging', () => {
    it('should handle concurrent log writes', async () => {
      const promises = Array(10).fill(null).map((_, i) => 
        logger.logInteraction(
          { requestId: i },
          { responseId: i },
          'gpt-4',
          { promptTokens: i, completionTokens: i, totalTokens: i * 2 }
        )
      );

      await Promise.all(promises);

      const entries = await logger.readLogFile(logger.getSessionLogPath());
      expect(entries).toHaveLength(10);

      // Verify all entries are unique and properly formatted
      const requestIds = entries.map(e => (e.request as any).requestId);
      expect(new Set(requestIds).size).toBe(10);
    });
  });
});