/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';

// Mock the OpenAI Logger from the core package to prevent file system operations during tests
vi.mock('@google/gemini-cli-core', async () => {
  const actual = await vi.importActual('@google/gemini-cli-core');
  
  const mockLogger = {
    logInteraction: vi.fn().mockResolvedValue('mock-log-path'),
    getSessionId: vi.fn().mockReturnValue('mock-session-id'),
    getSessionLogPath: vi.fn().mockReturnValue('mock-log-path'),
    readLogFile: vi.fn().mockResolvedValue([]),
    getLogFiles: vi.fn().mockResolvedValue([]),
  };

  return {
    ...actual,
    createSessionLogger: vi.fn().mockReturnValue(mockLogger),
    openaiLogger: {
      instance: mockLogger,
      logInteraction: mockLogger.logInteraction,
      readLogFile: mockLogger.readLogFile,
      getLogFiles: mockLogger.getLogFiles,
    },
  };
});