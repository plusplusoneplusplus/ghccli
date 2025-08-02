/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowCache, WorkflowCacheOptions } from './WorkflowCache.js';
import { LoadedWorkflow } from './WorkflowLoader.js';
import { WorkflowDefinition } from './types.js';

describe('WorkflowCache', () => {
  let cache: WorkflowCache;
  
  const createMockWorkflow = (name: string, filePath: string): LoadedWorkflow => ({
    definition: {
      name,
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
    },
    filePath,
    lastModified: new Date()
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (cache) {
      cache.destroy();
    }
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should use default options when none provided', () => {
      cache = new WorkflowCache();
      expect(cache).toBeDefined();
    });

    it('should accept custom options', () => {
      const options: WorkflowCacheOptions = {
        maxSize: 50,
        maxAge: 60000,
        cleanupInterval: 5000,
        enableStats: true
      };
      
      cache = new WorkflowCache(options);
      expect(cache).toBeDefined();
    });

    it('should start periodic cleanup when interval is specified', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      
      cache = new WorkflowCache({ cleanupInterval: 5000 });
      
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    });
  });

  describe('basic operations', () => {
    beforeEach(() => {
      cache = new WorkflowCache();
    });

    it('should store and retrieve workflows by file path', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', workflow);
      const retrieved = cache.get('/path/to/workflow.yaml');
      
      expect(retrieved).toEqual(workflow);
    });

    it('should store and retrieve workflows by name', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', workflow);
      const retrieved = cache.get('Test Workflow');
      
      expect(retrieved).toEqual(workflow);
    });

    it('should return null for non-existent workflows', () => {
      const retrieved = cache.get('/nonexistent/workflow.yaml');
      expect(retrieved).toBeNull();
    });

    it('should check if workflow exists', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      expect(cache.has('/path/to/workflow.yaml')).toBe(false);
      
      cache.set('/path/to/workflow.yaml', workflow);
      
      expect(cache.has('/path/to/workflow.yaml')).toBe(true);
      expect(cache.has('Test Workflow')).toBe(true);
    });

    it('should delete workflows', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', workflow);
      expect(cache.has('/path/to/workflow.yaml')).toBe(true);
      
      const deleted = cache.delete('/path/to/workflow.yaml');
      
      expect(deleted).toBe(true);
      expect(cache.has('/path/to/workflow.yaml')).toBe(false);
      expect(cache.has('Test Workflow')).toBe(false);
    });

    it('should clear all workflows', () => {
      const workflow1 = createMockWorkflow('Workflow 1', '/path/to/workflow1.yaml');
      const workflow2 = createMockWorkflow('Workflow 2', '/path/to/workflow2.yaml');
      
      cache.set('/path/to/workflow1.yaml', workflow1);
      cache.set('/path/to/workflow2.yaml', workflow2);
      
      expect(cache.getAllWorkflows()).toHaveLength(2);
      
      cache.clear();
      
      expect(cache.getAllWorkflows()).toHaveLength(0);
    });
  });

  describe('name-based operations', () => {
    beforeEach(() => {
      cache = new WorkflowCache();
    });

    it('should retrieve workflow by name', () => {
      const workflow = createMockWorkflow('Named Workflow', '/path/to/named.yaml');
      
      cache.set('/path/to/named.yaml', workflow);
      const retrieved = cache.getByName('Named Workflow');
      
      expect(retrieved).toEqual(workflow);
    });

    it('should get all workflow names', () => {
      const workflow1 = createMockWorkflow('Workflow A', '/path/to/a.yaml');
      const workflow2 = createMockWorkflow('Workflow B', '/path/to/b.yaml');
      
      cache.set('/path/to/a.yaml', workflow1);
      cache.set('/path/to/b.yaml', workflow2);
      
      const names = cache.getWorkflowNames();
      
      expect(names).toContain('Workflow A');
      expect(names).toContain('Workflow B');
      expect(names).toHaveLength(2);
    });

    it('should get all workflows', () => {
      const workflow1 = createMockWorkflow('Workflow A', '/path/to/a.yaml');
      const workflow2 = createMockWorkflow('Workflow B', '/path/to/b.yaml');
      
      cache.set('/path/to/a.yaml', workflow1);
      cache.set('/path/to/b.yaml', workflow2);
      
      const workflows = cache.getAllWorkflows();
      
      expect(workflows).toHaveLength(2);
      expect(workflows.map(w => w.definition.name)).toContain('Workflow A');
      expect(workflows.map(w => w.definition.name)).toContain('Workflow B');
    });
  });

  describe('expiration', () => {
    beforeEach(() => {
      cache = new WorkflowCache({ maxAge: 60000 }); // 1 minute
    });

    it('should expire old entries', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', workflow);
      expect(cache.has('/path/to/workflow.yaml')).toBe(true);
      
      // Advance time beyond maxAge
      vi.advanceTimersByTime(70000);
      
      expect(cache.has('/path/to/workflow.yaml')).toBe(false);
      expect(cache.get('/path/to/workflow.yaml')).toBeNull();
    });

    it('should not return expired entries in getAllWorkflows', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', workflow);
      expect(cache.getAllWorkflows()).toHaveLength(1);
      
      // Advance time beyond maxAge
      vi.advanceTimersByTime(70000);
      
      expect(cache.getAllWorkflows()).toHaveLength(0);
    });
  });

  describe('LRU eviction', () => {
    beforeEach(() => {
      cache = new WorkflowCache({ maxSize: 2 });
    });

    it('should evict least recently used entries when at capacity', () => {
      const workflow1 = createMockWorkflow('Workflow 1', '/path/to/workflow1.yaml');
      const workflow2 = createMockWorkflow('Workflow 2', '/path/to/workflow2.yaml');
      const workflow3 = createMockWorkflow('Workflow 3', '/path/to/workflow3.yaml');
      
      cache.set('/path/to/workflow1.yaml', workflow1);
      cache.set('/path/to/workflow2.yaml', workflow2);
      
      // Access workflow1 to make it more recently used
      cache.get('/path/to/workflow1.yaml');
      
      // Adding workflow3 should evict workflow2 (least recently used)
      cache.set('/path/to/workflow3.yaml', workflow3);
      
      expect(cache.has('/path/to/workflow1.yaml')).toBe(true);
      expect(cache.has('/path/to/workflow2.yaml')).toBe(false);
      expect(cache.has('/path/to/workflow3.yaml')).toBe(true);
    });
  });

  describe('refresh', () => {
    beforeEach(() => {
      cache = new WorkflowCache();
    });

    it('should update existing entry while preserving statistics', () => {
      const originalWorkflow = createMockWorkflow('Original', '/path/to/workflow.yaml');
      const updatedWorkflow = createMockWorkflow('Updated', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', originalWorkflow);
      
      // Access to increment statistics
      cache.get('/path/to/workflow.yaml');
      cache.get('/path/to/workflow.yaml');
      
      const statsBefore = cache.getStats();
      
      cache.refresh('/path/to/workflow.yaml', updatedWorkflow);
      
      const retrieved = cache.get('/path/to/workflow.yaml');
      const statsAfter = cache.getStats();
      
      expect(retrieved?.definition.name).toBe('Updated');
      expect(statsAfter.hitCount).toBeGreaterThan(statsBefore.hitCount);
    });

    it('should add new entry if not exists', () => {
      const workflow = createMockWorkflow('New Workflow', '/path/to/new.yaml');
      
      cache.refresh('/path/to/new.yaml', workflow);
      
      expect(cache.has('/path/to/new.yaml')).toBe(true);
      expect(cache.get('/path/to/new.yaml')).toEqual(workflow);
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      cache = new WorkflowCache({ maxAge: 60000 });
    });

    it('should remove expired entries during cleanup', () => {
      const workflow1 = createMockWorkflow('Workflow 1', '/path/to/workflow1.yaml');
      const workflow2 = createMockWorkflow('Workflow 2', '/path/to/workflow2.yaml');
      
      cache.set('/path/to/workflow1.yaml', workflow1);
      
      // Advance time
      vi.advanceTimersByTime(30000);
      
      cache.set('/path/to/workflow2.yaml', workflow2);
      
      // Advance time to expire workflow1 but not workflow2
      vi.advanceTimersByTime(40000);
      
      const removedCount = cache.cleanup();
      
      expect(removedCount).toBe(1);
      expect(cache.has('/path/to/workflow1.yaml')).toBe(false);
      expect(cache.has('/path/to/workflow2.yaml')).toBe(true);
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      cache = new WorkflowCache({ enableStats: true });
    });

    it('should track hit and miss statistics', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      // Miss
      cache.get('/nonexistent/workflow.yaml');
      
      // Set and hit
      cache.set('/path/to/workflow.yaml', workflow);
      cache.get('/path/to/workflow.yaml');
      cache.get('/path/to/workflow.yaml');
      
      const stats = cache.getStats();
      
      expect(stats.missCount).toBe(1);
      expect(stats.hitCount).toBe(2);
      expect(stats.hitRate).toBe(2/3);
      expect(stats.totalEntries).toBe(1);
    });

    it('should track eviction count', () => {
      cache = new WorkflowCache({ maxSize: 1, enableStats: true });
      
      const workflow1 = createMockWorkflow('Workflow 1', '/path/to/workflow1.yaml');
      const workflow2 = createMockWorkflow('Workflow 2', '/path/to/workflow2.yaml');
      
      cache.set('/path/to/workflow1.yaml', workflow1);
      cache.set('/path/to/workflow2.yaml', workflow2); // Should cause eviction
      
      const stats = cache.getStats();
      
      expect(stats.evictionCount).toBe(1);
    });

    it('should estimate memory usage', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', workflow);
      
      const stats = cache.getStats();
      
      expect(stats.totalMemoryUsage).toBeGreaterThan(0);
    });
  });

  describe('destroy', () => {
    it('should clear all data and stop cleanup timer', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      cache = new WorkflowCache({ cleanupInterval: 5000 });
      
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      cache.set('/path/to/workflow.yaml', workflow);
      
      expect(cache.getAllWorkflows()).toHaveLength(1);
      
      cache.destroy();
      
      expect(cache.getAllWorkflows()).toHaveLength(0);
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});