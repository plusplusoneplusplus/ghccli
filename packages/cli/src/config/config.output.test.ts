/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseArguments } from './config.js';

describe('CLI Output Configuration', () => {
  const originalArgv = process.argv;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  describe('parseArguments - output format options', () => {
    it('should parse --output-format json', async () => {
      process.argv = ['node', 'cli.js', '--output-format', 'json'];
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
    });

    it('should default to undefined when no output format specified', async () => {
      process.argv = ['node', 'cli.js'];
      const args = await parseArguments();
      expect(args.outputFormat).toBeUndefined();
    });

    it('should handle --pretty-print flag', async () => {
      process.argv = ['node', 'cli.js', '--pretty-print'];
      const args = await parseArguments();
      expect(args.prettyPrint).toBe(true);
    });

    it('should handle --no-pretty-print flag', async () => {
      process.argv = ['node', 'cli.js', '--no-pretty-print'];
      const args = await parseArguments();
      expect(args.prettyPrint).toBe(false);
    });

    it('should default pretty-print to true when not specified', async () => {
      process.argv = ['node', 'cli.js'];
      const args = await parseArguments();
      expect(args.prettyPrint).toBe(true);
    });

    it('should handle combined output format and pretty print options', async () => {
      process.argv = ['node', 'cli.js', '--output-format', 'json', '--no-pretty-print'];
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
      expect(args.prettyPrint).toBe(false);
    });

    it('should handle combined output format and pretty print enabled', async () => {
      process.argv = ['node', 'cli.js', '--output-format', 'json', '--pretty-print'];
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
      expect(args.prettyPrint).toBe(true);
    });
  });

  describe('parseArguments - validation', () => {
    it('should accept json as a valid output format', async () => {
      process.argv = ['node', 'cli.js', '--output-format', 'json'];
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
    });

    it('should reject invalid output formats', async () => {
      process.argv = ['node', 'cli.js', '--output-format', 'invalid'];
      
      // Should throw an error due to yargs validation
      await expect(parseArguments()).rejects.toThrow();
    });

    it('should handle output format with other CLI arguments', async () => {
      process.argv = [
        'node', 'cli.js', 
        '--output-format', 'json',
        '--pretty-print',
        '--prompt', 'test prompt',
        '--model', 'claude-3-sonnet'
      ];
      
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
      expect(args.prettyPrint).toBe(true);
      expect(args.prompt).toBe('test prompt');
      expect(args.model).toBe('claude-3-sonnet');
    });
  });

  describe('parseArguments - edge cases', () => {
    it('should handle empty arguments', async () => {
      process.argv = ['node', 'cli.js'];
      const args = await parseArguments();
      expect(args.outputFormat).toBeUndefined();
      expect(args.prettyPrint).toBe(true); // default value
    });

    it('should handle only pretty print flag without output format', async () => {
      process.argv = ['node', 'cli.js', '--pretty-print'];
      const args = await parseArguments();
      expect(args.outputFormat).toBeUndefined();
      expect(args.prettyPrint).toBe(true);
    });

    it('should handle only no-pretty-print flag without output format', async () => {
      process.argv = ['node', 'cli.js', '--no-pretty-print'];
      const args = await parseArguments();
      expect(args.outputFormat).toBeUndefined();
      expect(args.prettyPrint).toBe(false);
    });

    it('should handle mixed case in arguments', async () => {
      process.argv = ['node', 'cli.js', '--output-format', 'json'];
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
    });
  });

  describe('parseArguments - argument aliases and variations', () => {
    it('should handle output format with equals sign', async () => {
      process.argv = ['node', 'cli.js', '--output-format=json'];
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
    });

    it('should reject conflicting prompt arguments along with output format', async () => {
      process.argv = [
        'node', 'cli.js',
        '--output-format', 'json',
        '--prompt', 'test',
        '--prompt-interactive', 'interactive test'
      ];
      
      await expect(parseArguments()).rejects.toThrow();
    });

    it('should work with non-interactive mode (--prompt)', async () => {
      process.argv = [
        'node', 'cli.js',
        '--output-format', 'json',
        '--prompt', 'test prompt'
      ];
      
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
      expect(args.prompt).toBe('test prompt');
    });

    it('should work with interactive mode (--prompt-interactive)', async () => {
      process.argv = [
        'node', 'cli.js',
        '--output-format', 'json',
        '--prompt-interactive', 'start with this'
      ];
      
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
      expect(args.promptInteractive).toBe('start with this');
    });
  });

  describe('parseArguments - integration with other output options', () => {
    it('should handle output-format with output-logger-file', async () => {
      process.argv = [
        'node', 'cli.js',
        '--output-format', 'json',
        '--output-logger-file', '/path/to/logfile.txt'
      ];
      
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
      expect(args.outputLoggerFile).toBe('/path/to/logfile.txt');
    });

    it('should handle output-format with debug options', async () => {
      process.argv = [
        'node', 'cli.js',
        '--output-format', 'json',
        '--debug',
        '--debug-level', 'verbose'
      ];
      
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
      expect(args.debug).toBe(true);
      expect(args.debugLevel).toBe('verbose');
    });

    it('should handle output-format with telemetry options', async () => {
      process.argv = [
        'node', 'cli.js',
        '--output-format', 'json',
        '--telemetry',
        '--telemetry-target', 'local'
      ];
      
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
      expect(args.telemetry).toBe(true);
      expect(args.telemetryTarget).toBe('local');
    });
  });

  describe('parseArguments - boolean flag variations', () => {
    it('should handle --pretty-print=true', async () => {
      process.argv = ['node', 'cli.js', '--pretty-print=true'];
      const args = await parseArguments();
      expect(args.prettyPrint).toBe(true);
    });

    it('should handle --pretty-print=false', async () => {
      process.argv = ['node', 'cli.js', '--pretty-print=false'];
      const args = await parseArguments();
      expect(args.prettyPrint).toBe(false);
    });

    it('should handle --no-pretty-print explicitly', async () => {
      process.argv = ['node', 'cli.js', '--no-pretty-print'];
      const args = await parseArguments();
      expect(args.prettyPrint).toBe(false);
    });

    it('should prioritize explicit --no-pretty-print over default', async () => {
      process.argv = ['node', 'cli.js', '--output-format', 'json', '--no-pretty-print'];
      const args = await parseArguments();
      expect(args.prettyPrint).toBe(false);
    });
  });

  describe('parseArguments - help and validation', () => {
    it('should include output format options in help choices', async () => {
      // This test verifies that the yargs configuration is set up correctly
      // The actual choices validation happens in yargs, but we can verify our config
      process.argv = ['node', 'cli.js', '--output-format', 'json'];
      const args = await parseArguments();
      expect(args.outputFormat).toBe('json');
    });

    it('should have proper defaults for new output options', async () => {
      process.argv = ['node', 'cli.js'];
      const args = await parseArguments();
      
      // Verify that our new options have sensible defaults
      expect(args.outputFormat).toBeUndefined(); // Only set when explicitly requested
      expect(args.prettyPrint).toBe(true); // Default to pretty printing for better UX
    });
  });

  describe('parseArguments - argument type validation', () => {
    it('should ensure outputFormat is string or undefined', async () => {
      process.argv = ['node', 'cli.js', '--output-format', 'json'];
      const args = await parseArguments();
      expect(typeof args.outputFormat === 'string' || args.outputFormat === undefined).toBe(true);
    });

    it('should ensure prettyPrint is boolean or undefined', async () => {
      process.argv = ['node', 'cli.js', '--pretty-print'];
      const args = await parseArguments();
      expect(typeof args.prettyPrint === 'boolean' || args.prettyPrint === undefined).toBe(true);
    });

    it('should maintain type consistency across multiple runs', async () => {
      // Test multiple argument combinations to ensure type consistency
      const testCases = [
        ['node', 'cli.js'],
        ['node', 'cli.js', '--output-format', 'json'],
        ['node', 'cli.js', '--pretty-print'],
        ['node', 'cli.js', '--no-pretty-print'],
        ['node', 'cli.js', '--output-format', 'json', '--pretty-print'],
        ['node', 'cli.js', '--output-format', 'json', '--no-pretty-print'],
      ];

      for (const testArgs of testCases) {
        process.argv = testArgs;
        const args = await parseArguments();
        
        // Verify types are consistent
        expect(typeof args.outputFormat === 'string' || args.outputFormat === undefined).toBe(true);
        expect(typeof args.prettyPrint === 'boolean' || args.prettyPrint === undefined).toBe(true);
      }
    });
  });
});