/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it, vi, beforeEach } from 'vitest';
import { ShellTool, ShellToolInvocation } from './shell_v2.js';
import { Config } from '../config/config.js';
import * as summarizer from '../utils/summarizer.js';
import { GeminiClient } from '../core/client.js';
import { ToolExecuteConfirmationDetails } from './tools.js';
import os from 'os';

describe('ShellTool Bug Reproduction', () => {
  let shellTool: ShellTool;
  let config: Config;

  beforeEach(() => {
    config = {
      getCoreTools: () => undefined,
      getExcludeTools: () => undefined,
      getDebugMode: () => false,
      getGeminiClient: () => ({}) as GeminiClient,
      getTargetDir: () => '.',
      getSummarizeToolOutputConfig: () => ({
        [ShellTool.Name]: {},
      }),
    } as unknown as Config;
    shellTool = new ShellTool(config);
  });

  it('should not let the summarizer override the return display', async () => {
    const summarizeSpy = vi
      .spyOn(summarizer, 'summarizeToolOutput')
      .mockResolvedValue('summarized output');

    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: 'echo hello' });
    const result = await invocation.execute(abortSignal, () => {});

    expect(result.returnDisplay).toBe('hello' + os.EOL);
    expect(result.llmContent).toBe('summarized output');
    expect(summarizeSpy).toHaveBeenCalled();
  });

  it('should not call summarizer if disabled in config', async () => {
    config = {
      getCoreTools: () => undefined,
      getExcludeTools: () => undefined,
      getDebugMode: () => false,
      getGeminiClient: () => ({}) as GeminiClient,
      getTargetDir: () => '.',
      getSummarizeToolOutputConfig: () => ({}),
    } as unknown as Config;
    shellTool = new ShellTool(config);

    const summarizeSpy = vi
      .spyOn(summarizer, 'summarizeToolOutput')
      .mockResolvedValue('summarized output');

    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: 'echo hello' });
    const result = await invocation.execute(abortSignal, () => {});

    expect(result.returnDisplay).toBe('hello' + os.EOL);
    expect(result.llmContent).not.toBe('summarized output');
    expect(summarizeSpy).not.toHaveBeenCalled();
  });

  it('should pass token budget to summarizer', async () => {
    config = {
      getCoreTools: () => undefined,
      getExcludeTools: () => undefined,
      getDebugMode: () => false,
      getGeminiClient: () => ({}) as GeminiClient,
      getTargetDir: () => '.',
      getSummarizeToolOutputConfig: () => ({
        [ShellTool.Name]: { tokenBudget: 1000 },
      }),
    } as unknown as Config;
    shellTool = new ShellTool(config);

    const summarizeSpy = vi
      .spyOn(summarizer, 'summarizeToolOutput')
      .mockResolvedValue('summarized output');

    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: 'echo "hello"' });
    await invocation.execute(abortSignal, () => {});

    expect(summarizeSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      1000,
    );
  });

  it('should use default token budget if not specified', async () => {
    config = {
      getCoreTools: () => undefined,
      getExcludeTools: () => undefined,
      getDebugMode: () => false,
      getGeminiClient: () => ({}) as GeminiClient,
      getTargetDir: () => '.',
      getSummarizeToolOutputConfig: () => ({
        [ShellTool.Name]: {},
      }),
    } as unknown as Config;
    shellTool = new ShellTool(config);

    const summarizeSpy = vi
      .spyOn(summarizer, 'summarizeToolOutput')
      .mockResolvedValue('summarized output');

    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: 'echo "hello"' });
    await invocation.execute(abortSignal, () => {});

    expect(summarizeSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      undefined,
    );
  });

  it('should pass GEMINI_CLI environment variable to executed commands', async () => {
    config = {
      getCoreTools: () => undefined,
      getExcludeTools: () => undefined,
      getDebugMode: () => false,
      getGeminiClient: () => ({}) as GeminiClient,
      getTargetDir: () => '.',
      getSummarizeToolOutputConfig: () => ({}),
    } as unknown as Config;
    shellTool = new ShellTool(config);

    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: 'echo "$GEMINI_CLI"' });
    const result = await invocation.execute(abortSignal, () => {});

    expect(result.returnDisplay).toBe('1' + os.EOL);
  });
});

