/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { Config } from '../config/config.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolInvocation,
  ToolResult,
  ToolCallConfirmationDetails,
  ToolExecuteConfirmationDetails,
  ToolConfirmationOutcome,
} from './tools.js';
import { getErrorMessage } from '../utils/errors.js';
import stripAnsi from 'strip-ansi';
import {
  getCommandRoots,
  isCommandAllowed,
  stripShellWrapper,
} from '../utils/shell-utils.js';
import { parseCommandWithQuotes } from '../utils/command-parser.js';
import { spawn } from 'child_process';
import { execa } from 'execa';
import { summarizeToolOutput } from '../utils/summarizer.js';
import { createLogger, LogLevel } from '../utils/logging.js';

const OUTPUT_UPDATE_INTERVAL_MS = 1000;
const logger = createLogger('ShellV2');

export interface CommandBatch {
  command: string;
  description?: string;
  continueOnError?: boolean;
}

export interface ShellToolParams {
  commands: string | string[] | CommandBatch[];
  description?: string;
  directory?: string;
  stopOnError?: boolean;
}

export class ShellToolInvocation extends BaseToolInvocation<
  ShellToolParams,
  ToolResult
> {
  private allowlist: Set<string> = new Set();

  constructor(
    params: ShellToolParams,
    private config: Config,
  ) {
    super(params);
  }

  getDescription(): string {
    let description: string;
    
    if (typeof this.params.commands === 'string') {
      description = this.params.commands;
    } else {
      // For batch commands, show count and first command
      const count = this.params.commands.length;
      const firstCommand = typeof this.params.commands[0] === 'string' 
        ? this.params.commands[0] as string
        : (this.params.commands[0] as CommandBatch)?.command || '';
      if (count === 1) {
        description = firstCommand;
      } else {
        description = `${count} commands: ${firstCommand}${count > 1 ? ' ...' : ''}`;
      }
    }
    
    // append optional [in directory]
    // note description is needed even if validation fails due to absolute path
    if (this.params.directory) {
      description += ` [in ${this.params.directory}]`;
    }
    // append optional (description), replacing any line breaks with spaces
    if (this.params.description) {
      description += ` (${this.params.description.replace(/\n/g, ' ')})`;
    }
    return description;
  }

  private checkDangerousPatterns(command: string): string | null {
    const isWindows = os.platform() === 'win32';
    const normalizedCommand = command.trim();
    
    if (isWindows) {
      return this.checkWindowsDangerousPatterns(normalizedCommand);
    } else {
      return this.checkUnixDangerousPatterns(normalizedCommand);
    }
  }

  private checkUnixDangerousPatterns(command: string): string | null {
    // List of dangerous command patterns to block on Unix/Linux/macOS
    // Order matters - more specific patterns should come first
    const dangerousPatterns = [
      // System directory operations (more specific, should be checked first)
      { pattern: /\b(sudo\s+)?rm\s+.*\/(bin|sbin|usr|etc|var|sys|proc|dev)\b/i, message: 'Removal of system directories is not allowed' },
      
      // Mass file operations in user directories (should be checked before general rm -rf)
      { pattern: /\b(rm|mv|cp)\s+.*\/(home|Users|Documents)\/.*\*/i, message: 'Mass file operations in user directories with wildcards are not allowed' },
      
      // Destructive file operations (more general, checked after specific patterns)
      { pattern: /\brm\s+.*-rf?\b/i, message: 'rm -rf commands are not allowed for security reasons' },
      { pattern: /\brm\s+.*-fr?\b/i, message: 'rm -fr commands are not allowed for security reasons' },
      { pattern: /\brm\s+.*--recursive.*--force\b/i, message: 'Recursive force removal commands are not allowed' },
      { pattern: /\brm\s+.*--force.*--recursive\b/i, message: 'Force recursive removal commands are not allowed' },
      // Additional variations to catch different rm -rf patterns
      { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s/i, message: 'rm -rf commands are not allowed for security reasons' },
      { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s/i, message: 'rm -fr commands are not allowed for security reasons' },
      
      // Permission changes
      { pattern: /\bchmod\s+777\b/i, message: 'chmod 777 is not allowed for security reasons' },
      { pattern: /\bchown\s+.*root\b/i, message: 'Changing ownership to root is not allowed' },
      
      // Network and system access
      { pattern: /\b(wget|curl)\s+.*\|\s*(sh|bash|zsh)\b/i, message: 'Downloading and executing scripts is not allowed' },
      { pattern: /\bdd\s+.*of=\/dev\/(sd|hd)[a-z]\b/i, message: 'Writing to disk devices is not allowed' },
      
      // Process manipulation
      { pattern: /\bkillall\s+-9\b/i, message: 'Force killing all processes is not allowed' },
      { pattern: /\bpkill\s+-9\b/i, message: 'Force killing processes by name is not allowed' },
      
      // File system bombs
      { pattern: /:\(\)\{.*:\|:&\}/i, message: 'Fork bomb patterns are not allowed' },
      { pattern: /\bfind\s+\/.*-exec\s+rm\b/i, message: 'find with rm execution is not allowed' },
      
      // Data destruction
      { pattern: />\s*\/dev\/(null|zero|random|urandom)\s*<\s*\/dev\/(sd|hd)[a-z]/i, message: 'Disk wiping commands are not allowed' },
      { pattern: /\bmkfs\b/i, message: 'File system formatting commands are not allowed' },
      { pattern: /\bfdisk\b/i, message: 'Disk partitioning commands are not allowed' },
    ];
    
    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(command)) {
        return message;
      }
    }

    // Check for suspicious root operations
    if (/\bsu\s+root\b/i.test(command) || /\bsudo\s+su\b/i.test(command)) {
      return 'Root access commands are not allowed';
    }

    // Check for mass file operations in sensitive locations
    if (/\b(rm|mv|cp)\s+.*[-\/].*\*.*\/(home|Users|Documents)\b/i.test(command)) {
      return 'Mass file operations in user directories with wildcards are not allowed';
    }

    return null;
  }

  private checkWindowsDangerousPatterns(command: string): string | null {
    // List of dangerous command patterns to block on Windows
    const dangerousPatterns = [
      // Destructive file operations
      { pattern: /\bdel\s+.*\/[sq]\b/i, message: 'del /s or del /q commands are not allowed for security reasons' },
      { pattern: /\brmdir\s+.*\/s\b/i, message: 'rmdir /s commands are not allowed for security reasons' },
      { pattern: /\brd\s+.*\/s\b/i, message: 'rd /s commands are not allowed for security reasons' },
      { pattern: /\berase\s+.*\/[sq]\b/i, message: 'erase /s or erase /q commands are not allowed for security reasons' },
      
      // System directory operations
      { pattern: /\b(del|rmdir|rd|erase)\s+.*[Cc]:\\[Ww]indows\b/i, message: 'Operations on Windows system directory are not allowed' },
      { pattern: /\b(del|rmdir|rd|erase)\s+.*[Cc]:\\[Pp]rogram\s+[Ff]iles\b/i, message: 'Operations on Program Files directory are not allowed' },
      { pattern: /\b(del|rmdir|rd|erase)\s+.*[Cc]:\\[Ss]ystem32\b/i, message: 'Operations on System32 directory are not allowed' },
      { pattern: /\b(del|rmdir|rd|erase)\s+.*[Cc]:\\[Uu]sers\\[Aa]ll\s+[Uu]sers\b/i, message: 'Operations on All Users directory are not allowed' },
      
      // Registry operations
      { pattern: /\breg\s+(delete|del)\s+.*HKEY_LOCAL_MACHINE\b/i, message: 'Registry deletion operations on HKLM are not allowed' },
      { pattern: /\breg\s+(delete|del)\s+.*HKLM\b/i, message: 'Registry deletion operations on HKLM are not allowed' },
      { pattern: /\bregedit\s+.*\/[sd]\b/i, message: 'Registry import/export operations are not allowed' },
      
      // System manipulation
      { pattern: /\bformat\s+[Cc]:/i, message: 'Formatting system drive is not allowed' },
      { pattern: /\bdiskpart\b/i, message: 'Disk partitioning commands are not allowed' },
      { pattern: /\bfdisk\s+\/mbr\b/i, message: 'Master boot record operations are not allowed' },
      
      // Network and system access
      { pattern: /\b(powershell|pwsh)\s+.*Invoke-WebRequest.*\|\s*Invoke-Expression\b/i, message: 'Downloading and executing scripts is not allowed' },
      { pattern: /\b(wget|curl|iwr)\s+.*\|\s*(powershell|pwsh|cmd)\b/i, message: 'Downloading and executing scripts is not allowed' },
      { pattern: /\bcertlm\s+.*-delstore\b/i, message: 'Certificate store manipulation is not allowed' },
      
      // Process manipulation
      { pattern: /\btaskkill\s+.*\/f\s+\/im\s+explorer\.exe\b/i, message: 'Force killing Explorer is not allowed' },
      { pattern: /\btaskkill\s+.*\/f\s+\/im\s+winlogon\.exe\b/i, message: 'Force killing Winlogon is not allowed' },
      { pattern: /\btaskkill\s+.*\/f\s+\/im\s+csrss\.exe\b/i, message: 'Force killing critical system processes is not allowed' },
      { pattern: /\bwmic\s+process\s+.*delete\b/i, message: 'WMIC process deletion is not allowed' },
      
      // Service manipulation
      { pattern: /\bsc\s+(delete|stop)\s+(Spooler|BITS|Winmgmt|RpcSs|Dhcp|Dnscache)\b/i, message: 'Critical service manipulation is not allowed' },
      { pattern: /\bnet\s+stop\s+(Spooler|BITS|Winmgmt|RpcSs|Dhcp|Dnscache)\b/i, message: 'Stopping critical services is not allowed' },
      
      // File system bombs
      { pattern: /\bfor\s+.*\bdo\s+.*del\s+.*\*\b/i, message: 'Batch file deletion loops are not allowed' },
      { pattern: /\bdir\s+.*\|\s*del\b/i, message: 'Piped directory listing to deletion is not allowed' },
      
      // PowerShell specific
      { pattern: /\bRemove-Item\s+.*-Recurse\s+.*-Force\b/i, message: 'PowerShell recursive force removal is not allowed' },
      { pattern: /\bRemove-Item\s+.*-Force\s+.*-Recurse\b/i, message: 'PowerShell force recursive removal is not allowed' },
      { pattern: /\bGet-ChildItem\s+.*\|\s*Remove-Item\s+.*-Force\b/i, message: 'PowerShell piped force removal is not allowed' },
      
      // UAC and privilege escalation
      { pattern: /\bStart-Process\s+.*-Verb\s+RunAs\b/i, message: 'UAC elevation requests are not allowed' },
      { pattern: /\brunas\s+\/user:Administrator\b/i, message: 'Running as Administrator is not allowed' },
    ];
    
    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(command)) {
        return message;
      }
    }

    // Check for mass file operations in sensitive locations (Windows paths)
    if (/\b(del|rmdir|rd|erase|Remove-Item)\s+.*\\\\?(Users|Documents and Settings|ProgramData)\\.*\*/i.test(command)) {
      return 'Mass file operations in user directories with wildcards are not allowed';
    }

    // Check for system file operations
    if (/\b(del|rmdir|rd|erase|Remove-Item)\s+.*\*.*(exe|dll|sys|ini|bat|cmd|ps1)\b/i.test(command)) {
      return 'Mass operations on system file types are not allowed';
    }

    return null;
  }

  validateToolParams(params: ShellToolParams): string | null {
    // Validation logic would go here
    const errors = null;
    if (errors) {
      return errors;
    }

    // Normalize commands to array format for consistent validation
    const commandsArray = typeof this.params.commands === 'string' 
      ? [{ command: this.params.commands }] 
      : Array.isArray(this.params.commands) && typeof this.params.commands[0] === 'string'
        ? (this.params.commands as string[]).map(cmd => ({ command: cmd }))
        : this.params.commands as CommandBatch[];
    
    const isSingleStringMode = typeof this.params.commands === 'string';

    if (commandsArray.length === 0) {
      return 'At least one command is required.';
    }

    // Validate each command
    for (let i = 0; i < commandsArray.length; i++) {
      const cmdInfo = commandsArray[i];
      const command = cmdInfo.command;

      if (!command || !command.trim()) {
        const message = 'Command cannot be empty.';
        return isSingleStringMode ? message : `Command ${i + 1} cannot be empty.`;
      }

      const commandCheck = isCommandAllowed(command, this.config);
      if (!commandCheck.allowed) {
        if (!commandCheck.reason) {
          console.error(
            'Unexpected: isCommandAllowed returned false without a reason',
          );
          const message = `Command is not allowed: ${command}`;
          return isSingleStringMode ? message : `Command ${i + 1} is not allowed: ${command}`;
        }
        return isSingleStringMode ? commandCheck.reason : `Command ${i + 1}: ${commandCheck.reason}`;
      }

      // Check for dangerous command patterns
      const dangerousPatternCheck = this.checkDangerousPatterns(command);
      if (dangerousPatternCheck) {
        return isSingleStringMode ? dangerousPatternCheck : `Command ${i + 1}: ${dangerousPatternCheck}`;
      }

      if (getCommandRoots(command).length === 0) {
        const message = 'Could not identify command root to obtain permission from user.';
        return isSingleStringMode ? message : `Command ${i + 1}: Could not identify command root to obtain permission from user.`;
      }
    }

    if (this.params.directory) {
      if (path.isAbsolute(this.params.directory)) {
        return 'Directory cannot be absolute. Must be relative to the project root directory.';
      }
      const directory = path.resolve(
        this.config.getTargetDir(),
        this.params.directory,
      );
      if (!fs.existsSync(directory)) {
        return 'Directory must exist.';
      }
    }
    return null;
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.validateToolParams(this.params)) {
      return false; // skip confirmation, execute call will fail immediately
    }

    // Normalize commands to array format
    const commandsArray = typeof this.params.commands === 'string' 
      ? [{ command: this.params.commands }] 
      : Array.isArray(this.params.commands) && typeof this.params.commands[0] === 'string'
        ? (this.params.commands as string[]).map(cmd => ({ command: cmd }))
        : this.params.commands as CommandBatch[];

    // Get all root commands from all commands
    const allRootCommands = new Set<string>();
    let displayCommand = '';

    if (typeof this.params.commands === 'string') {
      const command = stripShellWrapper(this.params.commands);
      displayCommand = this.params.commands;
      getCommandRoots(command).forEach(cmd => allRootCommands.add(cmd));
    } else {
      // For batch commands, show summary and collect all root commands
      const count = this.params.commands.length;
      const firstCommand = typeof this.params.commands[0] === 'string' 
        ? this.params.commands[0] as string
        : (this.params.commands[0] as CommandBatch)?.command || '';
      displayCommand = count === 1 ? firstCommand : `${count} commands: ${firstCommand}${count > 1 ? ' ...' : ''}`;
      
      commandsArray.forEach(cmdInfo => {
        const command = stripShellWrapper(cmdInfo.command);
        getCommandRoots(command).forEach(cmd => allRootCommands.add(cmd));
      });
    }

    const rootCommandsArray = [...allRootCommands];
    const commandsToConfirm = rootCommandsArray.filter(
      (command) => !this.allowlist.has(command),
    );

    if (commandsToConfirm.length === 0) {
      return false; // already approved and whitelisted
    }

    const confirmationDetails: ToolExecuteConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: displayCommand,
      rootCommand: commandsToConfirm.join(', '),
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          commandsToConfirm.forEach((command) => this.allowlist.add(command));
        }
      },
    };
    return confirmationDetails;
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(this.params);
    if (validationError) {
      return {
        llmContent: validationError,
        returnDisplay: validationError,
      };
    }

    if (signal.aborted) {
      return {
        llmContent: 'Command was cancelled by user before it could start.',
        returnDisplay: 'Command cancelled by user.',
      };
    }

    // Normalize commands to array format
    const commandsArray = typeof this.params.commands === 'string' 
      ? [{ command: this.params.commands }] 
      : Array.isArray(this.params.commands) && typeof this.params.commands[0] === 'string'
        ? (this.params.commands as string[]).map(cmd => ({ command: cmd }))
        : this.params.commands as CommandBatch[];

    const isBatchMode = typeof this.params.commands !== 'string';
    const stopOnError = this.params.stopOnError !== false; // Default to true

    // Execute commands
    if (!isBatchMode) {
      // Single command mode - use existing single command format
      return this.executeSingleCommand(commandsArray[0].command, signal, updateOutput);
    } else {
      // Batch command mode - execute sequentially
      return this.executeBatchCommands(commandsArray, signal, updateOutput, stopOnError);
    }
  }

  private async executeSingleCommand(
    command: string,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const strippedCommand = stripShellWrapper(command);
    
    const isWindows = os.platform() === 'win32';
    const tempFileName = `shell_pgrep_${crypto
      .randomBytes(6)
      .toString('hex')}.tmp`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);

    // pgrep is not available on Windows, so we can't get background PIDs
    const commandToExecute = isWindows
      ? strippedCommand
      : (() => {
          // wrap command to append subprocess pids (via pgrep) to temporary file
          let cmd = strippedCommand.trim();
          if (!cmd.endsWith('&')) cmd += ';';
          return `{ ${cmd} }; __code=$?; pgrep -g 0 >${tempFilePath} 2>&1; exit $__code;`;
        })();

    // spawn command in specified directory (or project root if not specified)
    const cwd = path.resolve(this.config.getTargetDir(), this.params.directory || '');
    const env = {
      ...process.env,
      GEMINI_CLI: '1',
    };

    // Log command execution start
    logger.debug(`Executing command: ${command}`, LogLevel.VERBOSE);
    logger.debug(`Directory: ${this.params.directory || '(root)'}`, LogLevel.VERBOSE);
    logger.debug(`Working directory: ${cwd}`, LogLevel.VERBOSE);

    let shell: any;
    
    if (isWindows) {
      // Use execa for Windows - parse command with proper quote handling
      const parsedArgs = parseCommandWithQuotes(commandToExecute);
      shell = execa('cmd.exe', ['/c', ...parsedArgs], {
        cwd,
        env,
        stdout: ['pipe'],
        stderr: ['pipe'],
        cancelSignal: signal,
      });
    } else {
      // Use spawn for non-Windows (existing implementation)
      shell = spawn('bash', ['-c', commandToExecute], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        cwd,
        env,
      });
    }

    let exited = false;
    let stdout = '';
    let stderr = '';
    let output = '';
    let lastUpdateTime = Date.now();

    const appendOutput = (str: string) => {
      output += str;
      if (
        updateOutput &&
        Date.now() - lastUpdateTime > OUTPUT_UPDATE_INTERVAL_MS
      ) {
        updateOutput(output);
        lastUpdateTime = Date.now();
      }
    };

    if (isWindows) {
      // Handle execa output
      shell.stdout?.on('data', (data: Buffer) => {
        if (!exited) {
          const str = stripAnsi(data.toString());
          stdout += str;
          appendOutput(str);
        }
      });

      shell.stderr?.on('data', (data: Buffer) => {
        if (!exited) {
          const str = stripAnsi(data.toString());
          stderr += str;
          appendOutput(str);
        }
      });

      let error: Error | null = null;
      let code: number | null = null;
      let processSignal: NodeJS.Signals | null = null;

      // Wait for process completion
      try {
        const result = await shell;
        exited = true;
        code = result.exitCode;
        
        if (result.stderr) {
          stderr += result.stderr;
          appendOutput(result.stderr);
        }
      } catch (err: any) {
        exited = true;
        error = err;
        code = err.exitCode || null;
        processSignal = err.signal || null;
        
        if (err.stderr) {
          stderr += err.stderr;
          appendOutput(err.stderr);
        }
      }

      const backgroundPIDs: number[] = [];
      return await this.formatSingleCommandResult(command, stdout, stderr, error, code, processSignal, backgroundPIDs, null, signal, output);
    }

    // Non-Windows implementation
    shell.stdout.on('data', (data: Buffer) => {
      if (!exited) {
        const str = stripAnsi(data.toString());
        stdout += str;
        appendOutput(str);
      }
    });

    shell.stderr.on('data', (data: Buffer) => {
      if (!exited) {
        const str = stripAnsi(data.toString());
        stderr += str;
        appendOutput(str);
      }
    });

    let error: Error | null = null;
    shell.on('error', (err: Error) => {
      error = err;
      error.message = error.message.replace(commandToExecute, command);
    });

    let code: number | null = null;
    let processSignal: NodeJS.Signals | null = null;
    const exitHandler = (_code: number | null, _signal: NodeJS.Signals | null) => {
      exited = true;
      code = _code;
      processSignal = _signal;
    };
    shell.on('exit', exitHandler);

    const abortHandler = async () => {
      if (shell.pid && !exited) {
        try {
          process.kill(-shell.pid, 'SIGTERM');
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (shell.pid && !exited) {
            process.kill(-shell.pid, 'SIGKILL');
          }
        } catch (_e) {
          try {
            if (shell.pid) {
              shell.kill('SIGKILL');
            }
          } catch (_e) {
            console.error(`failed to kill shell process ${shell.pid}: ${_e}`);
          }
        }
      }
    };
    signal.addEventListener('abort', abortHandler);

    // wait for the shell to exit
    try {
      await new Promise((resolve) => shell.on('exit', resolve));
    } finally {
      signal.removeEventListener('abort', abortHandler);
    }

    // parse pids (pgrep output) from temporary file and remove it
    const backgroundPIDs: number[] = [];
    if (fs.existsSync(tempFilePath)) {
      const pgrepLines = fs
        .readFileSync(tempFilePath, 'utf8')
        .split('\n')
        .filter(Boolean);
      for (const line of pgrepLines) {
        if (!/^\d+$/.test(line)) {
          console.error(`pgrep: ${line}`);
        }
        const pid = Number(line);
        if (pid !== shell.pid) {
          backgroundPIDs.push(pid);
        }
      }
      fs.unlinkSync(tempFilePath);
    } else {
      if (!signal.aborted) {
        console.error('missing pgrep output');
      }
    }

    // Log command completion details
    logger.debug(`Command completed: ${command}`, LogLevel.VERBOSE);
    logger.debug(`Exit code: ${code ?? '(none)'}`, LogLevel.VERBOSE);
    logger.debug(`Signal: ${processSignal ?? '(none)'}`, LogLevel.VERBOSE);
    if (error) {
      logger.debug(`Error: ${error.message}`, LogLevel.NORMAL);
    }
    if (backgroundPIDs.length > 0) {
      logger.debug(`Background PIDs: ${backgroundPIDs.join(', ')}`, LogLevel.VERBOSE);
    }

    return await this.formatSingleCommandResult(command, stdout, stderr, error, code, processSignal, backgroundPIDs, shell.pid, signal, output);
  }

  private async executeBatchCommands(
    commands: CommandBatch[],
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
    stopOnError: boolean = true,
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const results: Array<{
      command: string;
      description?: string;
      stdout: string;
      stderr: string;
      error: Error | null;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      duration: number;
    }> = [];

    let totalOutput = '';
    let executedCount = 0;

    // Log batch execution start
    logger.debug(`Starting batch execution of ${commands.length} commands`, LogLevel.NORMAL);
    logger.debug(`Stop on error: ${stopOnError}`, LogLevel.VERBOSE);

    for (let i = 0; i < commands.length; i++) {
      if (signal.aborted) {
        break;
      }

      const cmdInfo = commands[i];
      const cmdStartTime = Date.now();

      // Log individual command in batch
      logger.debug(`Executing batch command ${i + 1}/${commands.length}: ${cmdInfo.command}`, LogLevel.NORMAL);
      if (cmdInfo.description) {
        logger.debug(`Description: ${cmdInfo.description}`, LogLevel.VERBOSE);
      }

      let cmdOutput = '';
      const cmdUpdateOutput = (output: string) => {
        cmdOutput = output;
        totalOutput = this.formatBatchProgress(results, cmdOutput, i, commands.length);
        updateOutput?.(totalOutput);
      };

      try {
        const result = await this.executeSingleCommand(cmdInfo.command, signal, cmdUpdateOutput);
        
        const cmdDuration = Date.now() - cmdStartTime;
        
        // Parse the result to extract components
        const content = typeof result.llmContent === 'string' ? result.llmContent : String(result.llmContent);
        const lines = content.split('\n');
        const stdout = lines.find((l: string) => l.startsWith('Stdout: '))?.substring(8) || '(empty)';
        const stderr = lines.find((l: string) => l.startsWith('Stderr: '))?.substring(8) || '(empty)';
        const errorLine = lines.find((l: string) => l.startsWith('Error: '))?.substring(7) || '(none)';
        const exitCodeLine = lines.find((l: string) => l.startsWith('Exit Code: '))?.substring(11) || '(none)';
        const signalLine = lines.find((l: string) => l.startsWith('Signal: '))?.substring(8) || '(none)';
        
        const error = errorLine !== '(none)' ? new Error(errorLine) : null;
        const exitCode = exitCodeLine !== '(none)' ? parseInt(exitCodeLine) : null;
        const processSignal = signalLine !== '(none)' ? signalLine as NodeJS.Signals : null;

        results.push({
          command: cmdInfo.command,
          description: cmdInfo.description,
          stdout: stdout === '(empty)' ? '' : stdout,
          stderr: stderr === '(empty)' ? '' : stderr,
          error,
          exitCode,
          signal: processSignal,
          duration: cmdDuration,
        });

        executedCount++;

        // Log command completion
        const cmdDurationSec = (cmdDuration / 1000).toFixed(1);
        logger.debug(`Batch command ${i + 1} completed in ${cmdDurationSec}s, exit code: ${exitCode ?? '(none)'}`, LogLevel.NORMAL);
        if (error) {
          logger.debug(`Batch command ${i + 1} error: ${error.message}`, LogLevel.NORMAL);
        }

        // Check if we should stop on error
        const shouldStop = error || (exitCode !== null && exitCode !== 0);
        const continueOnError = cmdInfo.continueOnError ?? !stopOnError;
        
        if (shouldStop && !continueOnError) {
          logger.debug(`Stopping batch execution due to error in command ${i + 1}`, LogLevel.NORMAL);
          break;
        }
      } catch (err) {
        const cmdDuration = Date.now() - cmdStartTime;
        results.push({
          command: cmdInfo.command,
          description: cmdInfo.description,
          stdout: '',
          stderr: getErrorMessage(err),
          error: err instanceof Error ? err : new Error(String(err)),
          exitCode: null,
          signal: null,
          duration: cmdDuration,
        });

        executedCount++;
        
        const continueOnError = cmdInfo.continueOnError ?? !stopOnError;
        if (!continueOnError) {
          break;
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    const totalDurationSec = (totalDuration / 1000).toFixed(1);
    logger.debug(`Batch execution completed: ${executedCount}/${commands.length} commands executed in ${totalDurationSec}s`, LogLevel.NORMAL);
    
    return this.formatBatchResult(commands, results, totalDuration, signal, executedCount);
  }

  private async formatSingleCommandResult(
    command: string,
    stdout: string,
    stderr: string,
    error: Error | null,
    code: number | null,
    processSignal: NodeJS.Signals | null,
    backgroundPIDs: number[],
    shellPid: number | null,
    signal: AbortSignal,
    output: string,
  ): Promise<ToolResult> {
    let llmContent = '';
    if (signal.aborted) {
      llmContent = 'Command was cancelled by user before it could complete.';
      if (output.trim()) {
        llmContent += ` Below is the output (on stdout and stderr) before it was cancelled:\n${output}`;
      } else {
        llmContent += ' There was no output before it was cancelled.';
      }
    } else {
      llmContent = [
        `Command: ${command}`,
        `Directory: ${this.params.directory || '(root)'}`,
        `Stdout: ${stdout || '(empty)'}`,
        `Stderr: ${stderr || '(empty)'}`,
        `Error: ${error ?? '(none)'}`,
        `Exit Code: ${code ?? '(none)'}`,
        `Signal: ${processSignal ?? '(none)'}`,
        `Background PIDs: ${backgroundPIDs.length ? backgroundPIDs.join(', ') : '(none)'}`,
        `Process Group PGID: ${shellPid ?? '(none)'}`,
      ].join('\n');
    }

    let returnDisplayMessage = '';
    if (this.config.getDebugMode()) {
      returnDisplayMessage = llmContent;
    } else {
      if (stdout.trim()) {
        returnDisplayMessage = stdout;
      } else {
        if (signal.aborted) {
          returnDisplayMessage = 'Command cancelled by user.';
        } else if (processSignal) {
          returnDisplayMessage = `Command terminated by signal: ${processSignal}`;
        } else if (error) {
          returnDisplayMessage = `Command failed: ${getErrorMessage(error)}`;
        } else if (code !== null && code !== 0) {
          returnDisplayMessage = `Command exited with code: ${code}`;
        }
      }
    }

    // Apply summarization if configured
    const summarizeConfig = this.config.getSummarizeToolOutputConfig();
    if (summarizeConfig && summarizeConfig[ShellTool.Name]) {
      const summary = await summarizeToolOutput(
        llmContent,
        this.config.getGeminiClient(),
        signal,
        summarizeConfig[ShellTool.Name].tokenBudget,
      );
      return {
        llmContent: summary,
        returnDisplay: returnDisplayMessage,
      };
    }

    return { llmContent, returnDisplay: returnDisplayMessage };
  }

  private formatBatchResult(
    commands: CommandBatch[],
    results: Array<{
      command: string;
      description?: string;
      stdout: string;
      stderr: string;
      error: Error | null;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      duration: number;
    }>,
    totalDuration: number,
    signal: AbortSignal,
    executedCount: number,
  ): ToolResult {
    let llmContent = '';
    
    if (signal.aborted) {
      llmContent = `Commands were cancelled by user. ${executedCount}/${commands.length} commands executed before cancellation.`;
    } else {
      const totalDurationSec = (totalDuration / 1000).toFixed(1);
      llmContent = [
        `Commands Executed: ${executedCount}/${commands.length}`,
        `Total Duration: ${totalDurationSec}s`,
        '',
      ].join('\n');

      results.forEach((result, index) => {
        const durationSec = (result.duration / 1000).toFixed(1);
        llmContent += [
          `Command ${index + 1}: ${result.command}`,
          result.description ? `  Description: ${result.description}` : '',
          `  Directory: ${this.params.directory || '(root)'}`,
          `  Duration: ${durationSec}s`,
          `  Stdout: ${result.stdout || '(empty)'}`,
          `  Stderr: ${result.stderr || '(empty)'}`,
          `  Exit Code: ${result.exitCode ?? '(none)'}`,
          '',
        ].filter(line => line !== '').join('\n');
      });

      if (executedCount < commands.length) {
        const remaining = commands.slice(executedCount).map(cmd => cmd.command);
        llmContent += `Execution stopped due to error in command ${executedCount}.\n`;
        llmContent += `Remaining commands: ${remaining.join(', ')}`;
      }
    }

    let returnDisplayMessage = '';
    if (this.config.getDebugMode()) {
      returnDisplayMessage = llmContent;
    } else {
      // For batch mode, show a summary in non-debug mode
      const lastResult = results[results.length - 1];
      if (lastResult?.stdout) {
        returnDisplayMessage = lastResult.stdout;
      } else if (signal.aborted) {
        returnDisplayMessage = `Commands cancelled. ${executedCount}/${commands.length} executed.`;
      } else if (executedCount < commands.length) {
        returnDisplayMessage = `Batch execution stopped at command ${executedCount}/${commands.length}`;
      } else {
        returnDisplayMessage = `${executedCount} commands executed successfully`;
      }
    }

    return { llmContent, returnDisplay: returnDisplayMessage };
  }

  private formatBatchProgress(
    results: Array<{
      command: string;
      stdout: string;
      stderr: string;
      error: Error | null;
      exitCode: number | null;
      duration: number;
    }>,
    currentOutput: string,
    currentIndex: number,
    totalCommands: number,
  ): string {
    let output = `Executing command ${currentIndex + 1}/${totalCommands}...\n\n`;
    
    // Show completed commands
    results.forEach((result, index) => {
      output += `✓ Command ${index + 1}: ${result.command}\n`;
    });
    
    // Show current command output
    if (currentOutput) {
      output += `Running: ${currentOutput}`;
    }
    
    return output;
  }
}

export class ShellTool extends BaseDeclarativeTool<ShellToolParams, ToolResult> {
  static readonly Name = 'run_shell_command';

  constructor(private config: Config) {
    super(
      ShellTool.Name,
      'RunShellCommand',
      'Execute shell commands with support for sequential batch execution, Windows quote escaping, dangerous command filtering, and output streaming. For single commands, displays stdout directly; for batch commands, shows execution summary with timing and status.',
      Kind.Execute,
      {
        properties: {
          commands: {
            description:
              'Command(s) to execute. Can be a single string, array of strings, or array of CommandBatch objects with descriptions and error handling options.',
            oneOf: [
              { type: 'string', description: 'Single command string' },
              {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of command strings',
              },
              {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    command: {
                      type: 'string',
                      description: 'The shell command to execute',
                    },
                    description: {
                      type: 'string',
                      description: 'Optional description of what this command does',
                    },
                    continueOnError: {
                      type: 'boolean',
                      description: 'Whether to continue execution if this command fails',
                    },
                  },
                  required: ['command'],
                },
                description: 'Array of CommandBatch objects with metadata',
              },
            ],
          },
          description: {
            type: 'string',
            description: 'Optional description of what the command(s) do',
          },
          directory: {
            type: 'string',
            description:
              'Optional relative directory path from project root where commands should be executed',
          },
          stopOnError: {
            type: 'boolean',
            description:
              'Whether to stop batch execution on first error (default: true). Individual commands can override with continueOnError.',
          },
        },
        required: ['commands'],
        type: 'object',
      },
    );
  }

  createInvocation(params: ShellToolParams): ToolInvocation<ShellToolParams, ToolResult> {
    return new ShellToolInvocation(params, this.config);
  }
}