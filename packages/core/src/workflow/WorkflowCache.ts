/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { LoadedWorkflow } from './WorkflowLoader.js';
import { WorkflowDefinition } from './types.js';

export interface CacheEntry {
  workflow: LoadedWorkflow;
  accessCount: number;
  lastAccessed: Date;
  createdAt: Date;
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  evictionCount: number;
  totalMemoryUsage: number;
}

export interface WorkflowCacheOptions {
  maxSize?: number;
  maxAge?: number;
  cleanupInterval?: number;
  enableStats?: boolean;
}

export class WorkflowCache {
  private readonly maxSize: number;
  private readonly maxAge: number;
  private readonly enableStats: boolean;
  
  private cache: Map<string, CacheEntry> = new Map();
  private nameToPathIndex: Map<string, string> = new Map();
  private cleanupTimer?: NodeJS.Timeout;
  
  private stats = {
    hitCount: 0,
    missCount: 0,
    evictionCount: 0
  };

  constructor(options: WorkflowCacheOptions = {}) {
    this.maxSize = options.maxSize || 100;
    this.maxAge = options.maxAge || 30 * 60 * 1000; // 30 minutes
    this.enableStats = options.enableStats ?? true;
    
    if (options.cleanupInterval !== undefined && options.cleanupInterval > 0) {
      this.startPeriodicCleanup(options.cleanupInterval);
    }
  }

  get(key: string): LoadedWorkflow | null {
    // Try direct file path lookup first
    let entry = this.cache.get(key);
    
    // If not found and key doesn't look like a path, try name lookup
    if (!entry && !this.isFilePath(key)) {
      const filePath = this.nameToPathIndex.get(key);
      if (filePath) {
        entry = this.cache.get(filePath);
      }
    }

    if (!entry) {
      if (this.enableStats) this.stats.missCount++;
      return null;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.delete(key);
      if (this.enableStats) this.stats.missCount++;
      return null;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = new Date();
    
    if (this.enableStats) this.stats.hitCount++;
    
    return entry.workflow;
  }

  set(key: string, workflow: LoadedWorkflow): void {
    // If at capacity, evict least recently used entry
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry = {
      workflow,
      accessCount: 0,
      lastAccessed: new Date(),
      createdAt: new Date()
    };

    this.cache.set(key, entry);
    
    // Update name index for quick name-based lookups
    this.nameToPathIndex.set(workflow.definition.name, key);
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Remove from name index
    this.nameToPathIndex.delete(entry.workflow.definition.name);
    
    return this.cache.delete(key);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      // Check name index
      if (!this.isFilePath(key)) {
        const filePath = this.nameToPathIndex.get(key);
        return filePath ? this.cache.has(filePath) : false;
      }
      return false;
    }
    
    return !this.isExpired(entry);
  }

  clear(): void {
    this.cache.clear();
    this.nameToPathIndex.clear();
    
    if (this.enableStats) {
      this.stats.hitCount = 0;
      this.stats.missCount = 0;
      this.stats.evictionCount = 0;
    }
  }

  getByName(workflowName: string): LoadedWorkflow | null {
    return this.get(workflowName);
  }

  getAllWorkflows(): LoadedWorkflow[] {
    const workflows: LoadedWorkflow[] = [];
    
    for (const entry of this.cache.values()) {
      if (!this.isExpired(entry)) {
        workflows.push(entry.workflow);
      }
    }
    
    return workflows;
  }

  getWorkflowNames(): string[] {
    return Array.from(this.nameToPathIndex.keys());
  }

  refresh(key: string, workflow: LoadedWorkflow): void {
    const entry = this.cache.get(key);
    if (entry) {
      // Update the workflow but preserve access statistics
      entry.workflow = workflow;
      entry.lastAccessed = new Date();
      
      // Update name index in case the name changed
      this.nameToPathIndex.set(workflow.definition.name, key);
    } else {
      this.set(key, workflow);
    }
  }

  cleanup(): number {
    let removedCount = 0;
    const now = new Date();
    
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry, now)) {
        this.delete(key);
        removedCount++;
      }
    }
    
    return removedCount;
  }

  getStats(): CacheStats {
    const totalRequests = this.stats.hitCount + this.stats.missCount;
    const hitRate = totalRequests > 0 ? this.stats.hitCount / totalRequests : 0;
    
    return {
      totalEntries: this.cache.size,
      hitCount: this.stats.hitCount,
      missCount: this.stats.missCount,
      hitRate,
      evictionCount: this.stats.evictionCount,
      totalMemoryUsage: this.estimateMemoryUsage()
    };
  }

  private isExpired(entry: CacheEntry, now: Date = new Date()): boolean {
    return now.getTime() - entry.createdAt.getTime() > this.maxAge;
  }

  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruTime: Date | null = null;
    
    for (const [key, entry] of this.cache.entries()) {
      if (!lruTime || entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }
    
    if (lruKey) {
      this.delete(lruKey);
      if (this.enableStats) this.stats.evictionCount++;
    }
  }

  private isFilePath(key: string): boolean {
    return key.includes('/') || key.includes('\\') || key.includes('.');
  }

  private estimateMemoryUsage(): number {
    let totalSize = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      // Rough estimation of memory usage
      totalSize += key.length * 2; // String characters (UTF-16)
      totalSize += JSON.stringify(entry.workflow.definition).length * 2;
      totalSize += entry.workflow.filePath.length * 2;
      totalSize += 200; // Overhead for objects, dates, etc.
    }
    
    return totalSize;
  }

  private startPeriodicCleanup(intervalMs: number): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }
}