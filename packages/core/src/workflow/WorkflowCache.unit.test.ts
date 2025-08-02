/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowCache } from './WorkflowCache.js';
import { LoadedWorkflow } from './WorkflowLoader.js';

describe('WorkflowCache Unit Tests', () => {
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
    cache = new WorkflowCache();
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('should store and retrieve workflows', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', workflow);
      const retrieved = cache.get('/path/to/workflow.yaml');
      
      expect(retrieved).toEqual(workflow);
    });

    it('should support name-based lookups', () => {
      const workflow = createMockWorkflow('Named Workflow', '/path/to/named.yaml');
      
      cache.set('/path/to/named.yaml', workflow);
      const retrieved = cache.getByName('Named Workflow');
      
      expect(retrieved).toEqual(workflow);
    });

    it('should delete workflows', () => {
      const workflow = createMockWorkflow('Test Workflow', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', workflow);
      expect(cache.has('/path/to/workflow.yaml')).toBe(true);
      
      cache.delete('/path/to/workflow.yaml');
      expect(cache.has('/path/to/workflow.yaml')).toBe(false);
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

  describe('LRU eviction', () => {
    beforeEach(() => {
      cache = new WorkflowCache({ maxSize: 2 });
    });

    it('should evict least recently used entries when at capacity', () => {
      const workflow1 = createMockWorkflow('Workflow 1', '/path/to/workflow1.yaml');
      const workflow2 = createMockWorkflow('Workflow 2', '/path/to/workflow2.yaml');
      const workflow3 = createMockWorkflow('Workflow 3', '/path/to/workflow3.yaml');
      
      // Add first two workflows
      cache.set('/path/to/workflow1.yaml', workflow1);
      vi.advanceTimersByTime(1); // Ensure different timestamps
      cache.set('/path/to/workflow2.yaml', workflow2);
      
      // Access workflow1 to make it more recently used
      vi.advanceTimersByTime(1);
      cache.get('/path/to/workflow1.yaml');
      
      // Adding workflow3 should evict workflow2 (least recently used)
      vi.advanceTimersByTime(1);
      cache.set('/path/to/workflow3.yaml', workflow3);
      
      expect(cache.has('/path/to/workflow1.yaml')).toBe(true);
      expect(cache.has('/path/to/workflow2.yaml')).toBe(false);
      expect(cache.has('/path/to/workflow3.yaml')).toBe(true);
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
  });

  describe('statistics', () => {
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
      cache = new WorkflowCache({ maxSize: 1 });
      
      const workflow1 = createMockWorkflow('Workflow 1', '/path/to/workflow1.yaml');
      const workflow2 = createMockWorkflow('Workflow 2', '/path/to/workflow2.yaml');
      
      cache.set('/path/to/workflow1.yaml', workflow1);
      cache.set('/path/to/workflow2.yaml', workflow2); // Should cause eviction
      
      const stats = cache.getStats();
      
      expect(stats.evictionCount).toBe(1);
    });
  });

  describe('refresh', () => {
    it('should update existing entry', () => {
      const originalWorkflow = createMockWorkflow('Original', '/path/to/workflow.yaml');
      const updatedWorkflow = createMockWorkflow('Updated', '/path/to/workflow.yaml');
      
      cache.set('/path/to/workflow.yaml', originalWorkflow);
      cache.refresh('/path/to/workflow.yaml', updatedWorkflow);
      
      const retrieved = cache.get('/path/to/workflow.yaml');
      expect(retrieved?.definition.name).toBe('Updated');
    });

    it('should add new entry if not exists', () => {
      const workflow = createMockWorkflow('New Workflow', '/path/to/new.yaml');
      
      cache.refresh('/path/to/new.yaml', workflow);
      
      expect(cache.has('/path/to/new.yaml')).toBe(true);
      expect(cache.get('/path/to/new.yaml')).toEqual(workflow);
    });
  });
});