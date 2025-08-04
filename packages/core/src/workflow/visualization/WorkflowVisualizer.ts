/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowDefinition, WorkflowStep, StepResult } from '../types.js';
import { WorkflowExecutionMetrics, StepMetrics } from '../metrics.js';
import { StepStatus, WorkflowExecutionReport } from '../WorkflowStatusReporter.js';

export interface VisualizationNode {
  id: string;
  name: string;
  type: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  x?: number;
  y?: number;
  duration?: number;
  error?: string;
  parallel?: boolean;
  parallelGroup?: number;
}

export interface VisualizationEdge {
  from: string;
  to: string;
  type: 'dependency' | 'flow';
  condition?: string;
}

export interface VisualizationGraph {
  nodes: VisualizationNode[];
  edges: VisualizationEdge[];
  metadata: {
    workflowName: string;
    totalSteps: number;
    parallelGroups: number;
    estimatedDuration?: number;
    actualDuration?: number;
  };
}

export type VisualizationFormat = 'mermaid' | 'graphviz' | 'json' | 'ascii';

export interface VisualizationOptions {
  format: VisualizationFormat;
  includeMetrics?: boolean;
  includeStatus?: boolean;
  includeTimings?: boolean;
  includeErrors?: boolean;
  layout?: 'horizontal' | 'vertical' | 'radial';
  theme?: 'light' | 'dark' | 'minimal';
}

/**
 * Creates visual representations of workflow definitions and execution
 */
export class WorkflowVisualizer {
  /**
   * Generate visualization graph from workflow definition
   */
  static generateGraph(
    workflow: WorkflowDefinition,
    executionReport?: WorkflowExecutionReport,
    metrics?: WorkflowExecutionMetrics
  ): VisualizationGraph {
    const nodes: VisualizationNode[] = [];
    const edges: VisualizationEdge[] = [];

    // Create nodes for each step
    for (const step of workflow.steps) {
      const stepStatus = executionReport?.stepStatuses.find(s => s.stepId === step.id);
      const stepMetrics = metrics?.stepMetrics.get(step.id);

      const node: VisualizationNode = {
        id: step.id,
        name: step.name,
        type: step.type,
        status: stepStatus?.status,
        duration: stepStatus?.duration || stepMetrics?.duration,
        error: stepStatus?.error || stepMetrics?.error?.message,
        parallel: step.parallel?.enabled,
        parallelGroup: stepMetrics?.parallelGroup
      };

      nodes.push(node);
    }

    // Create edges for dependencies
    for (const step of workflow.steps) {
      if (step.dependsOn) {
        for (const dependency of step.dependsOn) {
          edges.push({
            from: dependency,
            to: step.id,
            type: 'dependency'
          });
        }
      }

      // Create flow edges for steps without explicit dependencies
      if (!step.dependsOn || step.dependsOn.length === 0) {
        const previousStep = workflow.steps[workflow.steps.indexOf(step) - 1];
        if (previousStep && !previousStep.parallel?.enabled) {
          edges.push({
            from: previousStep.id,
            to: step.id,
            type: 'flow'
          });
        }
      }

      // Add conditional edges
      if (step.condition) {
        edges.push({
          from: step.id,
          to: step.id + '_condition',
          type: 'flow',
          condition: step.condition
        });
      }
    }

    // Calculate layout positions
    this.calculateLayout(nodes, edges);

    return {
      nodes,
      edges,
      metadata: {
        workflowName: workflow.name,
        totalSteps: workflow.steps.length,
        parallelGroups: metrics?.parallelGroups || 0,
        estimatedDuration: this.estimateWorkflowDuration(workflow),
        actualDuration: executionReport?.duration || metrics?.totalDuration
      }
    };
  }

