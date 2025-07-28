/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it, vi, beforeEach } from 'vitest';
import { ShellTool } from './shell.js';
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
        [shellTool.name]: {},
      }),
    } as unknown as Config;
    shellTool = new ShellTool(config);
  });

  it('should not let the summarizer override the return display', async () => {
    const summarizeSpy = vi
      .spyOn(summarizer, 'summarizeToolOutput')
      .mockResolvedValue('summarized output');

    const abortSignal = new AbortController().signal;
    const result = await shellTool.execute(
      { command: 'echo hello' },
      abortSignal,
      () => {},
    );

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
    const result = await shellTool.execute(
      { command: 'echo hello' },
      abortSignal,
      () => {},
    );

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
        [shellTool.name]: { tokenBudget: 1000 },
      }),
    } as unknown as Config;
    shellTool = new ShellTool(config);

    const summarizeSpy = vi
      .spyOn(summarizer, 'summarizeToolOutput')
      .mockResolvedValue('summarized output');

    const abortSignal = new AbortController().signal;
    await shellTool.execute({ command: 'echo "hello"' }, abortSignal, () => {});

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
        [shellTool.name]: {},
      }),
    } as unknown as Config;
    shellTool = new ShellTool(config);

    const summarizeSpy = vi
      .spyOn(summarizer, 'summarizeToolOutput')
      .mockResolvedValue('summarized output');

    const abortSignal = new AbortController().signal;
    await shellTool.execute({ command: 'echo "hello"' }, abortSignal, () => {});

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
    const result = await shellTool.execute(
      { command: 'echo "$GEMINI_CLI"' },
      abortSignal,
      () => {},
    );

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
    const result = await shellTool.execute(
      { command: 'echo "hello world"' },
      abortSignal,
      () => {},
    );
    
    // Should not fail with quote parsing errors
    expect(result.llmContent).toContain('Command: echo "hello world"');
    expect(result.llmContent).not.toContain('fatal: paths');
  });

  it('should handle commands with single quotes on Windows', async () => {
    const abortSignal = new AbortController().signal;
    const result = await shellTool.execute(
      { command: "echo 'hello world'" },
      abortSignal,
      () => {},
    );
    
    expect(result.llmContent).toContain("Command: echo 'hello world'");
    expect(result.llmContent).not.toContain('fatal: paths');
  });

  it('should handle commands with mixed quotes on Windows', async () => {
    const abortSignal = new AbortController().signal;
    const result = await shellTool.execute(
      { command: `echo "hello 'nested' world"` },
      abortSignal,
      () => {},
    );
    
    expect(result.llmContent).toContain(`Command: echo "hello 'nested' world"`);
    expect(result.llmContent).not.toContain('fatal: paths');
  });

  it('should handle commands with special characters on Windows', async () => {       
    const abortSignal = new AbortController().signal;
    const result = await shellTool.execute(
      { command: 'echo "test & more"' },
      abortSignal,
      () => {},
    );
    
    expect(result.llmContent).toContain('Command: echo "test & more"');
    expect(result.llmContent).not.toContain('fatal: paths');
  });

  it('should handle git commit with message containing quotes on Windows', async () => {
    const abortSignal = new AbortController().signal;
    const result = await shellTool.execute(
      { command: 'git commit -a -m "abc def"' },
      abortSignal,
      () => {},
    );
    
    // Should not contain the specific error from the bug report
    expect(result.llmContent).not.toContain(`fatal: paths 'def" ...' with -a does not make sense`);
    expect(result.llmContent).toContain('Command: git commit -a -m "abc def"');
  });

  it('should handle complex commands with multiple quote types on Windows', async () => {
    const abortSignal = new AbortController().signal;
    const result = await shellTool.execute(
      { command: `echo "outer 'inner "nested" more' end"` },
      abortSignal,
      () => {},
    );
    
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
    const result = (await shellTool.shouldConfirmExecute(
      {
        command: 'git status && git log',
      },
      new AbortController().signal,
    )) as ToolExecuteConfirmationDetails;
    expect(result.rootCommand).toEqual('git');
  });
});
