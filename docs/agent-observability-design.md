# Agent Observability Design

## Overview

This document outlines the design for enhanced observability in multi-agent systems, focusing on agent execution ID tracking and cross-agent correlation for debugging multi-turn interactions.

## Current State

### Existing Infrastructure
- **OpenTelemetry-based telemetry**: API requests, responses, tool calls
- **Logger class**: Session-based conversation history with checkpointing
- **Agent invocation tool**: Parallel agent execution with individual results

### Gaps Identified
1. **Agent execution ID correlation**: No linking between agent execution context and conversation history
2. **Cross-agent correlation**: Missing shared context tracking across agent invocations

## Design Solutions

### 1. Agent Execution ID Tracking

#### 1.1 Execution Context Enhancement

**Goal**: Link every agent conversation turn to its execution context for debugging.

**Components**:

```typescript
interface AgentExecutionContext {
  executionId: string;           // Unique ID for this agent execution
  parentExecutionId?: string;    // Parent execution if nested
  agentName: string;
  startTime: number;
  sessionId: string;
  correlationId: string;         // Shared across related executions
}
```

**Implementation Points**:

1. **GeminiChat Base Class Enhancement** (`packages/core/src/core/geminiChat.ts`):
   ```typescript
   export class GeminiChat {
     protected executionContext?: AgentExecutionContext;
     
     // Enhanced sendMessage with execution context support
     async sendMessage(
       params: SendMessageParameters,
       executionId?: string,
       parentExecutionId?: string
     ): Promise<GenerateContentResponse> {
       // Create execution context if not already set
       if (!this.executionContext || executionId) {
         this.executionContext = {
           executionId: executionId || this.generateExecutionId(),
           parentExecutionId,
           agentName: this.getAgentName?.() || 'user-chat', // fallback for non-agent chats
           startTime: Date.now(),
           sessionId: this.config.getSessionId(),
         };
         
         // Log execution start
         this.logExecutionStart();
       }
       
       const response = await this.originalSendMessage(params);
       
       // Log execution completion
       this.logExecutionEnd(response);
       
       return response;
     }
     
     // Get current execution ID (useful for passing to child agents)
     getCurrentExecutionId(): string | undefined {
       return this.executionContext?.executionId;
     }
     
     protected logExecutionStart(): void {
       if (!this.executionContext) return;
       
       logAgentExecution(this.config, {
         type: 'agent_execution_start',
         executionId: this.executionContext.executionId,
         parentExecutionId: this.executionContext.parentExecutionId,
         agentName: this.executionContext.agentName,
         startTime: this.executionContext.startTime,
         sessionId: this.executionContext.sessionId,
       });
     }
     
     protected logExecutionEnd(response: GenerateContentResponse): void {
       if (!this.executionContext) return;
       
       logAgentExecution(this.config, {
         type: 'agent_execution_end',
         executionId: this.executionContext.executionId,
         parentExecutionId: this.executionContext.parentExecutionId,
         agentName: this.executionContext.agentName,
         startTime: this.executionContext.startTime,
         endTime: Date.now(),
         sessionId: this.executionContext.sessionId,
         success: true, // could be derived from response
       });
     }
     
     // Override conversation logging to include execution context
     protected async logConversationMessage(message: string, type: MessageSenderType): Promise<void> {
       const logger = new Logger(this.config.getSessionId());
       await logger.initialize();
       
       // Pass execution context to conversation history
       await logger.logAgentMessage(type, message, this.executionContext);
     }
   }
   ```

2. **AgentChat Simplification** (`packages/core/src/agents/agentChat.ts`):
   ```typescript
   export class AgentChat extends GeminiChat {
     // AgentChat now inherits execution context from base class
     // Just needs to override getAgentName() to provide proper agent name
     
     protected getAgentName(): string {
       return this.agentConfig.name;
     }
   }
   ```

2. **Telemetry Integration**:
   ```typescript
   // In telemetry/loggers.ts - add new agent execution logger
   interface AgentExecutionEvent {
     type: 'agent_execution_start' | 'agent_execution_end';
     executionId: string;
     parentExecutionId?: string;
     agentName: string;
     startTime: number;
     endTime?: number;
     sessionId: string;
     success?: boolean;
   }
   
   export function logAgentExecution(config: Config, event: AgentExecutionEvent): void {
     if (!isTelemetrySdkInitialized()) return;
     
     const logger = logs.getLogger(SERVICE_NAME);
     logger.emit({
       severityNumber: SeverityNumber.INFO,
       body: `Agent ${event.type}: ${event.agentName}`,
       attributes: {
         'agent.execution.id': event.executionId,
         'agent.parent.execution.id': event.parentExecutionId || '',
         'agent.name': event.agentName,
         'agent.execution.type': event.type,
         'agent.start.time': event.startTime,
         'agent.end.time': event.endTime || 0,
         'agent.success': event.success || false,
         ...getCommonAttributes(config)
       }
     });
   }
   ```