  /**
   * Generate visualization in specified format
   */
  static visualize(
    workflow: WorkflowDefinition,
    options: VisualizationOptions,
    executionReport?: WorkflowExecutionReport,
    metrics?: WorkflowExecutionMetrics
  ): string {
    const graph = this.generateGraph(workflow, executionReport, metrics);

    switch (options.format) {
      case 'mermaid':
        return this.generateMermaidDiagram(graph, options);
      case 'graphviz':
        return this.generateGraphvizDiagram(graph, options);
      case 'ascii':
        return this.generateAsciiDiagram(graph, options);
      case 'json':
        return JSON.stringify(graph, null, 2);
      default:
        throw new Error(`Unsupported visualization format: ${options.format}`);
    }
  }

  /**
   * Generate Mermaid diagram
   */
  private static generateMermaidDiagram(
    graph: VisualizationGraph,
    options: VisualizationOptions
  ): string {
    const direction = options.layout === 'vertical' ? 'TD' : 'LR';
    const lines: string[] = [`graph ${direction}`];

    // Add nodes
    for (const node of graph.nodes) {
      const nodeStyle = this.getMermaidNodeStyle(node, options);
      const nodeLabel = this.formatNodeLabel(node, options);
      lines.push(`    ${node.id}${nodeStyle}["${nodeLabel}"]`);

      // Add styling for status
      if (options.includeStatus && node.status) {
        const statusClass = this.getMermaidStatusClass(node.status);
        lines.push(`    class ${node.id} ${statusClass}`);
      }
    }

    // Add edges
    for (const edge of graph.edges) {
      const edgeStyle = edge.type === 'dependency' ? '-->' : '-.->';
      const edgeLabel = edge.condition ? `|${edge.condition}|` : '';
      lines.push(`    ${edge.from} ${edgeStyle}${edgeLabel} ${edge.to}`);
    }

    // Add styling definitions
    if (options.includeStatus) {
      lines.push('');
      lines.push('    classDef pending fill:#f9f,stroke:#333,stroke-width:2px');
      lines.push('    classDef running fill:#bbf,stroke:#333,stroke-width:3px');
      lines.push('    classDef completed fill:#bfb,stroke:#333,stroke-width:2px');
      lines.push('    classDef failed fill:#fbb,stroke:#333,stroke-width:2px');
      lines.push('    classDef skipped fill:#ddd,stroke:#333,stroke-width:1px');
    }

    return lines.join('\n');
  }

