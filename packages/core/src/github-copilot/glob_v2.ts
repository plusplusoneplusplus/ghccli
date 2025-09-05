/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolInvocation,
  ToolResult,
} from '../tools/tools.js';
import { shortenPath, makeRelative } from '../utils/paths.js';
import { isWithinRoot } from '../utils/fileUtils.js';
import { Config } from '../config/config.js';

// Subset of 'Path' interface provided by 'glob' that we can implement for testing
export interface GlobPath {
  fullpath(): string;
  mtimeMs?: number;
}

/**
 * Sorts file entries based on recency and then alphabetically.
 * Recent files (modified within recencyThresholdMs) are listed first, newest to oldest.
 * Older files are listed after recent ones, sorted alphabetically by path.
 */
export function sortFileEntries(
  entries: GlobPath[],
  nowTimestamp: number,
  recencyThresholdMs: number,
): GlobPath[] {
  const sortedEntries = [...entries];
  sortedEntries.sort((a, b) => {
    const mtimeA = a.mtimeMs ?? 0;
    const mtimeB = b.mtimeMs ?? 0;
    const aIsRecent = nowTimestamp - mtimeA < recencyThresholdMs;
    const bIsRecent = nowTimestamp - mtimeB < recencyThresholdMs;

    if (aIsRecent && bIsRecent) {
      return mtimeB - mtimeA;
    } else if (aIsRecent) {
      return -1;
    } else if (bIsRecent) {
      return 1;
    } else {
      return a.fullpath().localeCompare(b.fullpath());
    }
  });
  return sortedEntries;
}

/**
 * Parameters for the GlobTool
 */
export interface GlobToolParams {
  /**
   * The glob pattern to match files against
   */
  pattern: string;

  /**
   * The directory to search in (optional, defaults to current directory)
   */
  path?: string;

  /**
   * Whether the search should be case-sensitive (optional, defaults to false)
   */
  case_sensitive?: boolean;

  /**
   * Whether to respect .gitignore patterns (optional, defaults to true)
   */
  respect_git_ignore?: boolean;

  /**
   * Maximum number of files to return (optional, defaults to 30)
   */
  limit?: number;
}

export class GlobToolInvocation extends BaseToolInvocation<
  GlobToolParams,
  ToolResult
