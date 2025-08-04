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
import { WorkflowTemplate, TemplateInstance, TemplateResolutionOptions, TemplateResolutionContext } from './WorkflowTemplate.js';
import { TemplateResolver } from './TemplateResolver.js';
import { BUILTIN_TEMPLATES } from './templates/index.js';

export interface LoadedWorkflow {
  definition: WorkflowDefinition;
  filePath: string;
  lastModified: Date;
  isTemplate?: boolean;
  template?: WorkflowTemplate;
}

export interface WorkflowLoaderOptions {
  workflowDirectory?: string;
  enableWatching?: boolean;
  supportedExtensions?: string[];
  maxCacheAge?: number;
  templateDirectory?: string;
  enableTemplates?: boolean;
  templateResolutionOptions?: TemplateResolutionOptions;
}

export interface WorkflowDiscoveryResult {
  workflows: LoadedWorkflow[];
  templates: LoadedWorkflow[];
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
  private readonly templateDirectory: string;
  private readonly enableTemplates: boolean;
  private readonly templateResolutionOptions: TemplateResolutionOptions;
  
  private cache: Map<string, LoadedWorkflow> = new Map();
  private templateCache: Map<string, WorkflowTemplate> = new Map();
  private watchers: Map<string, FSWatcher> = new Map();
  private changeListeners: Array<(filePath: string, workflow?: LoadedWorkflow) => void> = [];
  
  private templateResolver: TemplateResolver;

  constructor(options: WorkflowLoaderOptions = {}) {
    this.workflowDirectory = options.workflowDirectory || './workflows';
    this.enableWatching = options.enableWatching ?? false;
    this.supportedExtensions = options.supportedExtensions || ['.yaml', '.yml', '.json'];
    this.maxCacheAge = options.maxCacheAge || 5 * 60 * 1000; // 5 minutes
    this.templateDirectory = options.templateDirectory || './templates';
    this.enableTemplates = options.enableTemplates ?? true;
    this.templateResolutionOptions = options.templateResolutionOptions || {
      strictParameterValidation: false,
      allowMissingParameters: false,
      enableParameterInterpolation: true,
      maxInheritanceDepth: 10
    };
    
    this.templateResolver = new TemplateResolver();
    
    // Load built-in templates
    if (this.enableTemplates) {
      this.loadBuiltinTemplates();
    }
  }