  /**
   * Generate Graphviz DOT diagram
   */
  private static generateGraphvizDiagram(
    graph: VisualizationGraph,
    options: VisualizationOptions
  ): string {
    const rankdir = options.layout === 'vertical' ? 'TB' : 'LR';
    const lines: string[] = [
      'digraph workflow {',
      `    rankdir=${rankdir};`,
      '    node [shape=box, style=rounded];'
    ];

    // Add nodes
    for (const node of graph.nodes) {
      const nodeLabel = this.formatNodeLabel(node, options);
      const nodeStyle = this.getGraphvizNodeStyle(node, options);
      lines.push(`    ${node.id} [label="${nodeLabel}"${nodeStyle}];`);
    }

    // Add edges
    for (const edge of graph.edges) {
      const edgeStyle = edge.type === 'dependency' ? '' : ', style=dashed';
      const edgeLabel = edge.condition ? `, label="${edge.condition}"` : '';
      lines.push(`    ${edge.from} -> ${edge.to} [${edgeLabel}${edgeStyle}];`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Generate ASCII diagram
   */
  private static generateAsciiDiagram(
    graph: VisualizationGraph,
    options: VisualizationOptions
  ): string {
    const lines: string[] = [];
    const nodeWidth = 20;
    const nodeHeight = 3;

    lines.push(`Workflow: ${graph.metadata.workflowName}`);
    lines.push(`Steps: ${graph.metadata.totalSteps}`);
    if (graph.metadata.actualDuration) {
      lines.push(`Duration: ${this.formatDuration(graph.metadata.actualDuration)}`);
    }
    lines.push('');

    // Group nodes by parallel groups or sequential order
    const parallelGroups = this.groupNodesByParallel(graph.nodes);

    for (const [groupIndex, nodes] of parallelGroups.entries()) {
      if (nodes.length > 1) {
        lines.push(`Parallel Group ${groupIndex + 1}:`);
      }

      for (const node of nodes) {
        const statusIcon = this.getStatusIcon(node.status);
        const durationText = node.duration ? ` (${this.formatDuration(node.duration)})` : '';
        lines.push(`${statusIcon} ${node.name} [${node.type}]${durationText}`);
        
        if (options.includeErrors && node.error) {
          lines.push(`   Error: ${node.error}`);
        }
      }

      if (groupIndex < parallelGroups.length - 1) {
        lines.push('     ↓');
      }
    }

    return lines.join('\n');
  }

  /**
   * Calculate layout positions for nodes
   */
  private static calculateLayout(nodes: VisualizationNode[], edges: VisualizationEdge[]): void {
    // Simple layered layout algorithm
    const layers: string[][] = [];
    const visited = new Set<string>();
    const inDegree = new Map<string, number>();

    // Calculate in-degrees
    for (const node of nodes) {
      inDegree.set(node.id, 0);
    }
    for (const edge of edges) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    // Topological sort to create layers
    const queue = nodes.filter(node => inDegree.get(node.id) === 0).map(node => node.id);
    
    while (queue.length > 0) {
      const currentLayer: string[] = [];
      const nextQueue: string[] = [];

      for (const nodeId of queue) {
        if (!visited.has(nodeId)) {
          currentLayer.push(nodeId);
          visited.add(nodeId);

          // Add children to next queue
          for (const edge of edges.filter(e => e.from === nodeId)) {
            const newInDegree = (inDegree.get(edge.to) || 0) - 1;
            inDegree.set(edge.to, newInDegree);
            if (newInDegree === 0) {
              nextQueue.push(edge.to);
            }
          }
        }
      }

      if (currentLayer.length > 0) {
        layers.push(currentLayer);
      }
      queue.splice(0, queue.length, ...nextQueue);
    }

    // Assign positions
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex];
      for (let nodeIndex = 0; nodeIndex < layer.length; nodeIndex++) {
        const node = nodes.find(n => n.id === layer[nodeIndex]);
        if (node) {
          node.x = layerIndex * 150;
          node.y = nodeIndex * 100;
        }
      }
    }
  }

  /**
   * Estimate workflow duration based on step types
   */
  private static estimateWorkflowDuration(workflow: WorkflowDefinition): number {
    let totalDuration = 0;
    const stepDurations = new Map<string, number>();

    // Estimate individual step durations
    for (const step of workflow.steps) {
      let estimatedDuration = 0;
      switch (step.type) {
        case 'script':
          estimatedDuration = 30000; // 30 seconds
          break;
        case 'agent':
          estimatedDuration = 60000; // 1 minute
          break;
        case 'condition':
          estimatedDuration = 1000; // 1 second
          break;
        default:
          estimatedDuration = 10000; // 10 seconds
      }
      stepDurations.set(step.id, estimatedDuration);
    }

    // Calculate critical path
    const criticalPath = this.calculateCriticalPath(workflow, stepDurations);
    return criticalPath.reduce((sum, stepId) => sum + (stepDurations.get(stepId) || 0), 0);
  }

  /**
   * Calculate critical path through workflow
   */
  private static calculateCriticalPath(
    workflow: WorkflowDefinition,
    stepDurations: Map<string, number>
  ): string[] {
    // Simple implementation - return longest sequential path
    const visited = new Set<string>();
    const paths: string[][] = [];

    function findPaths(stepId: string, currentPath: string[]): void {
      if (visited.has(stepId)) return;
      
      const newPath = [...currentPath, stepId];
      const step = workflow.steps.find(s => s.id === stepId);
      
      if (!step) return;

      const dependents = workflow.steps.filter(s => s.dependsOn?.includes(stepId));
      
      if (dependents.length === 0) {
        paths.push(newPath);
        return;
      }

      for (const dependent of dependents) {
        findPaths(dependent.id, newPath);
      }
    }

    // Find all starting points (no dependencies)
    const startingSteps = workflow.steps.filter(s => !s.dependsOn || s.dependsOn.length === 0);
    
    for (const startStep of startingSteps) {
      findPaths(startStep.id, []);
    }

    // Return path with longest total duration
    return paths.reduce((longest, current) => {
      const currentDuration = current.reduce((sum, stepId) => sum + (stepDurations.get(stepId) || 0), 0);
      const longestDuration = longest.reduce((sum, stepId) => sum + (stepDurations.get(stepId) || 0), 0);
      return currentDuration > longestDuration ? current : longest;
    }, []);
  }

  /**
   * Helper methods for formatting and styling
   */
  private static formatNodeLabel(node: VisualizationNode, options: VisualizationOptions): string {
    let label = node.name;
    
    if (options.includeTimings && node.duration) {
      label += `\\n(${this.formatDuration(node.duration)})`;
    }
    
    return label;
  }

  private static getMermaidNodeStyle(node: VisualizationNode, options: VisualizationOptions): string {
    if (node.parallel) {
      return '(())'; // Stadium shape for parallel steps
    }
    return '[]'; // Rectangle for normal steps
  }

  private static getMermaidStatusClass(status: string): string {
    return status;
  }

  private static getGraphvizNodeStyle(node: VisualizationNode, options: VisualizationOptions): string {
    const styles: string[] = [];
    
    if (options.includeStatus && node.status) {
      const color = this.getStatusColor(node.status);
      styles.push(`fillcolor="${color}"`);
      styles.push('style="filled,rounded"');
    }
    
    if (node.parallel) {
      styles.push('shape=parallelogram');
    }
    
    return styles.length > 0 ? `, ${styles.join(', ')}` : '';
  }

  private static getStatusColor(status: string): string {
    switch (status) {
      case 'pending': return '#f9f9f9';
      case 'running': return '#bbbbff';
      case 'completed': return '#bbffbb';
      case 'failed': return '#ffbbbb';
      case 'skipped': return '#dddddd';
      default: return '#ffffff';
    }
  }

  private static getStatusIcon(status?: string): string {
    switch (status) {
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'running': return '🔄';
      case 'skipped': return '⏭️';
      case 'pending': return '⏳';
      default: return '📋';
    }
  }

  private static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  }

