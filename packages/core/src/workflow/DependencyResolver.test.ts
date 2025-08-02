/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyResolver } from './DependencyResolver.js';
import { WorkflowStep } from './types.js';

describe('DependencyResolver', () => {
  let resolver: DependencyResolver;

  beforeEach(() => {
    resolver = new DependencyResolver();
  });

  describe('resolve', () => {
    it('should resolve steps with no dependencies', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' }
        }
      ];

      const resolved = resolver.resolve(steps);
      
      expect(resolved).toHaveLength(2);
      expect(resolved.map(s => s.id)).toEqual(['step1', 'step2']);
    });

    it('should resolve simple linear dependencies', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        },
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        }
      ];

      const resolved = resolver.resolve(steps);
      
      expect(resolved).toHaveLength(2);
      expect(resolved[0].id).toBe('step1');
      expect(resolved[1].id).toBe('step2');
    });

    it('should resolve complex dependency graph', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step4',
          name: 'Step 4',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step2', 'step3']
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        },
        {
          id: 'step3',
          name: 'Step 3',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        },
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        }
      ];

      const resolved = resolver.resolve(steps);
      
      expect(resolved).toHaveLength(4);
      expect(resolved[0].id).toBe('step1');
      expect(['step2', 'step3']).toContain(resolved[1].id);
      expect(['step2', 'step3']).toContain(resolved[2].id);
      expect(resolved[3].id).toBe('step4');
    });

    it('should throw error for circular dependencies', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step2']
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        }
      ];

      expect(() => {
        resolver.resolve(steps);
      }).toThrow('Circular dependency detected');
    });

    it('should throw error for non-existent dependencies', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['nonexistent']
        }
      ];

      expect(() => {
        resolver.resolve(steps);
      }).toThrow('depends on non-existent step: nonexistent');
    });
  });

  describe('validate', () => {
    it('should validate valid dependency graph', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        }
      ];

      const result = resolver.validate(steps);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect self-dependency', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        }
      ];

      const result = resolver.validate(steps);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Step "step1" cannot depend on itself');
    });

    it('should detect non-existent dependencies', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['missing']
        }
      ];

      const result = resolver.validate(steps);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Step "step1" depends on non-existent step: missing');
    });
  });

  describe('getDependents', () => {
    it('should find direct dependents', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        }
      ];

      const dependents = resolver.getDependents(steps, 'step1');
      
      expect(dependents).toEqual(['step2']);
    });

    it('should find indirect dependents', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        },
        {
          id: 'step3',
          name: 'Step 3',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step2']
        }
      ];

      const dependents = resolver.getDependents(steps, 'step1');
      
      expect(dependents).toContain('step2');
      expect(dependents).toContain('step3');
      expect(dependents).toHaveLength(2);
    });
  });

  describe('getDependencies', () => {
    it('should find direct dependencies', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        }
      ];

      const dependencies = resolver.getDependencies(steps, 'step2');
      
      expect(dependencies).toEqual(['step1']);
    });

    it('should find indirect dependencies', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        },
        {
          id: 'step3',
          name: 'Step 3',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step2']
        }
      ];

      const dependencies = resolver.getDependencies(steps, 'step3');
      
      expect(dependencies).toContain('step1');
      expect(dependencies).toContain('step2');
      expect(dependencies).toHaveLength(2);
    });
  });

  describe('getParallelGroups', () => {
    it('should group independent steps for parallel execution', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step3',
          name: 'Step 3',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1', 'step2']
        }
      ];

      const groups = resolver.getParallelGroups(steps);
      
      expect(groups).toHaveLength(2);
      expect(groups[0]).toHaveLength(2); // step1 and step2 can run in parallel
      expect(groups[1]).toHaveLength(1); // step3 runs after
      expect(groups[1][0].id).toBe('step3');
    });
  });

  describe('getEnhancedParallelGroups', () => {
    it('should create enhanced parallel groups with default configuration', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step3',
          name: 'Step 3',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        }
      ];

      const enhancedGroups = resolver.getEnhancedParallelGroups(steps, 4);
      
      expect(enhancedGroups).toHaveLength(2);
      
      // First group: step1 and step2 (independent)
      expect(enhancedGroups[0].id).toBe(0);
      expect(enhancedGroups[0].steps).toHaveLength(2);
      expect(enhancedGroups[0].maxConcurrency).toBe(2); // Limited by number of steps
      expect(enhancedGroups[0].resource).toBeUndefined();
      
      // Second group: step3 (depends on step1)
      expect(enhancedGroups[1].id).toBe(1);
      expect(enhancedGroups[1].steps).toHaveLength(1);
      expect(enhancedGroups[1].steps[0].id).toBe('step3');
      expect(enhancedGroups[1].maxConcurrency).toBe(1);
    });

    it('should respect parallel configuration from steps', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' },
          parallel: {
            enabled: true,
            maxConcurrency: 2,
            resource: 'cpu'
          }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          parallel: {
            enabled: true,
            maxConcurrency: 2,
            resource: 'cpu'
          }
        },
        {
          id: 'step3',
          name: 'Step 3',
          type: 'script',
          config: { command: 'echo' },
          parallel: {
            enabled: true,
            maxConcurrency: 3,
            resource: 'cpu'
          }
        }
      ];

      const enhancedGroups = resolver.getEnhancedParallelGroups(steps, 10);
      
      expect(enhancedGroups).toHaveLength(1);
      expect(enhancedGroups[0].maxConcurrency).toBe(2); // Most restrictive
      expect(enhancedGroups[0].resource).toBe('cpu'); // Common resource
    });

    it('should handle mixed resource configurations', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' },
          parallel: {
            enabled: true,
            resource: 'cpu'
          }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          parallel: {
            enabled: true,
            resource: 'memory'
          }
        }
      ];

      const enhancedGroups = resolver.getEnhancedParallelGroups(steps, 5);
      
      expect(enhancedGroups).toHaveLength(1);
      expect(enhancedGroups[0].resource).toBeUndefined(); // No common resource
    });

    it('should limit concurrency to step count', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' }
        }
      ];

      const enhancedGroups = resolver.getEnhancedParallelGroups(steps, 10);
      
      expect(enhancedGroups).toHaveLength(1);
      expect(enhancedGroups[0].maxConcurrency).toBe(2); // Limited by step count, not default
    });

    it('should handle complex dependency with parallel configuration', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'root1',
          name: 'Root 1',
          type: 'script',
          config: { command: 'echo' },
          parallel: { enabled: true, maxConcurrency: 1 }
        },
        {
          id: 'root2',
          name: 'Root 2',
          type: 'script',
          config: { command: 'echo' },
          parallel: { enabled: true, maxConcurrency: 1 }
        },
        {
          id: 'middle1',
          name: 'Middle 1',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['root1'],
          parallel: { enabled: true, maxConcurrency: 2 }
        },
        {
          id: 'middle2',
          name: 'Middle 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['root2'],
          parallel: { enabled: true, maxConcurrency: 2 }
        },
        {
          id: 'final',
          name: 'Final',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['middle1', 'middle2'],
          parallel: { enabled: true }
        }
      ];

      const enhancedGroups = resolver.getEnhancedParallelGroups(steps, 4);
      
      expect(enhancedGroups).toHaveLength(3);
      
      // First group: root1, root2
      expect(enhancedGroups[0].steps).toHaveLength(2);
      expect(enhancedGroups[0].maxConcurrency).toBe(1); // Most restrictive
      
      // Second group: middle1, middle2
      expect(enhancedGroups[1].steps).toHaveLength(2);
      expect(enhancedGroups[1].maxConcurrency).toBe(2);
      
      // Third group: final
      expect(enhancedGroups[2].steps).toHaveLength(1);
      expect(enhancedGroups[2].maxConcurrency).toBe(1);
    });

    it('should assign unique group IDs', () => {
      const steps: WorkflowStep[] = [
        {
          id: 'step1',
          name: 'Step 1',
          type: 'script',
          config: { command: 'echo' }
        },
        {
          id: 'step2',
          name: 'Step 2',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step1']
        },
        {
          id: 'step3',
          name: 'Step 3',
          type: 'script',
          config: { command: 'echo' },
          dependsOn: ['step2']
        }
      ];

      const enhancedGroups = resolver.getEnhancedParallelGroups(steps);
      
      expect(enhancedGroups).toHaveLength(3);
      expect(enhancedGroups[0].id).toBe(0);
      expect(enhancedGroups[1].id).toBe(1);
      expect(enhancedGroups[2].id).toBe(2);
    });
  });
});