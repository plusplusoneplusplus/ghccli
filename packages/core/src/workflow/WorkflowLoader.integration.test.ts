/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkflowLoader } from './WorkflowLoader.js';
import { WorkflowCache } from './WorkflowCache.js';
import { WorkflowDefinition } from './types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('WorkflowLoader Integration', () => {
  let tempDir: string;
  let loader: WorkflowLoader;
  let cache: WorkflowCache;

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

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-loader-test-'));
    
    // Create workflow files
    await fs.writeFile(
      path.join(tempDir, 'test-workflow.yaml'),
      `name: Test Workflow
version: 1.0.0
steps:
  - id: test-step
    name: Test Step
    type: script
    config:
      command: echo
      args: [hello]`
    );

    await fs.writeFile(
      path.join(tempDir, 'test-workflow.json'),
      JSON.stringify(sampleWorkflow, null, 2)
    );

    loader = new WorkflowLoader({ workflowDirectory: tempDir });
    cache = new WorkflowCache();
  });

  afterEach(async () => {
    if (loader) {
      await loader.close();
    }
    if (cache) {
      cache.destroy();
    }
    
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('WorkflowLoader', () => {
    it('should discover workflows in directory', async () => {
      const result = await loader.discoverWorkflows();
      
      expect(result.workflows.length).toBeGreaterThan(0);
      expect(result.workflows.some(w => w.definition.name === 'Test Workflow')).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should load workflow by file path', async () => {
      const filePath = path.join(tempDir, 'test-workflow.yaml');
      const workflow = await loader.loadWorkflow(filePath);
      
      expect(workflow).toBeDefined();
      expect(workflow?.definition.name).toBe('Test Workflow');
      expect(workflow?.filePath).toBe(filePath);
    });

    it('should return null for non-existent workflow', async () => {
      const workflow = await loader.loadWorkflow(path.join(tempDir, 'nonexistent.yaml'));
      expect(workflow).toBeNull();
    });

    it('should handle JSON workflows', async () => {
      const filePath = path.join(tempDir, 'test-workflow.json');
      const workflow = await loader.loadWorkflow(filePath);
      
      expect(workflow).toBeDefined();
      expect(workflow?.definition.name).toBe('Test Workflow');
    });

    it('should cache loaded workflows', async () => {
      const filePath = path.join(tempDir, 'test-workflow.yaml');
      
      expect(loader.cachedWorkflows).toHaveLength(0);
      
      await loader.loadWorkflow(filePath);
      
      expect(loader.cachedWorkflows).toHaveLength(1);
      expect(loader.cachedWorkflows[0].definition.name).toBe('Test Workflow');
    });
  });

  describe('WorkflowCache', () => {
    it('should store and retrieve workflows', () => {
      const mockWorkflow = {
        definition: sampleWorkflow,
        filePath: '/test/path.yaml',
        lastModified: new Date()
      };

      cache.set('/test/path.yaml', mockWorkflow);
      const retrieved = cache.get('/test/path.yaml');
      
      expect(retrieved).toEqual(mockWorkflow);
    });

    it('should support name-based lookups', () => {
      const mockWorkflow = {
        definition: sampleWorkflow,
        filePath: '/test/path.yaml',
        lastModified: new Date()
      };

      cache.set('/test/path.yaml', mockWorkflow);
      const retrieved = cache.getByName('Test Workflow');
      
      expect(retrieved).toEqual(mockWorkflow);
    });

    it('should handle cache expiration', () => {
      const shortLivedCache = new WorkflowCache({ maxAge: 1 }); // 1ms
      
      const mockWorkflow = {
        definition: sampleWorkflow,
        filePath: '/test/path.yaml',
        lastModified: new Date()
      };

      shortLivedCache.set('/test/path.yaml', mockWorkflow);
      
      // Wait for expiration
      setTimeout(() => {
        const retrieved = shortLivedCache.get('/test/path.yaml');
        expect(retrieved).toBeNull();
        shortLivedCache.destroy();
      }, 10);
    });

    it('should track statistics', () => {
      const mockWorkflow = {
        definition: sampleWorkflow,
        filePath: '/test/path.yaml',
        lastModified: new Date()
      };

      // Miss
      cache.get('/nonexistent');
      
      // Hit
      cache.set('/test/path.yaml', mockWorkflow);
      cache.get('/test/path.yaml');
      
      const stats = cache.getStats();
      
      expect(stats.missCount).toBe(1);
      expect(stats.hitCount).toBe(1);
      expect(stats.totalEntries).toBe(1);
    });
  });
});