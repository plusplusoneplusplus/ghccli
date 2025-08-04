/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  WorkflowVisualizer, 
  createWorkflowVisualization, 
  generateAllVisualizations,
  type VisualizationOptions,
  type VisualizationGraph 
} from './WorkflowVisualizer.js';
import { WorkflowDefinition, WorkflowStep } from '../types.js';
import { WorkflowExecutionReport } from '../WorkflowStatusReporter.js';
import { WorkflowExecutionMetrics } from '../metrics.js';
import { WorkflowStatus } from '../WorkflowRunner.js';

describe('WorkflowVisualizer', () => {
  let sampleWorkflow: WorkflowDefinition;
  let sampleSteps: WorkflowStep[];

  beforeEach(() => {
    sampleSteps = [
      {
        id: 'step1',
        name: 'First Step',
        type: 'script',
        config: { command: 'echo "hello"' }
      },
      {
        id: 'step2',
        name: 'Second Step',
        type: 'agent',
        config: { agent: 'test-agent' },
        dependsOn: ['step1']
      },
      {
        id: 'step3',
        name: 'Parallel Step A',
        type: 'script',
        config: { command: 'echo "parallel A"' },
        dependsOn: ['step2'],
        parallel: { enabled: true }
      },
      {
        id: 'step4',
        name: 'Parallel Step B',
        type: 'script',
        config: { command: 'echo "parallel B"' },
        dependsOn: ['step2'],
        parallel: { enabled: true }
      }
    ];

    sampleWorkflow = {
      name: 'Test Workflow',
      version: '1.0.0',
      description: 'A test workflow for visualization',
      steps: sampleSteps
    };
  });

  describe('generateGraph', () => {
    it('should generate a basic graph from workflow definition', () => {
      const graph = WorkflowVisualizer.generateGraph(sampleWorkflow);

      expect(graph.nodes).toHaveLength(4);
      expect(graph.edges.length).toBeGreaterThanOrEqual(3); // At least dependency edges: step1->step2, step2->step3, step2->step4
      expect(graph.metadata.workflowName).toBe('Test Workflow');
      expect(graph.metadata.totalSteps).toBe(4);
    });

    it('should include step status when execution report is provided', () => {
      const executionReport: WorkflowExecutionReport = {
        workflowId: 'test-workflow-1',
        workflowName: 'Test Workflow',
        status: WorkflowStatus.COMPLETED,
        startTime: new Date('2023-01-01T10:00:00Z'),
        endTime: new Date('2023-01-01T10:05:00Z'),
        duration: 300000,
        totalSteps: 4,
        completedSteps: 3,
        failedSteps: 1,
        skippedSteps: 0,
        stepStatuses: [
          { stepId: 'step1', stepName: 'First Step', status: 'completed', duration: 1000 },
          { stepId: 'step2', stepName: 'Second Step', status: 'completed', duration: 2000 },
          { stepId: 'step3', stepName: 'Parallel Step A', status: 'failed', error: 'Test error', duration: 1500 },
          { stepId: 'step4', stepName: 'Parallel Step B', status: 'completed', duration: 800 }
        ],
        logs: []
      };

      const graph = WorkflowVisualizer.generateGraph(sampleWorkflow, executionReport);

      expect(graph.nodes[0].status).toBe('completed');
      expect(graph.nodes[0].duration).toBe(1000);
      expect(graph.nodes[2].status).toBe('failed');
      expect(graph.nodes[2].error).toBe('Test error');
    });

    it('should include metrics when provided', () => {
      const metrics: Partial<WorkflowExecutionMetrics> = {
        workflowId: 'test-workflow-1',
        workflowName: 'Test Workflow',
        version: '1.0.0',
        startTime: Date.now(),
        totalDuration: 300000,
        stepMetrics: new Map([
          ['step1', { 
            stepId: 'step1', 
            stepName: 'First Step', 
            stepType: 'script',
            startTime: Date.now(),
            success: true,
            retryCount: 0,
            duration: 1000,
            parallelGroup: 1
          }]
        ]),
        parallelGroups: 2,
        maxConcurrentSteps: 2,
        totalSteps: 4,
        completedSteps: 3,
        failedSteps: 1,
        skippedSteps: 0,
        retriedSteps: 0,
        resourceUtilization: {},
        memoryPeak: 100000000,
        averageCpuUsage: 25.5,
        overallSuccess: false,
        errorCount: 1,
        warningCount: 0
      };

      const graph = WorkflowVisualizer.generateGraph(sampleWorkflow, undefined, metrics as WorkflowExecutionMetrics);

      expect(graph.metadata.parallelGroups).toBe(2);
      expect(graph.metadata.actualDuration).toBe(300000);
      expect(graph.nodes[0].parallelGroup).toBe(1);
    });
  });

  describe('visualize', () => {
    it('should generate mermaid diagram', () => {
      const options: VisualizationOptions = {
        format: 'mermaid',
        includeStatus: false,
        layout: 'horizontal'
      };

      const result = WorkflowVisualizer.visualize(sampleWorkflow, options);

      expect(result).toContain('graph LR');
      expect(result).toContain('step1');
      expect(result).toContain('step2');
      expect(result).toContain('First Step');
      expect(result).toContain('Second Step');
      expect(result).toContain('step1 --> step2');
    });

    it('should generate mermaid diagram with status styling', () => {
      const executionReport: WorkflowExecutionReport = {
        workflowId: 'test-workflow-1',
        workflowName: 'Test Workflow',
        status: WorkflowStatus.COMPLETED,
        startTime: new Date(),
        totalSteps: 4,
        completedSteps: 3,
        failedSteps: 1,
        skippedSteps: 0,
        stepStatuses: [
          { stepId: 'step1', stepName: 'First Step', status: 'completed' },
          { stepId: 'step2', stepName: 'Second Step', status: 'failed', error: 'Test error' }
        ],
        logs: []
      };

      const options: VisualizationOptions = {
        format: 'mermaid',
        includeStatus: true,
        layout: 'horizontal'
      };

      const result = WorkflowVisualizer.visualize(sampleWorkflow, options, executionReport);

      expect(result).toContain('class step1 completed');
      expect(result).toContain('class step2 failed');
      expect(result).toContain('classDef completed fill:#bfb');
      expect(result).toContain('classDef failed fill:#fbb');
    });

    it('should generate graphviz diagram', () => {
      const options: VisualizationOptions = {
        format: 'graphviz',
        includeStatus: false,
        layout: 'vertical'
      };

      const result = WorkflowVisualizer.visualize(sampleWorkflow, options);

      expect(result).toContain('digraph workflow {');
      expect(result).toContain('rankdir=TB');
      expect(result).toContain('step1 [label="First Step"]');
      expect(result).toContain('step2 [label="Second Step"]');
      expect(result).toContain('step1 -> step2');
      expect(result).toContain('}');
    });

    it('should generate ASCII diagram', () => {
      const options: VisualizationOptions = {
        format: 'ascii',
        includeTimings: true
      };

      const executionReport: WorkflowExecutionReport = {
        workflowId: 'test-workflow-1',
        workflowName: 'Test Workflow',
        status: WorkflowStatus.COMPLETED,
        startTime: new Date(),
        duration: 5000,
        totalSteps: 4,
        completedSteps: 4,
        failedSteps: 0,
        skippedSteps: 0,
        stepStatuses: [
          { stepId: 'step1', stepName: 'First Step', status: 'completed', duration: 1000 }
        ],
        logs: []
      };

      const result = WorkflowVisualizer.visualize(sampleWorkflow, options, executionReport);

      expect(result).toContain('Workflow: Test Workflow');
      expect(result).toContain('Steps: 4');
      expect(result).toContain('Duration: 5s');
      expect(result).toContain('✅ First Step [script] (1s)');
    });

    it('should generate JSON format', () => {
      const options: VisualizationOptions = {
        format: 'json'
      };

      const result = WorkflowVisualizer.visualize(sampleWorkflow, options);
      const parsed = JSON.parse(result);

      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('edges');
      expect(parsed).toHaveProperty('metadata');
      expect(parsed.metadata.workflowName).toBe('Test Workflow');
      expect(parsed.nodes).toHaveLength(4);
    });

    it('should throw error for unsupported format', () => {
      const options = {
        format: 'unsupported' as any
      };

      expect(() => {
        WorkflowVisualizer.visualize(sampleWorkflow, options);
      }).toThrow('Unsupported visualization format: unsupported');
    });
  });

  describe('factory functions', () => {
    it('should create workflow visualization using factory function', () => {
      const options: VisualizationOptions = {
        format: 'mermaid',
        includeStatus: true
      };

      const result = createWorkflowVisualization(sampleWorkflow, options);

      expect(result).toContain('graph LR');
      expect(result).toContain('step1');
    });

    it('should generate all visualization formats', () => {
      const result = generateAllVisualizations(sampleWorkflow);

      expect(result).toHaveProperty('mermaid');
      expect(result).toHaveProperty('graphviz');
      expect(result).toHaveProperty('ascii');
      expect(result).toHaveProperty('json');

      expect(result.mermaid).toContain('graph LR');
      expect(result.graphviz).toContain('digraph workflow');
      expect(result.ascii).toContain('Workflow: Test Workflow');
      
      const jsonResult = JSON.parse(result.json);
      expect(jsonResult).toHaveProperty('nodes');
    });
  });

  describe('edge cases', () => {
    it('should handle workflow with no dependencies', () => {
      const simpleWorkflow: WorkflowDefinition = {
        name: 'Simple Workflow',
        version: '1.0.0',
        steps: [
          { id: 'only-step', name: 'Only Step', type: 'script', config: { command: 'echo "test"' } }
        ]
      };

      const graph = WorkflowVisualizer.generateGraph(simpleWorkflow);

      expect(graph.nodes).toHaveLength(1);
      expect(graph.edges).toHaveLength(0);
    });

    it('should handle empty workflow', () => {
      const emptyWorkflow: WorkflowDefinition = {
        name: 'Empty Workflow',
        version: '1.0.0',
        steps: []
      };

      const graph = WorkflowVisualizer.generateGraph(emptyWorkflow);

      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
      expect(graph.metadata.totalSteps).toBe(0);
    });

    it('should handle circular dependencies gracefully', () => {
      const circularWorkflow: WorkflowDefinition = {
        name: 'Circular Workflow',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', type: 'script', config: { command: 'echo "1"' }, dependsOn: ['step2'] },
          { id: 'step2', name: 'Step 2', type: 'script', config: { command: 'echo "2"' }, dependsOn: ['step1'] }
        ]
      };

      // Should not throw an error
      expect(() => {
        WorkflowVisualizer.generateGraph(circularWorkflow);
      }).not.toThrow();
    });

    it('should handle missing step dependencies', () => {
      const workflowWithMissingDep: WorkflowDefinition = {
        name: 'Missing Dependency Workflow',
        version: '1.0.0',
        steps: [
          { id: 'step1', name: 'Step 1', type: 'script', config: { command: 'echo "1"' }, dependsOn: ['nonexistent'] }
        ]
      };

      const graph = WorkflowVisualizer.generateGraph(workflowWithMissingDep);

      expect(graph.nodes).toHaveLength(1);
      // Should still create edge even if dependency doesn't exist
      expect(graph.edges.some(e => e.from === 'nonexistent')).toBe(true);
    });
  });

  describe('layout calculation', () => {
    it('should assign positions to nodes', () => {
      const graph = WorkflowVisualizer.generateGraph(sampleWorkflow);

      // All nodes should have x and y coordinates
      graph.nodes.forEach(node => {
        expect(typeof node.x).toBe('number');
        expect(typeof node.y).toBe('number');
      });
    });

    it('should place dependent nodes after their dependencies', () => {
      const graph = WorkflowVisualizer.generateGraph(sampleWorkflow);

      const step1 = graph.nodes.find(n => n.id === 'step1');
      const step2 = graph.nodes.find(n => n.id === 'step2');

      expect(step1).toBeDefined();
      expect(step2).toBeDefined();
      expect(step2!.x!).toBeGreaterThan(step1!.x!);
    });
  });

  describe('duration estimation', () => {
    it('should estimate workflow duration for different step types', () => {
      const workflowWithMixedSteps: WorkflowDefinition = {
        name: 'Mixed Steps Workflow',
        version: '1.0.0',
        steps: [
          { id: 'script-step', name: 'Script Step', type: 'script', config: { command: 'echo "test"' } },
          { id: 'agent-step', name: 'Agent Step', type: 'agent', config: { agent: 'test' } },
          { id: 'condition-step', name: 'Condition Step', type: 'condition', config: { expression: { type: 'equals', left: 'a', right: 'b' } } },
          { id: 'custom-step', name: 'Custom Step', type: 'custom', config: { command: 'echo custom' } }
        ]
      };

      const graph = WorkflowVisualizer.generateGraph(workflowWithMixedSteps);

      expect(graph.metadata.estimatedDuration).toBeGreaterThan(0);
      expect(typeof graph.metadata.estimatedDuration).toBe('number');
    });
  });

  describe('error handling in visualization generation', () => {
    it('should handle errors in format generation gracefully', () => {
      const result = generateAllVisualizations(sampleWorkflow);

      // All formats should be present, even if some fail
      expect(result).toHaveProperty('mermaid');
      expect(result).toHaveProperty('graphviz');
      expect(result).toHaveProperty('ascii');
      expect(result).toHaveProperty('json');
    });
  });
});