  private static groupNodesByParallel(nodes: VisualizationNode[]): VisualizationNode[][] {
    const groups = new Map<number, VisualizationNode[]>();
    
    for (const node of nodes) {
      const groupKey = node.parallelGroup ?? -1;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(node);
    }
    
    return Array.from(groups.values());
  }
}

/**
 * Factory function to create workflow visualizations
 */
export function createWorkflowVisualization(
  workflow: WorkflowDefinition,
  options: VisualizationOptions,
  executionReport?: WorkflowExecutionReport,
  metrics?: WorkflowExecutionMetrics
): string {
  return WorkflowVisualizer.visualize(workflow, options, executionReport, metrics);
}

/**
 * Generate multiple visualization formats
 */
export function generateAllVisualizations(
  workflow: WorkflowDefinition,
  executionReport?: WorkflowExecutionReport,
  metrics?: WorkflowExecutionMetrics
): Record<VisualizationFormat, string> {
  const formats: VisualizationFormat[] = ['mermaid', 'graphviz', 'ascii', 'json'];
  const result: Record<string, string> = {};

  for (const format of formats) {
    try {
      result[format] = createWorkflowVisualization(
        workflow,
        { format, includeStatus: true, includeTimings: true, includeErrors: true },
        executionReport,
        metrics
      );
    } catch (error) {
      result[format] = `Error generating ${format} visualization: ${error}`;
    }
  }

  return result;
}