/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowStep } from './types.js';

export class DependencyResolver {
  /**
   * Resolve the execution order of workflow steps based on their dependencies
   * Uses topological sorting to ensure dependencies are executed before dependents
   */
  resolve(steps: WorkflowStep[]): WorkflowStep[] {
    // Build dependency graph
    const stepMap = new Map<string, WorkflowStep>();
    const inDegree = new Map<string, number>();
    const adjacencyList = new Map<string, string[]>();

    // Initialize data structures
    for (const step of steps) {
      stepMap.set(step.id, step);
      inDegree.set(step.id, 0);
      adjacencyList.set(step.id, []);
    }

    // Build the graph and calculate in-degrees
    for (const step of steps) {
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!stepMap.has(depId)) {
            throw new Error(`Step "${step.id}" depends on non-existent step: ${depId}`);
          }
          
          // Add edge from dependency to current step
          adjacencyList.get(depId)!.push(step.id);
          inDegree.set(step.id, inDegree.get(step.id)! + 1);
        }
      }
    }

    // Topological sort using Kahn's algorithm
    const result: WorkflowStep[] = [];
    const queue: string[] = [];

    // Find all steps with no dependencies (in-degree = 0)
    for (const [stepId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(stepId);
      }
    }

    while (queue.length > 0) {
      const currentStepId = queue.shift()!;
      const currentStep = stepMap.get(currentStepId)!;
      result.push(currentStep);

      // Process all dependents of the current step
      const dependents = adjacencyList.get(currentStepId)!;
      for (const dependentId of dependents) {
        inDegree.set(dependentId, inDegree.get(dependentId)! - 1);
        
        // If dependent has no more unresolved dependencies, add to queue
        if (inDegree.get(dependentId) === 0) {
          queue.push(dependentId);
        }
      }
    }

    // Check for circular dependencies
    if (result.length !== steps.length) {
      const remaining = steps.filter(step => !result.includes(step)).map(s => s.id);
      throw new Error(`Circular dependency detected among steps: ${remaining.join(', ')}`);
    }

    return result;
  }

  /**
   * Validate that the dependency graph is valid (no cycles, all dependencies exist)
   */
  validate(steps: WorkflowStep[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const stepIds = new Set(steps.map(s => s.id));

    // Check that all dependencies exist
    for (const step of steps) {
      if (step.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!stepIds.has(depId)) {
            errors.push(`Step "${step.id}" depends on non-existent step: ${depId}`);
          }
          if (depId === step.id) {
            errors.push(`Step "${step.id}" cannot depend on itself`);
          }
        }
      }
    }

    // Check for cycles by attempting to resolve
    try {
      this.resolve(steps);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Circular dependency')) {
        errors.push(error.message);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get all steps that depend on a given step (direct and indirect)
   */
  getDependents(steps: WorkflowStep[], targetStepId: string): string[] {
    const dependents = new Set<string>();
    const stepMap = new Map(steps.map(s => [s.id, s]));
    
    const findDependents = (stepId: string) => {
      for (const step of steps) {
        if (step.dependsOn?.includes(stepId) && !dependents.has(step.id)) {
          dependents.add(step.id);
          findDependents(step.id); // Recursively find indirect dependents
        }
      }
    };

    if (!stepMap.has(targetStepId)) {
      throw new Error(`Step not found: ${targetStepId}`);
    }

    findDependents(targetStepId);
    return Array.from(dependents);
  }

  /**
   * Get all dependencies of a given step (direct and indirect)
   */
  getDependencies(steps: WorkflowStep[], targetStepId: string): string[] {
    const dependencies = new Set<string>();
    const stepMap = new Map(steps.map(s => [s.id, s]));
    
    const findDependencies = (stepId: string) => {
      const step = stepMap.get(stepId);
      if (step?.dependsOn) {
        for (const depId of step.dependsOn) {
          if (!dependencies.has(depId)) {
            dependencies.add(depId);
            findDependencies(depId); // Recursively find indirect dependencies
          }
        }
      }
    };

    if (!stepMap.has(targetStepId)) {
      throw new Error(`Step not found: ${targetStepId}`);
    }

    findDependencies(targetStepId);
    return Array.from(dependencies);
  }

  /**
   * Check if one step depends on another (directly or indirectly)
   */
  dependsOn(steps: WorkflowStep[], stepId: string, dependencyId: string): boolean {
    const dependencies = this.getDependencies(steps, stepId);
    return dependencies.includes(dependencyId);
  }

  /**
   * Get steps that can be executed in parallel (no dependencies between them)
   */
  getParallelGroups(steps: WorkflowStep[]): WorkflowStep[][] {
    const resolved = this.resolve(steps);
    const groups: WorkflowStep[][] = [];
    const processed = new Set<string>();

    for (const step of resolved) {
      if (processed.has(step.id)) {
        continue;
      }

      // Find all steps that can run in parallel with this step
      const parallelGroup = [step];
      processed.add(step.id);

      for (const otherStep of resolved) {
        if (processed.has(otherStep.id)) {
          continue;
        }

        // Check if steps can run in parallel
        const canRunInParallel = 
          !this.dependsOn(steps, step.id, otherStep.id) &&
          !this.dependsOn(steps, otherStep.id, step.id) &&
          this.haveSameDependencyLevel(steps, step, otherStep);

        if (canRunInParallel) {
          parallelGroup.push(otherStep);
          processed.add(otherStep.id);
        }
      }

      groups.push(parallelGroup);
    }

    return groups;
  }

  /**
   * Get enhanced parallel groups with configuration and resource constraints
   */
  getEnhancedParallelGroups(steps: WorkflowStep[], defaultMaxConcurrency = 4): Array<{
    id: number;
    steps: WorkflowStep[];
    maxConcurrency: number;
    resource?: string;
  }> {
    const basicGroups = this.getParallelGroups(steps);
    
    return basicGroups.map((group, index) => {
      // Calculate max concurrency for the group
      let maxConcurrency = defaultMaxConcurrency;
      let resource: string | undefined;

      // If all steps in the group have parallel config, use the most restrictive
      const parallelConfigs = group
        .map(step => step.parallel)
        .filter(config => config?.enabled);

      if (parallelConfigs.length > 0) {
        // Use the minimum max concurrency if specified
        const maxConcurrencies = parallelConfigs
          .map(config => config!.maxConcurrency)
          .filter(max => max !== undefined) as number[];
        
        if (maxConcurrencies.length > 0) {
          maxConcurrency = Math.min(maxConcurrency, ...maxConcurrencies);
        }

        // Use common resource if all steps share the same resource
        const resources = parallelConfigs
          .map(config => config!.resource)
          .filter(res => res !== undefined);
        
        if (resources.length > 0 && resources.every(res => res === resources[0])) {
          resource = resources[0];
        }
      }

      // Limit concurrency to the number of steps in the group
      maxConcurrency = Math.min(maxConcurrency, group.length);

      return {
        id: index,
        steps: group,
        maxConcurrency,
        resource
      };
    });
  }

  /**
   * Check if two steps have the same dependency level (depth in dependency graph)
   */
  private haveSameDependencyLevel(steps: WorkflowStep[], step1: WorkflowStep, step2: WorkflowStep): boolean {
    const getLevel = (step: WorkflowStep): number => {
      if (!step.dependsOn || step.dependsOn.length === 0) {
        return 0;
      }
      
      const stepMap = new Map(steps.map(s => [s.id, s]));
      const maxDepLevel = Math.max(...step.dependsOn.map(depId => {
        const depStep = stepMap.get(depId);
        return depStep ? getLevel(depStep) + 1 : 0;
      }));
      
      return maxDepLevel;
    };

    return getLevel(step1) === getLevel(step2);
  }
}