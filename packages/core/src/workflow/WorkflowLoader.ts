/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import * as yaml from 'yaml';
import { FSWatcher, watch } from 'fs';
import { WorkflowDefinition } from './types.js';
import { validateWorkflowDefinition, ValidationResult } from './schema.js';

export interface LoadedWorkflow {
  definition: WorkflowDefinition;
  filePath: string;
  lastModified: Date;
}

export interface WorkflowLoaderOptions {
  workflowDirectory?: string;
  enableWatching?: boolean;
  supportedExtensions?: string[];
  maxCacheAge?: number;
}

export interface WorkflowDiscoveryResult {
  workflows: LoadedWorkflow[];
  errors: Array<{
    filePath: string;
    error: string;
    validationErrors?: string[];
  }>;
}

export class WorkflowLoader {
  private readonly workflowDirectory: string;
  private readonly enableWatching: boolean;
  private readonly supportedExtensions: string[];
  private readonly maxCacheAge: number;
  
  private cache: Map<string, LoadedWorkflow> = new Map();
  private watchers: Map<string, FSWatcher> = new Map();
  private changeListeners: Array<(filePath: string, workflow?: LoadedWorkflow) => void> = [];

  constructor(options: WorkflowLoaderOptions = {}) {
    this.workflowDirectory = options.workflowDirectory || './workflows';
    this.enableWatching = options.enableWatching ?? false;
    this.supportedExtensions = options.supportedExtensions || ['.yaml', '.yml', '.json'];
    this.maxCacheAge = options.maxCacheAge || 5 * 60 * 1000; // 5 minutes
  }

  async discoverWorkflows(): Promise<WorkflowDiscoveryResult> {
    const result: WorkflowDiscoveryResult = {
      workflows: [],
      errors: []
    };

    try {
      await fs.access(this.workflowDirectory);
    } catch {
      // Directory doesn't exist, return empty result
      return result;
    }

    const patterns = this.supportedExtensions.map(ext => 
      path.join(this.workflowDirectory, `**/*${ext}`)
    );

    for (const pattern of patterns) {
      try {
        const files = await glob(pattern, { 
          nodir: true,
          absolute: true 
        });

        for (const filePath of files) {
          try {
            const workflow = await this.loadWorkflowFile(filePath);
            if (workflow) {
              result.workflows.push(workflow);
              this.cache.set(filePath, workflow);
              
              if (this.enableWatching && !this.watchers.has(filePath)) {
                this.setupFileWatcher(filePath);
              }
            }
          } catch (error) {
            result.errors.push({
              filePath,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      } catch (error) {
        result.errors.push({
          filePath: pattern,
          error: `Failed to search pattern: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }
    }

    return result;
  }

  async loadWorkflow(nameOrPath: string): Promise<LoadedWorkflow | null> {
    // First check if it's a direct file path
    if (nameOrPath.includes('/') || nameOrPath.includes('\\')) {
      const absolutePath = path.isAbsolute(nameOrPath) 
        ? nameOrPath 
        : path.resolve(this.workflowDirectory, nameOrPath);
      
      const cached = this.getCachedWorkflow(absolutePath);
      if (cached) return cached;
      
      const workflow = await this.loadWorkflowFile(absolutePath);
      if (workflow) {
        this.cache.set(absolutePath, workflow);
      }
      return workflow;
    }

    // Search for workflow by name
    const discoveryResult = await this.discoverWorkflows();
    return discoveryResult.workflows.find(w => w.definition.name === nameOrPath) || null;
  }

  async reloadWorkflow(filePath: string): Promise<LoadedWorkflow | null> {
    this.cache.delete(filePath);
    try {
      const workflow = await this.loadWorkflowFile(filePath);
      if (workflow) {
        this.cache.set(filePath, workflow);
        this.notifyChange(filePath, workflow);
      }
      return workflow;
    } catch (error) {
      this.notifyChange(filePath, undefined);
      throw error;
    }
  }

  private async loadWorkflowFile(filePath: string): Promise<LoadedWorkflow | null> {
    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      
      let parsedContent: unknown;
      const ext = path.extname(filePath).toLowerCase();
      
      if (['.yaml', '.yml'].includes(ext)) {
        parsedContent = yaml.parse(content);
      } else if (ext === '.json') {
        parsedContent = JSON.parse(content);
      } else {
        throw new Error(`Unsupported file extension: ${ext}`);
      }

      const validation = this.validateWorkflow(parsedContent, filePath);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors?.join(', ')}`);
      }

      return {
        definition: parsedContent as WorkflowDefinition,
        filePath,
        lastModified: stats.mtime
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  private validateWorkflow(content: unknown, filePath: string): ValidationResult {
    const result = validateWorkflowDefinition(content);
    if (!result.valid && result.errors) {
      // Add file context to errors
      result.errors = result.errors.map(error => `${filePath}: ${error}`);
    }
    return result;
  }

  private getCachedWorkflow(filePath: string): LoadedWorkflow | null {
    const cached = this.cache.get(filePath);
    if (!cached) return null;

    const age = Date.now() - cached.lastModified.getTime();
    if (age > this.maxCacheAge) {
      this.cache.delete(filePath);
      return null;
    }

    return cached;
  }

  private setupFileWatcher(filePath: string): void {
    const watcher = watch(filePath, async (eventType) => {
      if (eventType === 'change') {
        try {
          await this.reloadWorkflow(filePath);
        } catch (error) {
          // File might have been deleted or corrupted
          this.cache.delete(filePath);
          this.notifyChange(filePath, undefined);
        }
      }
    });

    watcher.on('error', (error) => {
      console.warn(`File watcher error for ${filePath}:`, error);
      this.watchers.delete(filePath);
    });

    this.watchers.set(filePath, watcher);
  }

  private notifyChange(filePath: string, workflow?: LoadedWorkflow): void {
    this.changeListeners.forEach(listener => {
      try {
        listener(filePath, workflow);
      } catch (error) {
        console.warn('Error in workflow change listener:', error);
      }
    });
  }

  onWorkflowChange(listener: (filePath: string, workflow?: LoadedWorkflow) => void): void {
    this.changeListeners.push(listener);
  }

  removeChangeListener(listener: (filePath: string, workflow?: LoadedWorkflow) => void): void {
    const index = this.changeListeners.indexOf(listener);
    if (index > -1) {
      this.changeListeners.splice(index, 1);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  async close(): Promise<void> {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.changeListeners.length = 0;
  }

  get cachedWorkflows(): LoadedWorkflow[] {
    return Array.from(this.cache.values());
  }
}