  async discoverWorkflows(): Promise<WorkflowDiscoveryResult> {
    const result: WorkflowDiscoveryResult = {
      workflows: [],
      templates: [],
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
              if (workflow.isTemplate) {
                result.templates.push(workflow);
              } else {
                result.workflows.push(workflow);
              }
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

      // Check if this is a template instance
      if (this.enableTemplates && this.isTemplateInstance(parsedContent)) {
        const templateInstance = parsedContent as TemplateInstance;
        const resolvedDefinition = await this.resolveTemplate(templateInstance);
        
        const validation = this.validateWorkflow(resolvedDefinition, filePath);
        if (!validation.valid) {
          throw new Error(`Template resolution validation failed: ${validation.errors?.join(', ')}`);
        }

        return {
          definition: resolvedDefinition,
          filePath,
          lastModified: stats.mtime,
          isTemplate: false // This is a resolved template instance, not a template itself
        };
      }

      // Check if this is a template definition
      if (this.enableTemplates && this.isTemplateDefinition(parsedContent)) {
        // For template definitions, we create a placeholder workflow
        const template = parsedContent as WorkflowTemplate;
        const placeholderDefinition: WorkflowDefinition = {
          name: template.metadata.name,
          version: template.metadata.version,
          description: template.metadata.description,
          steps: []
        };

        return {
          definition: placeholderDefinition,
          filePath,
          lastModified: stats.mtime,
          isTemplate: true,
          template
        };
      }

      // Regular workflow validation
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

  /**
   * Load built-in templates
   */
  private loadBuiltinTemplates(): void {
    for (const template of BUILTIN_TEMPLATES.values()) {
      this.templateCache.set(template.metadata.id, template);
    }
  }

  /**
   * Load templates from template directory
   */
  async discoverTemplates(): Promise<{ templates: WorkflowTemplate[]; errors: Array<{ filePath: string; error: string }> }> {
    const result = {
      templates: [] as WorkflowTemplate[],
      errors: [] as Array<{ filePath: string; error: string }>
    };

    if (!this.enableTemplates) {
      return result;
    }

    // Add built-in templates
    result.templates.push(...Array.from(BUILTIN_TEMPLATES.values()));

    try {
      await fs.access(this.templateDirectory);
    } catch {
      // Template directory doesn't exist, return built-in templates only
      return result;
    }

    const patterns = this.supportedExtensions.map(ext => 
      path.join(this.templateDirectory, `**/*${ext}`)
    );

    for (const pattern of patterns) {
      try {
        const files = await glob(pattern, { 
          nodir: true,
          absolute: true 
        });

        for (const filePath of files) {
          try {
            const template = await this.loadTemplateFile(filePath);
            if (template) {
              result.templates.push(template);
              this.templateCache.set(template.metadata.id, template);
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

  /**
   * Load a template file
   */
  private async loadTemplateFile(filePath: string): Promise<WorkflowTemplate | null> {
    try {
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

      // Basic validation - templates should have metadata and template properties
      if (typeof parsedContent === 'object' && parsedContent !== null) {
        const obj = parsedContent as any;
        if (obj.metadata && obj.template) {
          return obj as WorkflowTemplate;
        }
      }

      throw new Error('Invalid template format - missing metadata or template property');
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Resolve a template instance into a workflow definition
   */
  async resolveTemplate(instance: TemplateInstance): Promise<WorkflowDefinition> {
    if (!this.enableTemplates) {
      throw new Error('Templates are not enabled');
    }

    // Ensure templates are loaded
    await this.discoverTemplates();

    // Create resolution context
    const context: TemplateResolutionContext = {
      templates: this.templateCache,
      parameters: instance.parameters,
      options: this.templateResolutionOptions,
      conflicts: []
    };

    return this.templateResolver.resolveTemplate(instance, context);
  }

  /**
   * Get available templates
   */
  async getAvailableTemplates(): Promise<WorkflowTemplate[]> {
    if (!this.enableTemplates) {
      return [];
    }

    const discovery = await this.discoverTemplates();
    return discovery.templates;
  }

  /**
   * Get a specific template by ID
   */
  async getTemplate(templateId: string): Promise<WorkflowTemplate | null> {
    if (!this.enableTemplates) {
      return null;
    }

    await this.discoverTemplates();
    return this.templateCache.get(templateId) || null;
  }

  /**
   * Create workflow from template
   */
  async createWorkflowFromTemplate(
    templateId: string,
    parameters: Record<string, unknown>,
    name?: string,
    overrides?: TemplateInstance['overrides']
  ): Promise<WorkflowDefinition> {
    const instance: TemplateInstance = {
      templateId,
      parameters,
      name,
      overrides
    };

    return this.resolveTemplate(instance);
  }

  /**
   * Check if parsed content is a template instance
   */
  private isTemplateInstance(content: unknown): boolean {
    if (typeof content !== 'object' || content === null) {
      return false;
    }

    const obj = content as any;
    return typeof obj.templateId === 'string' && 
           typeof obj.parameters === 'object' &&
           obj.parameters !== null;
  }

  /**
   * Check if parsed content is a template definition
   */
  private isTemplateDefinition(content: unknown): boolean {
    if (typeof content !== 'object' || content === null) {
      return false;
    }

    const obj = content as any;
    return typeof obj.metadata === 'object' &&
           obj.metadata !== null &&
           typeof obj.metadata.id === 'string' &&
           typeof obj.template === 'object' &&
           obj.template !== null &&
           Array.isArray(obj.parameters);
  }
}