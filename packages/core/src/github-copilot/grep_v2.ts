/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { EOL } from 'os';
import { spawn } from 'child_process';
import { globStream } from 'glob';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolInvocation,
  ToolResult,
} from '../tools/tools.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { getErrorMessage, isNodeError } from '../utils/errors.js';
import { isGitRepository } from '../utils/gitUtils.js';
import { Config } from '../config/config.js';

// --- Interfaces ---

/**
 * Parameters for the GrepTool
 */
export interface GrepToolParams {
  /**
   * The regular expression pattern to search for in file contents
   */
  pattern: string;

  /**
   * The directory to search in (optional, defaults to current directory relative to root)
   */
  path?: string;

  /**
   * File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")
   */
  include?: string;

  /**
   * Maximum number of matches to return (optional, defaults to 30)
   */
  limit?: number;
}

/**
 * Result object for a single grep match
 */
interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

export class GrepToolInvocation extends BaseToolInvocation<
  GrepToolParams,
  ToolResult
> {
  constructor(
    params: GrepToolParams,
    private readonly config: Config,
  ) {
    super(params);
  }

  // --- Validation Methods ---

  /**
   * Checks if a path is within the root directory and resolves it.
   * @param relativePath Path relative to the root directory (or undefined for root).
   * @returns The absolute path if valid and exists.
   * @throws {Error} If path is outside root or doesn't exist.
   */
  private resolveAndValidatePath(relativePath?: string): string {
    const targetPath = path.resolve(
      this.config.getTargetDir(),
      relativePath || '.',
    );

    // Security Check: Ensure the resolved path is still within the root directory.
    if (
      !targetPath.startsWith(this.config.getTargetDir()) &&
      targetPath !== this.config.getTargetDir()
    ) {
      throw new Error(
        `Path validation failed: Attempted path "${relativePath || '.'}" resolves outside the allowed root directory "${this.config.getTargetDir()}".`,
      );
    }

    // Check existence (can be either file or directory)
    try {
      const stats = fs.statSync(targetPath);
      if (!stats.isFile() && !stats.isDirectory()) {
        throw new Error(`Path is neither a file nor a directory: ${targetPath}`);
      }
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new Error(`Path does not exist: ${targetPath}`);
      }
      throw new Error(
        `Failed to access path stats for ${targetPath}: ${error}`,
      );
    }

    return targetPath;
  }

  /**
   * Validates the parameters for the tool
   * @param params Parameters to validate
   * @returns An error message string if invalid, null otherwise
   */
  validateToolParams(params: GrepToolParams): string | null {
    try {
      new RegExp(this.params.pattern);
    } catch (error) {
      return `Invalid regular expression pattern provided: ${this.params.pattern}. Error: ${getErrorMessage(error)}`;
    }

    try {
      this.resolveAndValidatePath(this.params.path);
    } catch (error) {
      return getErrorMessage(error);
    }

    if (this.params.limit !== undefined && this.params.limit <= 0) {
      return 'Limit must be a positive number.';
    }

    if (this.params.limit !== undefined && this.params.limit > 100) {
      return 'Limit cannot exceed 100 matches to prevent overwhelming output.';
    }

    return null; // Parameters are valid
  }

  // --- Core Execution ---

  /**
   * Gets a description of the grep operation
   */
  getDescription(): string {
    let description = `'${this.params.pattern}'`;
    if (this.params.include) {
      description += ` in ${this.params.include}`;
    }
    if (this.params.path) {
      const resolvedPath = path.resolve(
        this.config.getTargetDir(),
        this.params.path,
      );
      if (resolvedPath === this.config.getTargetDir() || this.params.path === '.') {
        description += ` within ./`;
      } else {
        const relativePath = makeRelative(
          resolvedPath,
          this.config.getTargetDir(),
        );
        description += ` within ${shortenPath(relativePath)}`;
      }
    }
    return description;
  }

  /**
   * Executes the grep search with the given parameters
   */
  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(this.params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: `Model provided invalid parameters. Error: ${validationError}`,
      };
    }

    let searchDirAbs: string;
    try {
      searchDirAbs = this.resolveAndValidatePath(this.params.path);
      const searchDirDisplay = this.params.path || '.';

      const matches: GrepMatch[] = await this.performGrepSearch({
        pattern: this.params.pattern,
        path: searchDirAbs,
        include: this.params.include,
        signal,
      });

      if (matches.length === 0) {
        const noMatchMsg = `No matches found for pattern "${this.params.pattern}" in path "${searchDirDisplay}"${this.params.include ? ` (filter: "${this.params.include}")` : ''}.`;
        return { llmContent: noMatchMsg, returnDisplay: `No matches found` };
      }

      // Apply limit (default to 30)
      const limit = this.params.limit ?? 30;
      const totalMatchCount = matches.length;
      const isLimited = totalMatchCount > limit;
      const limitedMatches = isLimited ? matches.slice(0, limit) : matches;

      // Group limited matches by file
      const limitedMatchesByFile = limitedMatches.reduce(
        (acc, match) => {
          const relativeFilePath =
            path.relative(
              searchDirAbs,
              path.resolve(searchDirAbs, match.filePath),
            ) || path.basename(match.filePath);
          if (!acc[relativeFilePath]) {
            acc[relativeFilePath] = [];
          }
          acc[relativeFilePath].push(match);
          acc[relativeFilePath].sort((a, b) => a.lineNumber - b.lineNumber);
          return acc;
        },
        {} as Record<string, GrepMatch[]>,
      );

      const displayMatchCount = limitedMatches.length;
      const matchTerm = totalMatchCount === 1 ? 'match' : 'matches';

      let llmContent = `Found ${totalMatchCount} ${matchTerm} for pattern "${this.params.pattern}" in path "${searchDirDisplay}"${this.params.include ? ` (filter: "${this.params.include}")` : ''}`;
      
      if (isLimited) {
        llmContent += `, showing first ${displayMatchCount} matches`;
      }
      
      llmContent += ':\n---\n';

      for (const filePath in limitedMatchesByFile) {
        llmContent += `File: ${filePath}\n`;
        limitedMatchesByFile[filePath].forEach((match) => {
          const trimmedLine = match.line.trim();
          llmContent += `L${match.lineNumber}: ${trimmedLine}\n`;
        });
        llmContent += '---\n';
      }

      if (isLimited) {
        llmContent += `\n[Results truncated: showing ${displayMatchCount} of ${totalMatchCount} total matches. Use the 'limit' parameter to see more matches.]`;
      }

      return {
        llmContent: llmContent.trim(),
        returnDisplay: isLimited ? `Found ${totalMatchCount} ${matchTerm} (showing ${displayMatchCount})` : `Found ${displayMatchCount} ${matchTerm}`,
      };
    } catch (error) {
      console.error(`Error during GrepLogic execution: ${error}`);
      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Error during grep search operation: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }

  // --- Grep Implementation Logic ---

  /**
   * Checks if a command is available in the system's PATH.
   * @param {string} command The command name (e.g., 'git', 'grep').
   * @returns {Promise<boolean>} True if the command is available, false otherwise.
   */
  private isCommandAvailable(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const checkCommand = process.platform === 'win32' ? 'where' : 'command';
      const checkArgs =
        process.platform === 'win32' ? [command] : ['-v', command];
      try {
        const child = spawn(checkCommand, checkArgs, {
          stdio: 'ignore',
          shell: process.platform === 'win32',
        });
        child.on('close', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Parses the standard output of grep-like commands (git grep, system grep).
   * Expects format: filePath:lineNumber:lineContent
   * Handles colons within file paths and line content correctly.
   * @param {string} output The raw stdout string.
   * @param {string} basePath The absolute directory the search was run from, for relative paths.
   * @returns {GrepMatch[]} Array of match objects.
   */
  private parseGrepOutput(output: string, basePath: string): GrepMatch[] {
    const results: GrepMatch[] = [];
    if (!output) return results;

    const lines = output.split(EOL); // Use OS-specific end-of-line

    for (const line of lines) {
      if (!line.trim()) continue;

      // Find the index of the first colon.
      const firstColonIndex = line.indexOf(':');
      if (firstColonIndex === -1) continue; // Malformed

      // Find the index of the second colon, searching *after* the first one.
      const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
      if (secondColonIndex === -1) continue; // Malformed

      // Extract parts based on the found colon indices
      const filePathRaw = line.substring(0, firstColonIndex);
      const lineNumberStr = line.substring(
        firstColonIndex + 1,
        secondColonIndex,
      );
      const lineContent = line.substring(secondColonIndex + 1);

      const lineNumber = parseInt(lineNumberStr, 10);

      if (!isNaN(lineNumber)) {
        const absoluteFilePath = path.resolve(basePath, filePathRaw);
        const relativeFilePath = path.relative(basePath, absoluteFilePath);

        results.push({
          filePath: relativeFilePath || path.basename(absoluteFilePath),
          lineNumber,
          line: lineContent,
        });
      }
    }
    return results;
  }


  /**
   * Performs the actual search using the prioritized strategies.
   * @param options Search options including pattern, absolute path, and include glob.
   * @returns A promise resolving to an array of match objects.
   */
  private async performGrepSearch(options: {
    pattern: string;
    path: string; // Expects absolute path (can be file or directory)
    include?: string;
    signal: AbortSignal;
  }): Promise<GrepMatch[]> {
    const { pattern, path: absolutePath, include } = options;
    let strategyUsed = 'none';

    // Check if the path is a file or directory
    const stats = fs.statSync(absolutePath);
    const isFile = stats.isFile();

    // If it's a single file, handle it directly
    if (isFile) {
      return this.searchInSingleFile(absolutePath, pattern);
    }

    try {
      // --- Strategy 1: git grep ---
      const isGit = isGitRepository(absolutePath);
      const gitAvailable = isGit && (await this.isCommandAvailable('git'));

      if (gitAvailable) {
        strategyUsed = 'git grep';
        const gitArgs = [
          'grep',
          '--untracked',
          '-n',
          '-E',
          '--ignore-case',
          pattern,
        ];
        if (include) {
          gitArgs.push('--', include);
        }

        try {
          const output = await new Promise<string>((resolve, reject) => {
            const child = spawn('git', gitArgs, {
              cwd: absolutePath,
              windowsHide: true,
            });
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
            child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
            child.on('error', (err) =>
              reject(new Error(`Failed to start git grep: ${err.message}`)),
            );
            child.on('close', (code) => {
              const stdoutData = Buffer.concat(stdoutChunks).toString('utf8');
              const stderrData = Buffer.concat(stderrChunks).toString('utf8');
              if (code === 0) resolve(stdoutData);
              else if (code === 1)
                resolve(''); // No matches
              else
                reject(
                  new Error(`git grep exited with code ${code}: ${stderrData}`),
                );
            });
          });
          return this.parseGrepOutput(output, absolutePath);
        } catch (gitError: unknown) {
          console.debug(
            `GrepLogic: git grep failed: ${getErrorMessage(gitError)}. Falling back...`,
          );
        }
      }

      // --- Strategy 2: System grep ---
      if (await this.isCommandAvailable('grep')) {
        strategyUsed = 'system grep';
        try {
          const output = await new Promise<string>((resolve, reject) => {
            const grepArgs = ['-r', '-n', '-E', '-i', pattern];
            if (include) {
              grepArgs.push('--include', include);
            }
            grepArgs.push(absolutePath);

            const child = spawn('grep', grepArgs, {
              windowsHide: true,
            });
            let stdoutData = '';
            let stderrData = '';

            const onData = (data: Buffer) => {
              stdoutData += data.toString('utf8');
            };
            const onStderr = (data: Buffer) => {
              stderrData += data.toString('utf8');
            };
            const onError = (error: Error) => {
              cleanup();
              reject(new Error(`Failed to start system grep: ${error.message}`));
            };
            const onClose = (code: number | null) => {
              stdoutData = Buffer.from(stdoutData, 'utf8')
                .toString('utf8')
                .trim();
              cleanup();
              if (code === 0) resolve(stdoutData);
              else if (code === 1)
                resolve(''); // No matches
              else {
                if (stderrData)
                  reject(
                    new Error(
                      `System grep exited with code ${code}: ${stderrData}`,
                    ),
                  );
                else resolve(''); // Exit code > 1 but no stderr, likely just suppressed errors
              }
            };

            const cleanup = () => {
              child.stdout.removeListener('data', onData);
              child.stderr.removeListener('data', onStderr);
              child.removeListener('error', onError);
              child.removeListener('close', onClose);
              if (child.connected) {
                child.disconnect();
              }
            };

            child.stdout.on('data', onData);
            child.stderr.on('data', onStderr);
            child.on('error', onError);
            child.on('close', onClose);
          });
          return this.parseGrepOutput(output, absolutePath);
        } catch (grepError: unknown) {
          console.debug(
            `GrepLogic: System grep failed: ${getErrorMessage(grepError)}. Falling back...`,
          );
        }
      }

      // --- Strategy 3: Pure JavaScript Fallback ---
      console.debug(
        'GrepLogic: Falling back to JavaScript grep implementation.',
      );
      strategyUsed = 'javascript fallback';
      const globPattern = include ? include : '**/*';
      const ignorePatterns = [
        '.git/**',
        'node_modules/**',
        'bower_components/**',
        '.svn/**',
        '.hg/**',
      ]; // Use glob patterns for ignores here

      const filesStream = globStream(globPattern, {
        cwd: absolutePath,
        dot: true,
        ignore: ignorePatterns,
        absolute: true,
        nodir: true,
        signal: options.signal,
      });

      const regex = new RegExp(pattern, 'i');
      const allMatches: GrepMatch[] = [];

      for await (const filePath of filesStream) {
        const fileAbsolutePath = filePath as string;
        try {
          const content = await fsPromises.readFile(fileAbsolutePath, 'utf8');
          const lines = content.split(/\r?\n/);
          lines.forEach((line, index) => {
            if (regex.test(line)) {
              allMatches.push({
                filePath:
                  path.relative(absolutePath, fileAbsolutePath) ||
                  path.basename(fileAbsolutePath),
                lineNumber: index + 1,
                line,
              });
            }
          });
        } catch (readError: unknown) {
          // Ignore errors like permission denied or file gone during read
          if (!isNodeError(readError) || readError.code !== 'ENOENT') {
            console.debug(
              `GrepLogic: Could not read/process ${fileAbsolutePath}: ${getErrorMessage(readError)}`,
            );
          }
        }
      }

      return allMatches;
    } catch (error: unknown) {
      console.error(
        `GrepLogic: Error in performGrepSearch (Strategy: ${strategyUsed}): ${getErrorMessage(error)}`,
      );
      throw error; // Re-throw
    }
  }

  /**
   * Searches for a pattern within a single file.
   * @param filePath Absolute path to the file
   * @param pattern Regular expression pattern to search for
   * @returns Array of matches found in the file
   */
  private async searchInSingleFile(filePath: string, pattern: string): Promise<GrepMatch[]> {
    try {
      const content = await fsPromises.readFile(filePath, 'utf8');
      const regex = new RegExp(pattern, 'i');
      const matches: GrepMatch[] = [];
      const lines = content.split(/\r?\n/);
      
      lines.forEach((line, index) => {
        if (regex.test(line)) {
          matches.push({
            filePath: path.basename(filePath),
            lineNumber: index + 1,
            line,
          });
        }
      });

      return matches;
    } catch (error: unknown) {
      console.error(
        `GrepLogic: Error reading file ${filePath}: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }
}

/**
 * Implementation of the Grep tool using BaseDeclarativeTool pattern
 */
export class GrepTool extends BaseDeclarativeTool<GrepToolParams, ToolResult> {
  static readonly Name = 'grep_v2';

  constructor(private readonly config: Config) {
    super(
      GrepTool.Name,
      'SearchFileContent',
      'A powerful search tool built on ripgrep. Supports full regex syntax and filters files with glob parameter. Use this for searching file contents with patterns.',
      Kind.Search,
      {
        properties: {
          pattern: {
            description:
              'The regular expression pattern to search for in file contents',
            type: 'string',
          },
          path: {
            description:
              'Optional: The directory to search in (defaults to current directory relative to root)',
            type: 'string',
          },
          include: {
            description:
              'Optional: File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
            type: 'string',
          },
          limit: {
            description:
              'Optional: Maximum number of matches to return (defaults to 30, maximum 100)',
            type: 'number',
          },
        },
        required: ['pattern'],
        type: 'object',
      },
    );
  }

  createInvocation(params: GrepToolParams): ToolInvocation<GrepToolParams, ToolResult> {
    return new GrepToolInvocation(params, this.config);
  }
}