describe.skipIf(os.platform() !== 'win32')('Windows Quote Escaping', () => {
  let shellTool: ShellTool;
  let config: Config;
  
  beforeEach(() => {
    config = {
      getCoreTools: () => ['run_shell_command'],
      getExcludeTools: () => [],
      getDebugMode: () => false,
      getGeminiClient: () => ({}) as GeminiClient,
      getTargetDir: () => '.',
      getSummarizeToolOutputConfig: () => ({}),
    } as unknown as Config;
    shellTool = new ShellTool(config);
  });

  it('should handle commands with double quotes on Windows', async () => {
    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: 'echo "hello world"' });
    const result = await invocation.execute(abortSignal, () => {});
    
    // Should not fail with quote parsing errors
    expect(result.llmContent).toContain('Command: echo "hello world"');
    expect(result.llmContent).not.toContain('fatal: paths');
  });

  it('should handle commands with single quotes on Windows', async () => {
    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: "echo 'hello world'" });
    const result = await invocation.execute(abortSignal, () => {});
    
    expect(result.llmContent).toContain("Command: echo 'hello world'");
    expect(result.llmContent).not.toContain('fatal: paths');
  });

  it('should handle commands with mixed quotes on Windows', async () => {
    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: `echo "hello 'nested' world"` });
    const result = await invocation.execute(abortSignal, () => {});
    
    expect(result.llmContent).toContain(`Command: echo "hello 'nested' world"`);
    expect(result.llmContent).not.toContain('fatal: paths');
  });

  it('should handle commands with special characters on Windows', async () => {       
    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: 'echo "test & more"' });
    const result = await invocation.execute(abortSignal, () => {});
    
    expect(result.llmContent).toContain('Command: echo "test & more"');
    expect(result.llmContent).not.toContain('fatal: paths');
  });

  it('should handle git commit with message containing quotes on Windows', async () => {
    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: 'git commit -a -m "abc def"' });
    const result = await invocation.execute(abortSignal, () => {});
    
    // Should not contain the specific error from the bug report
    expect(result.llmContent).not.toContain(`fatal: paths 'def" ...' with -a does not make sense`);
    expect(result.llmContent).toContain('Command: git commit -a -m "abc def"');
  });

  it('should handle complex commands with multiple quote types on Windows', async () => {
    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: `echo "outer 'inner "nested" more' end"` });
    const result = await invocation.execute(abortSignal, () => {});
    
    expect(result.llmContent).toContain(`Command: echo "outer 'inner "nested" more' end"`);
    expect(result.llmContent).not.toContain('fatal: paths');
  });
});

describe('shouldConfirmExecute', () => {
  it('should de-duplicate command roots before asking for confirmation', async () => {
    const shellTool = new ShellTool({
      getCoreTools: () => ['run_shell_command'],
      getExcludeTools: () => [],
    } as unknown as Config);
    const invocation = shellTool.createInvocation({
      commands: 'git status && git log',
    }) as ShellToolInvocation;
    const result = (await invocation.shouldConfirmExecute(
      new AbortController().signal,
    )) as ToolExecuteConfirmationDetails;
    expect(result.rootCommand).toEqual('git');
  });
});

describe('Sequential Command Execution', () => {
  let shellTool: ShellTool;
  let config: Config;

  beforeEach(() => {
    config = {
      getCoreTools: () => undefined,
      getExcludeTools: () => undefined,
      getDebugMode: () => false,
      getGeminiClient: () => ({}) as GeminiClient,
      getTargetDir: () => '.',
      getSummarizeToolOutputConfig: () => ({}),
    } as unknown as Config;
    shellTool = new ShellTool(config);
  });

  it('should execute single string command (backward compatibility)', async () => {
    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: 'echo hello' });
    const result = await invocation.execute(abortSignal, () => {});

    expect(result.llmContent).toContain('Command: echo hello');
    expect(result.llmContent).toContain('Exit Code: 0');
  });

  it('should execute single command in array format', async () => {
    const abortSignal = new AbortController().signal;
    const invocation = shellTool.createInvocation({ commands: [{ command: 'echo hello' }] });
    const result = await invocation.execute(abortSignal, () => {});

    expect(result.llmContent).toContain('Commands Executed: 1/1');
    expect(result.llmContent).toContain('Command 1: echo hello');
    expect(result.llmContent).toContain('Exit Code: 0');
  });

  // Additional tests can be added here following the same pattern...
  it('should be properly initialized', () => {
    expect(shellTool).toBeDefined();
    expect(shellTool.name).toBe('run_shell_command');
  });
});

// Simplified validation tests using direct instantiation
describe('Validation Tests', () => {
  let shellTool: ShellTool;
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {
      getTargetDir: () => '/test/dir',
      getCoreTools: () => ['run_shell_command'],
      getExcludeTools: () => [],
    } as unknown as Config;
    shellTool = new ShellTool(mockConfig);
  });

  it('should validate basic parameters', () => {
    const params = { commands: 'echo hello' };
    const invocation = shellTool.createInvocation(params) as ShellToolInvocation;
    const result = invocation.validateToolParams(params);
    expect(result).toBeNull();
  });

  it('should generate description correctly', () => {
    const params = { commands: 'echo hello', description: 'Test command' };
    const invocation = shellTool.createInvocation(params) as ShellToolInvocation;
    const description = invocation.getDescription();
    expect(description).toContain('echo hello');
    expect(description).toContain('(Test command)');
  });
});