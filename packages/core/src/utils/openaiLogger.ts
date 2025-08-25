/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import { GEMINI_DIR } from './paths.js';

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

interface LogEntry {
  timestamp: string;
  sessionId: string;
  interactionId: string;
  model: string;
  tokenUsage?: TokenUsage;
  request: unknown;
  response?: unknown;
  error?: {
    message: string;
    stack?: string;
  };
}

/**
 * Logger specifically for OpenAI API requests and responses
 * Logs to session-specific JSONL files with token usage tracking
 */
export class OpenAILogger {
  private logDir: string;
  private initialized: boolean = false;
  private sessionId: string;
  private sessionStartTime: string;
  private sessionLogFilePath: string;
  private initializationPromise: Promise<void>;

  /**
   * Creates a new OpenAI logger
   * @param sessionId Session identifier for this logging session
   * @param customLogPath Optional custom log file path or directory path
   */
  constructor(sessionId?: string, customLogPath?: string) {
    this.sessionId = sessionId || uuidv4();
    // Generate timestamp in yyyy_MM_dd_hh_mm_ss format
    const now = new Date();
    this.sessionStartTime = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}_${String(now.getMinutes()).padStart(2, '0')}_${String(now.getSeconds()).padStart(2, '0')}`;

    if (customLogPath) {
      // If the custom path ends with .jsonl or .log, treat it as a complete file path
      if (customLogPath.endsWith('.jsonl') || customLogPath.endsWith('.log')) {
        this.sessionLogFilePath = customLogPath;
        this.logDir = path.dirname(customLogPath);
      } else {
        // Otherwise, treat it as a directory path
        this.logDir = customLogPath;
        this.sessionLogFilePath = path.join(this.logDir, `${this.sessionStartTime}_${this.sessionId}.jsonl`);
      }
    } else {
      // Default behavior
      this.logDir = path.join(os.homedir(), GEMINI_DIR, 'tmp', 'sessions');
      this.sessionLogFilePath = path.join(this.logDir, `${this.sessionStartTime}_${this.sessionId}.jsonl`);
    }
    
    this.initializationPromise = this.logInitialization();
  }

  /**
   * Appends a log entry as a single JSON line to the specified file
   */
  private async appendLogLine(filePath: string, logEntry: object): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
    const logLine = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(filePath, logLine, 'utf-8');
  }

  /**
   * Writes an initialization entry to the JSONL log file
   */
  private async logInitialization(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      
      const initEntry = {
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        interactionId: 'init',
        model: 'system',
        request: {
          type: 'session_initialization',
          sessionStartTime: this.sessionStartTime
        }
      };

      await this.appendLogLine(this.sessionLogFilePath, initEntry);
      this.initialized = true;
    } catch (error) {
      console.error('Failed to log initialization:', error);
      // Don't throw here to allow the logger to continue working
    }
  }

  /**
   * Initialize the logger by creating the log directory if it doesn't exist
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.logDir, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize OpenAI logger:', error);
      throw new Error(`Failed to initialize OpenAI logger: ${error}`);
    }
  }

  /**
   * Logs an OpenAI API request and its response in JSONL format
   * @param request The request sent to OpenAI
   * @param response The response received from OpenAI
   * @param model The model used for the request
   * @param tokenUsage Token usage information if available
   * @param error Optional error if the request failed
   * @returns The file path where the log was written
   */
  async logInteraction(
    request: unknown,
    response?: unknown,
    model?: string,
    tokenUsage?: TokenUsage,
    error?: Error,
  ): Promise<string> {
    // Wait for initialization logging to complete first
    await this.initializationPromise;
    
    if (!this.initialized) {
      await this.initialize();
    }

    const interactionId = uuidv4().slice(0, 8);

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      interactionId,
      model: model || 'unknown',
      tokenUsage,
      request,
      response: response || null,
      error: error
        ? {
          message: error.message,
          stack: error.stack,
        }
        : undefined,
    };

    try {
      await this.appendLogLine(this.sessionLogFilePath, logEntry);
      return this.sessionLogFilePath;
    } catch (writeError) {
      console.error('Failed to write OpenAI log file:', writeError);
      throw new Error(`Failed to write OpenAI log file: ${writeError}`);
    }
  }

  /**
   * Get all logged session files
   * @param limit Optional limit on the number of log files to return (sorted by most recent first)
   * @returns Array of log file paths
   */
  async getLogFiles(limit?: number): Promise<string[]> {
    try {
      const files = await fs.readdir(this.logDir);
      // Match the new filename pattern: yyyy_MM_dd_hh_mm_ss_sessionId.jsonl
      // This pattern matches 6 timestamp components (year_month_day_hour_minute_second) followed by session ID
      const timestampPattern = /^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_.*\.jsonl$/;
      const logFiles = files
        .filter((file) => timestampPattern.test(file))
        .map((file) => path.join(this.logDir, file))
        .sort()
        .reverse();

      return limit ? logFiles.slice(0, limit) : logFiles;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      console.error('Failed to read OpenAI log directory:', error);
      return [];
    }
  }

  /**
   * Read a specific JSONL log file and return all entries
   * @param filePath The path to the log file
   * @returns Array of log entries
   */
  async readLogFile(filePath: string): Promise<LogEntry[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      return lines.map(line => JSON.parse(line) as LogEntry);
    } catch (error) {
      console.error(`Failed to read log file ${filePath}:`, error);
      throw new Error(`Failed to read log file: ${error}`);
    }
  }

  /**
   * Get the current session's log file path
   * @returns The path to the current session's log file
   */
  getSessionLogPath(): string {
    return this.sessionLogFilePath;
  }

  /**
   * Get the session ID for this logger instance
   * @returns The session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

// Session-aware logger factory
export function createSessionLogger(sessionId?: string, customLogPath?: string): OpenAILogger {
  return new OpenAILogger(sessionId, customLogPath);
}

// Create a default instance for backward compatibility (lazy initialization)
// Note: This will use a generated session ID. For session-specific logging,
// use createSessionLogger() with the actual session ID.
let _defaultLogger: OpenAILogger | null = null;
export const openaiLogger = {
  get instance(): OpenAILogger {
    if (!_defaultLogger) {
      _defaultLogger = new OpenAILogger();
    }
    return _defaultLogger;
  },
  // Legacy methods for backward compatibility
  logInteraction: (...args: Parameters<OpenAILogger['logInteraction']>) => openaiLogger.instance.logInteraction(...args),
  readLogFile: (...args: Parameters<OpenAILogger['readLogFile']>) => openaiLogger.instance.readLogFile(...args),
  getLogFiles: (...args: Parameters<OpenAILogger['getLogFiles']>) => openaiLogger.instance.getLogFiles(...args),
  getSessionLogPath: () => openaiLogger.instance.getSessionLogPath(),
  getSessionId: () => openaiLogger.instance.getSessionId(),
};