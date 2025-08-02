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
});