#### 1.2 Conversation History Correlation

**Goal**: Link conversation history entries to agent execution context.

**Connection to 1.1**: The `AgentExecutionContext` created in 1.1 is passed to the Logger in 1.2, creating a bridge between telemetry events and conversation history.

**Logger Enhancement** (`packages/core/src/core/logger.ts`):

```typescript
export interface LogEntry {
  sessionId: string;
  messageId: number;
  timestamp: string;
  type: MessageSenderType;
  message: string;
  
  // NEW: Optional execution context (only present for agent messages)
  executionContext?: AgentExecutionContext;
}

export class Logger {
  async logAgentMessage(
    type: MessageSenderType, 
    message: string,
    executionContext?: AgentExecutionContext
  ): Promise<void> {
    const newEntryObject: LogEntry = {
      sessionId: this.sessionId,
      messageId: this.messageId,
      type,
      message,
      timestamp: new Date().toISOString(),
      executionContext, // Single field containing all agent context
    };
    
    await this._updateLogFile(newEntryObject);
  }
  
  // Query methods for agent-specific operations
  async getEntriesByExecutionId(executionId: string): Promise<LogEntry[]> {
    return this.logs.filter(entry => 
      entry.executionContext?.executionId === executionId
    );
  }
  
  async getEntriesByCorrelationId(correlationId: string): Promise<LogEntry[]> {
    return this.logs.filter(entry => 
      entry.executionContext?.correlationId === correlationId
    );
  }
  
  async getEntriesByAgent(agentName: string): Promise<LogEntry[]> {
    return this.logs.filter(entry => 
      entry.executionContext?.agentName === agentName
    );
  }
}
```

### 2. Cross-Agent Correlation Tracking

#### 2.1 Graph-Based Correlation

**Goal**: Use parent-child execution IDs to build execution graphs dynamically.

**Simplified Approach**: Since we have `executionId` and `parentExecutionId` relationships, we can build correlation graphs on-demand from telemetry data and log entries.

**Graph Query Utilities**:

```typescript
interface ExecutionNode {
  executionId: string;
  agentName: string;
  parentExecutionId?: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed';
  children: ExecutionNode[];
}

export class ExecutionGraphBuilder {
  
  /**
   * Build execution tree from log entries or telemetry data
   */
  static buildExecutionTree(executions: LogEntry[]): ExecutionNode[] {
    const nodeMap = new Map<string, ExecutionNode>();
    
    // Create nodes
    for (const entry of executions) {
      if (entry.executionContext) {
        const { executionId, agentName, parentExecutionId } = entry.executionContext;
        
        if (!nodeMap.has(executionId)) {
          nodeMap.set(executionId, {
            executionId,
            agentName,
            parentExecutionId,
            startTime: new Date(entry.timestamp).getTime(),
            endTime: undefined,
            status: 'completed', // infer from log presence
            children: []
          });
        }
      }
    }
    
    // Build parent-child relationships
    const roots: ExecutionNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentExecutionId) {
        const parent = nodeMap.get(node.parentExecutionId);
        if (parent) {
          parent.children.push(node);
        }
      } else {
        roots.push(node);
      }
    }
    
    return roots;
  }
  
  /**
   * Get all descendants of an execution
   */
  static getExecutionSubtree(rootExecutionId: string, allExecutions: LogEntry[]): ExecutionNode | null {
    const trees = this.buildExecutionTree(allExecutions);
    
    // Find the root in any tree (could be nested)
    function findNode(nodes: ExecutionNode[], targetId: string): ExecutionNode | null {
      for (const node of nodes) {
        if (node.executionId === targetId) return node;
        const found = findNode(node.children, targetId);
        if (found) return found;
      }
      return null;
    }
    
    for (const tree of trees) {
      const found = findNode([tree], rootExecutionId);
      if (found) return found;
    }
    
    return null;
  }
  
  /**
   * Get all executions in the same workflow (same root ancestor)
   */
  static getWorkflowExecutions(executionId: string, allExecutions: LogEntry[]): ExecutionNode[] {
    const trees = this.buildExecutionTree(allExecutions);
    
    // Find which tree contains this execution
    function findContainingTree(nodes: ExecutionNode[], targetId: string): ExecutionNode | null {
      for (const tree of nodes) {
        if (this.containsExecution(tree, targetId)) {
          return tree;
        }
      }
      return null;
    }
    
    const containingTree = findContainingTree(trees, executionId);
    return containingTree ? [containingTree] : [];
  }
  
  private static containsExecution(node: ExecutionNode, targetId: string): boolean {
    if (node.executionId === targetId) return true;
    return node.children.some(child => this.containsExecution(child, targetId));
  }
}
```

#### 2.2 Agent Invocation Tool Integration