> {
  constructor(
    params: GlobToolParams,
    private config: Config,
  ) {
    super(params);
  }

  /**
   * Applies limit to the file paths and returns the limited paths along with metadata.
   */
  private applyLimit(
    filePaths: string[],
    limit?: number,
  ): {
    displayPaths: string[];
    totalFileCount: number;
    displayFileCount: number;
    isLimited: boolean;
  } {
    const defaultLimit = 30;
    const effectiveLimit = limit ?? defaultLimit;
    const totalFileCount = filePaths.length;
    const isLimited = totalFileCount > effectiveLimit;
    const displayPaths = isLimited ? filePaths.slice(0, effectiveLimit) : filePaths;
    const displayFileCount = displayPaths.length;

    return {
      displayPaths,
      totalFileCount,
      displayFileCount,
      isLimited,
    };
  }

  /**
   * Generates the result messages based on the search results and limit information.
   */
  private generateResultMessages(
    params: GlobToolParams,
    searchDir: string,
    fileListDescription: string,
    limitInfo: {
      totalFileCount: number;
      displayFileCount: number;
      isLimited: boolean;
    },
    gitIgnoredCount: number,
  ): {
    llmContent: string;
    returnDisplay: string;
  } {
    const { totalFileCount, displayFileCount, isLimited } = limitInfo;

    let resultMessage = `Found ${totalFileCount} file(s) matching "${this.params.pattern}" within ${searchDir}`;
    if (gitIgnoredCount > 0) {
      resultMessage += ` (${gitIgnoredCount} additional files were git-ignored)`;
    }
    
    if (isLimited) {
      resultMessage += `, showing first ${displayFileCount} files`;
    }
    
    resultMessage += `, sorted by modification time (newest first):\n${fileListDescription}`;

    if (isLimited) {
      resultMessage += `\n\n[Results truncated: showing ${displayFileCount} of ${totalFileCount} total files. Use the 'limit' parameter to see more files.]`;
    }

    const returnDisplay = isLimited 
      ? `Found ${totalFileCount} file(s) (showing ${displayFileCount})` 
      : `Found ${displayFileCount} matching file(s)`;

    return {
      llmContent: resultMessage,
      returnDisplay,
    };
  }

  /**
   * Validates the parameters for the tool.
   */
  validateToolParams(params: GlobToolParams): string | null {
    const searchDirAbsolute = path.resolve(
      this.config.getTargetDir(),
      this.params.path || '.',
    );

    if (!isWithinRoot(searchDirAbsolute, this.config.getTargetDir())) {
      return `Search path ("${searchDirAbsolute}") resolves outside the tool's root directory ("${this.config.getTargetDir()}").`;
    }

    const targetDir = searchDirAbsolute || this.config.getTargetDir();
    try {
      if (!fs.existsSync(targetDir)) {
        return `Search path does not exist ${targetDir}`;
      }
      if (!fs.statSync(targetDir).isDirectory()) {
        return `Search path is not a directory: ${targetDir}`;
      }
    } catch (e: unknown) {
      return `Error accessing search path: ${e}`;
    }

    if (
      !this.params.pattern ||
      typeof this.params.pattern !== 'string' ||
      this.params.pattern.trim() === ''
    ) {
      return "The 'pattern' parameter cannot be empty.";
    }

    if (this.params.limit !== undefined && this.params.limit <= 0) {
      return 'Limit must be a positive number.';
    }

    if (this.params.limit !== undefined && this.params.limit > 500) {
      return 'Limit cannot exceed 500 files to prevent overwhelming output.';
    }

    return null;
  }

  /**
   * Gets a description of the glob operation.
   */
  getDescription(): string {
    let description = `'${this.params.pattern}'`;
    if (this.params.path) {
      const searchDir = path.resolve(
        this.config.getTargetDir(),
        this.params.path || '.',
      );
      const relativePath = makeRelative(searchDir, this.config.getTargetDir());
      description += ` within ${shortenPath(relativePath)}`;
    }
    return description;
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(this.params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
      };
    }

    try {
      const searchDirAbsolute = path.resolve(
        this.config.getTargetDir(),
        this.params.path || '.',
      );

      const respectGitIgnore =
        this.params.respect_git_ignore ??
        this.config.getFileFilteringRespectGitIgnore();
      const fileDiscovery = this.config.getFileService();

      const entries = (await glob(this.params.pattern, {
        cwd: searchDirAbsolute,
        withFileTypes: true,
        nodir: true,
        stat: true,
        nocase: !this.params.case_sensitive,
        dot: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        follow: false,
        signal,
      })) as GlobPath[];

      let filteredEntries = entries;
      let gitIgnoredCount = 0;

      if (respectGitIgnore) {
        const relativePaths = entries.map((p) =>
          path.relative(this.config.getTargetDir(), p.fullpath()),
        );
        const filteredRelativePaths = fileDiscovery.filterFiles(relativePaths, {
          respectGitIgnore,
        });
        const filteredAbsolutePaths = new Set(
          filteredRelativePaths.map((p) =>
            path.resolve(this.config.getTargetDir(), p),
          ),
        );

        filteredEntries = entries.filter((entry) =>
          filteredAbsolutePaths.has(entry.fullpath()),
        );
        gitIgnoredCount = entries.length - filteredEntries.length;
      }

      if (!filteredEntries || filteredEntries.length === 0) {
        let message = `No files found matching pattern "${this.params.pattern}" within ${searchDirAbsolute}.`;
        if (gitIgnoredCount > 0) {
          message += ` (${gitIgnoredCount} files were git-ignored)`;
        }
        return {
          llmContent: message,
          returnDisplay: `No files found`,
        };
      }

      const oneDayInMs = 24 * 60 * 60 * 1000;
      const nowTimestamp = new Date().getTime();

      const sortedEntries = sortFileEntries(
        filteredEntries,
        nowTimestamp,
        oneDayInMs,
      );

      const sortedAbsolutePaths = sortedEntries.map((entry) =>
        entry.fullpath(),
      );

      const limitInfo = this.applyLimit(sortedAbsolutePaths, this.params.limit);
      const needsLimit = limitInfo.isLimited;

      if (needsLimit) {
        const { displayPaths, totalFileCount, displayFileCount, isLimited } = limitInfo;
        
        const fileListDescription = displayPaths.join('\n');

        return this.generateResultMessages(
          this.params,
          searchDirAbsolute,
          fileListDescription,
          { totalFileCount, displayFileCount, isLimited },
          gitIgnoredCount,
        );
      } else {
        const fileListDescription = sortedAbsolutePaths.join('\n');
        const { totalFileCount } = limitInfo;
        const displayFileCount = sortedAbsolutePaths.length;

        let resultMessage = `Found ${totalFileCount} file(s) matching "${this.params.pattern}" within ${searchDirAbsolute}`;
        if (gitIgnoredCount > 0) {
          resultMessage += ` (${gitIgnoredCount} additional files were git-ignored)`;
        }
        
        resultMessage += `, sorted by modification time (newest first):\n${fileListDescription}`;

        return {
          llmContent: resultMessage,
          returnDisplay: `Found ${displayFileCount} matching file(s)`,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`GlobLogic execute Error: ${errorMessage}`, error);
      return {
        llmContent: `Error during glob search operation: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }
}

/**
 * Implementation of the Glob tool logic
 */
export class GlobTool extends BaseDeclarativeTool<GlobToolParams, ToolResult> {
  static readonly Name = 'glob_v2';

  constructor(private config: Config) {
    super(
      GlobTool.Name,
      'FindFiles',
      'Fast file pattern matching tool that works with any codebase size. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time. Use this tool when you need to find files by name patterns.',
      Kind.Search,
      {
        properties: {
          pattern: {
            description:
              "The glob pattern to match against (e.g., '**/*.py', 'docs/*.md').",
            type: 'string',
          },
          path: {
            description:
              'Optional: The absolute path to the directory to search within. If omitted, searches the root directory.',
            type: 'string',
          },
          case_sensitive: {
            description:
              'Optional: Whether the search should be case-sensitive. Defaults to false.',
            type: 'boolean',
          },
          respect_git_ignore: {
            description:
              'Optional: Whether to respect .gitignore patterns when finding files. Only available in git repositories. Defaults to true.',
            type: 'boolean',
          },
          limit: {
            description:
              'Optional: Maximum number of files to return. Defaults to 30, maximum 500.',
            type: 'number',
          },
        },
        required: ['pattern'],
        type: 'object',
      },
    );
  }

  createInvocation(params: GlobToolParams): ToolInvocation<GlobToolParams, ToolResult> {
    return new GlobToolInvocation(params, this.config);
  }
}
