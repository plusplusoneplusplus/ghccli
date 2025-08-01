/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

export enum LogLevel {
  MINIMAL = 'minimal',
  NORMAL = 'normal', 
  VERBOSE = 'verbose',
}

export interface LoggerConfig {
  debugEnabled: boolean;
  debugLevel: LogLevel;
  isNonInteractive: boolean;
}

export class DebugLogger {
  private config: LoggerConfig;
  private component: string;

  constructor(component: string, config: LoggerConfig) {
    this.component = component;
    this.config = config;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.debugEnabled) {
      return false;
    }

    // In non-interactive mode, only log essential information for minimal level
    if (this.config.isNonInteractive && this.config.debugLevel === LogLevel.MINIMAL) {
      return level === LogLevel.MINIMAL;
    }

    // Log levels hierarchy: verbose > normal > minimal
    const levelPriority = {
      [LogLevel.MINIMAL]: 1,
      [LogLevel.NORMAL]: 2,
      [LogLevel.VERBOSE]: 3,
    };

    return levelPriority[level] <= levelPriority[this.config.debugLevel];
  }

  private writeToStdErr(message: string): void {
    // Always write debug logs to stderr to keep stdout clean for AI responses
    process.stderr.write(message + '\n');
  }

  debug(message: string, level: LogLevel = LogLevel.NORMAL): void {
    if (this.shouldLog(level)) {
      this.writeToStdErr(`[DEBUG] [${this.component}] ${message}`);
    }
  }

  warn(message: string): void {
    // Warnings are always shown, but go to stderr
    this.writeToStdErr(`[WARN] [${this.component}] ${message}`);
  }

  error(message: string): void {
    // Errors are always shown and go to stderr
    this.writeToStdErr(`[ERROR] [${this.component}] ${message}`);
  }

  // Essential logs that are shown even in minimal mode (auth failures, critical errors)
  essential(message: string): void {
    if (this.config.debugEnabled) {
      this.writeToStdErr(`[DEBUG] [${this.component}] ${message}`);
    }
  }
}

// Global logger configuration
let globalLoggerConfig: LoggerConfig = {
  debugEnabled: false,
  debugLevel: LogLevel.MINIMAL,
  isNonInteractive: false,
};

export function setGlobalLoggerConfig(config: LoggerConfig): void {
  globalLoggerConfig = config;
}

export function createLogger(component: string): DebugLogger {
  return new DebugLogger(component, globalLoggerConfig);
}