**Enhanced with Current Execution Context** (`packages/core/src/tools/agent-invocation.ts`):

```typescript
export class AgentInvocationTool extends BaseTool {
  
  async execute(
    params: IMultiAgentInvocationParameters,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const batchExecutionId = params.executionId || this.generateExecutionId();
    
    // Use currentExecutionId from params (must be passed explicitly)
    const currentExecutionId = params.currentExecutionId;
    
    const agentPromises = params.agents.map(async (agentConfig, index) => {
      const agentExecutionId = `${batchExecutionId}-agent-${index}`;
      
      try {
        // Create agent chat instance
        const agentChat = new AgentChat(
          this.config,
          contentGenerator,
          loadedAgentConfig,
        );
        
        // Execute agent with proper parent-child relationship
        const response = await agentChat.sendMessage(
          { message: agentConfig.message },
          agentExecutionId,           // child execution ID
          currentExecutionId          // parent execution ID from params
        );
        
        return {
          agent: agentConfig.agentName,
          success: true,
          result: response,
          childExecutionId: agentExecutionId,
        };
      } catch (error) {
        return {
          agent: agentConfig.agentName,
          success: false,
          error: { message: error.message },
          childExecutionId: agentExecutionId,
        };
      }
    });
    
    const results = await Promise.allSettled(agentPromises);
    
    return { 
      totalAgents: params.agents.length,
      results: results.map(r => r.status === 'fulfilled' ? r.value : r.reason),
      batchExecutionId,
      parentExecutionId: currentExecutionId, // Track the parent relationship
    };
  }
}
```

**Tool Schema Update**:
```typescript
const agentInvocationToolSchemaData: FunctionDeclaration = {
  name: 'invoke_agents',
  description: '...',
  parameters: {
    type: Type.OBJECT,
    properties: {
      agents: { /* existing */ },
      executionId: { /* existing */ },
      currentExecutionId: {
        type: Type.STRING,
        description: 'Current execution ID to use as parent for child agents',
      },
    },
    required: ['agents'],
  },
};
```

**How the tool gets currentExecutionId**:

The calling GeminiChat instance would need to automatically inject its execution ID when calling tools:

```typescript
// In GeminiChat base class
async callTool(toolName: string, params: any): Promise<ToolResult> {
  // Automatically inject current execution ID for agent invocation tools
  if (toolName === 'invoke_agents' && this.executionContext) {
    params.currentExecutionId = this.executionContext.executionId;
  }
  
  return await this.toolRegistry.executeTool(toolName, params, signal);
}
```

## Implementation Plan

### Phase 1: Core Infrastructure
1. **AgentExecutionContext interface** - Define execution context structure
2. **AgentChat enhancement** - Add execution context tracking
3. **Logger extension** - Add agent context to conversation history
4. **Basic telemetry integration** - Log agent execution events

### Phase 2: Graph Query System
1. **ExecutionGraphBuilder** - Implement graph building from execution relationships
2. **Agent invocation tool integration** - Pass parent execution IDs
3. **Query APIs** - Build execution trees on-demand from log data

### Phase 3: Debugging Tools
1. **Correlation trace viewer** - Debug tool to visualize agent execution flows
2. **Agent execution timeline** - Show conversation history with execution context
3. **Performance metrics** - Agent-specific performance dashboards

## Benefits

### For Debugging
- **Trace agent decisions**: Link every conversation turn to its execution context
- **Cross-agent analysis**: Understand how agents interact in complex workflows  
- **Performance profiling**: Identify bottlenecks in multi-agent systems
- **Error correlation**: Find root causes across agent execution chains

### For Monitoring
- **Agent health metrics**: Track success rates, duration patterns
- **Resource utilization**: Monitor tool usage across agents
- **Workflow optimization**: Identify inefficient agent collaboration patterns

## Example Usage

### Query Agent Execution History
```typescript
// Get all executions for a specific agent
const agentExecutions = logger.getEntriesByAgent('research-agent');

// Get conversation history for specific execution
const conversation = logger.getEntriesByExecutionId('exec-456');

// Build execution tree for a workflow
const allEntries = await logger.getAllEntries(); // assume this method exists
const workflowTree = ExecutionGraphBuilder.getExecutionSubtree('batch-123', allEntries);
```

### Debug Multi-Agent Workflow
```typescript
// Build and traverse execution graph
const executionTree = ExecutionGraphBuilder.buildExecutionTree(logEntries);

function printExecutionTree(node: ExecutionNode, indent = '') {
  console.log(`${indent}${node.agentName} (${node.executionId})`);
  console.log(`${indent}  Duration: ${(node.endTime || Date.now()) - node.startTime}ms`);
  
  node.children.forEach(child => printExecutionTree(child, indent + '  '));
}

executionTree.forEach(root => printExecutionTree(root));
```

This design provides comprehensive observability for debugging multi-turn agent interactions while building on the existing telemetry infrastructure.