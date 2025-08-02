/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowLoader, WorkflowLoaderOptions } from './WorkflowLoader.js';
import { WorkflowDefinition } from './types.js';
import { vol } from 'memfs';

// Mock the fs module
vi.mock('fs/promises', async () => {
  const memfs = await import('memfs');
  return memfs.fs.promises;
});

vi.mock('fs', async () => {
  const memfs = await import('memfs');
  return {
    ...memfs.fs,
    watch: vi.fn(() => ({
      close: vi.fn(),
      on: vi.fn()
    }))
  };
});

vi.mock('glob', () => ({
  glob: vi.fn()
}));

// Get the mocked glob function
const mockGlob = vi.fn();

describe('WorkflowLoader', () => {
  let loader: WorkflowLoader;
  
  const sampleWorkflow: WorkflowDefinition = {
    name: 'Test Workflow',
    version: '1.0.0',
    steps: [
      {
        id: 'test-step',
        name: 'Test Step',
        type: 'script',
        config: {
          command: 'echo',
          args: ['hello']
        }
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    
    // Setup mock glob function
    vi.mocked(require('glob')).glob = mockGlob;
    
    // Setup default workflow directory structure
    vol.fromJSON({
      '/workflows/test-workflow.yaml': `name: Test Workflow
version: 1.0.0
steps:
  - id: test-step
    name: Test Step
    type: script
    config:
      command: echo
      args: [hello]`,
      '/workflows/nested/another-workflow.json': JSON.stringify(sampleWorkflow),
      '/workflows/invalid-workflow.yaml': 'invalid: yaml: content: [',
      '/workflows/invalid-schema.yaml': `name: Invalid
version: invalid-version
steps: []`
    });
  });

  afterEach(() => {
    if (loader) {
      loader.close();
    }
  });

  describe('constructor', () => {
    it('should use default options when none provided', () => {
      loader = new WorkflowLoader();
      expect(loader).toBeDefined();
    });

    it('should accept custom options', () => {
      const options: WorkflowLoaderOptions = {
        workflowDirectory: '/custom/workflows',
        enableWatching: true,
        supportedExtensions: ['.yaml'],
        maxCacheAge: 10000
      };
      
      loader = new WorkflowLoader(options);
      expect(loader).toBeDefined();
    });
  });

  describe('discoverWorkflows', () => {
    beforeEach(() => {
      loader = new WorkflowLoader({ workflowDirectory: '/workflows' });
    });

    it('should discover YAML and JSON workflows', async () => {
      mockGlob
        .mockResolvedValueOnce(['/workflows/test-workflow.yaml'])
        .mockResolvedValueOnce(['/workflows/nested/another-workflow.json']);

      const result = await loader.discoverWorkflows();
      
      expect(result.workflows).toHaveLength(2);
      expect(result.workflows[0].definition.name).toBe('Test Workflow');
      expect(result.workflows[1].definition.name).toBe('Test Workflow');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle invalid YAML files gracefully', async () => {
      mockGlob.mockResolvedValueOnce(['/workflows/invalid-workflow.yaml']);

      const result = await loader.discoverWorkflows();
      
      expect(result.workflows).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].filePath).toBe('/workflows/invalid-workflow.yaml');
    });

    it('should handle schema validation errors', async () => {
      mockGlob.mockResolvedValueOnce(['/workflows/invalid-schema.yaml']);

      const result = await loader.discoverWorkflows();
      
      expect(result.workflows).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Validation failed');
    });

    it('should return empty result when directory does not exist', async () => {
      loader = new WorkflowLoader({ workflowDirectory: '/nonexistent' });
      
      const result = await loader.discoverWorkflows();
      
      expect(result.workflows).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('loadWorkflow', () => {
    beforeEach(() => {
      loader = new WorkflowLoader({ workflowDirectory: '/workflows' });
    });

    it('should load workflow by file path', async () => {
      const workflow = await loader.loadWorkflow('/workflows/test-workflow.yaml');
      
      expect(workflow).toBeDefined();
      expect(workflow?.definition.name).toBe('Test Workflow');
      expect(workflow?.filePath).toBe('/workflows/test-workflow.yaml');
    });

    it('should load workflow by name', async () => {
      mockGlob
        .mockResolvedValueOnce(['/workflows/test-workflow.yaml'])
        .mockResolvedValueOnce([]);

      const workflow = await loader.loadWorkflow('Test Workflow');
      
      expect(workflow).toBeDefined();
      expect(workflow?.definition.name).toBe('Test Workflow');
    });

    it('should return null for non-existent workflow', async () => {
      const workflow = await loader.loadWorkflow('/nonexistent/workflow.yaml');
      
      expect(workflow).toBeNull();
    });

    it('should handle relative paths', async () => {
      const workflow = await loader.loadWorkflow('test-workflow.yaml');
      
      expect(workflow).toBeDefined();
      expect(workflow?.definition.name).toBe('Test Workflow');
    });
  });

  describe('reloadWorkflow', () => {
    beforeEach(() => {
      loader = new WorkflowLoader({ workflowDirectory: '/workflows' });
    });

    it('should reload workflow and update cache', async () => {
      const filePath = '/workflows/test-workflow.yaml';
      
      // Load initially
      await loader.loadWorkflow(filePath);
      expect(loader.cachedWorkflows).toHaveLength(1);
      
      // Modify file content
      vol.writeFileSync(filePath, `name: Updated Workflow
version: 1.1.0
steps:
  - id: updated-step
    name: Updated Step
    type: script
    config:
      command: echo
      args: [updated]`);
      
      const reloaded = await loader.reloadWorkflow(filePath);
      
      expect(reloaded).toBeDefined();
      expect(reloaded?.definition.name).toBe('Updated Workflow');
      expect(reloaded?.definition.version).toBe('1.1.0');
    });

    it('should handle reload errors', async () => {
      const filePath = '/workflows/test-workflow.yaml';
      
      // Remove file
      vol.unlinkSync(filePath);
      
      await expect(loader.reloadWorkflow(filePath)).rejects.toThrow();
    });
  });

  describe('file watching', () => {
    it('should setup file watchers when enabled', async () => {
      loader = new WorkflowLoader({ 
        workflowDirectory: '/workflows',
        enableWatching: true 
      });
      
      mockGlob.mockResolvedValueOnce(['/workflows/test-workflow.yaml']);
      
      await loader.discoverWorkflows();
      
      // Watchers should be set up (mocked)
      expect(vi.mocked(require('fs').watch)).toHaveBeenCalled();
    });

    it('should support change listeners', () => {
      loader = new WorkflowLoader();
      
      const listener = vi.fn();
      loader.onWorkflowChange(listener);
      
      // Remove listener
      loader.removeChangeListener(listener);
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('cache management', () => {
    beforeEach(() => {
      loader = new WorkflowLoader({ workflowDirectory: '/workflows' });
    });

    it('should cache loaded workflows', async () => {
      await loader.loadWorkflow('/workflows/test-workflow.yaml');
      
      expect(loader.cachedWorkflows).toHaveLength(1);
      expect(loader.cachedWorkflows[0].definition.name).toBe('Test Workflow');
    });

    it('should clear cache', async () => {
      await loader.loadWorkflow('/workflows/test-workflow.yaml');
      expect(loader.cachedWorkflows).toHaveLength(1);
      
      loader.clearCache();
      expect(loader.cachedWorkflows).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('should close all watchers and clear listeners', async () => {
      loader = new WorkflowLoader({ enableWatching: true });
      
      const mockWatcher = {
        close: vi.fn(),
        on: vi.fn()
      };
      vi.mocked(require('fs').watch).mockReturnValue(mockWatcher);
      
      mockGlob.mockResolvedValueOnce(['/workflows/test-workflow.yaml']);
      await loader.discoverWorkflows();
      
      await loader.close();
      
      expect(mockWatcher.close).toHaveBeenCalled();
    });
  });
});