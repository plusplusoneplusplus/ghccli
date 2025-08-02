# Agent Invocation Tool (`invoke_agents`)

This document describes the `invoke_agents` tool for the Gemini CLI.

## Description

Use `invoke_agents` to invoke multiple agents in parallel to handle complex, multi-step tasks autonomously. This tool allows you to execute multiple specialized agents concurrently, each with their own specific messages and configurations, making it ideal for breaking down complex workflows into parallel, specialized operations.

The tool provides:
- **Parallel execution:** Multiple agents run simultaneously for improved performance
- **Flexible configuration:** Each agent can have different messages, methods, and parameters
- **Execution tracking:** Optional execution IDs for monitoring and checkpointing
- **Aggregated results:** Combined results from all agent invocations
- **Automatic chat history saving:** Conversation history is automatically saved for each agent execution

### Arguments

`invoke_agents` takes the following arguments:

- `agents` (array, required): Array of agent configurations to invoke. Each agent configuration contains:
  - `agentName` (string, required): Name of the agent to invoke
  - `message` (string, required): Message to send to the agent
  - `method` (string, optional): Specific method to call on the agent (if the agent supports multiple methods)
  - `taskDescription` (string, optional): Description of the task for the agent
  - `additionalParams` (object, optional): Additional parameters for the agent
  - `metadata` (object, optional): Metadata for execution tracking

- `executionId` (string, optional): Execution ID for tracking the entire batch operation
- `currentExecutionId` (string, optional): Current execution context ID for hierarchical tracking

## How to use `invoke_agents` with the Gemini CLI

The tool executes all specified agents in parallel, with each agent receiving its individual message and configuration. Each agent can utilize the full range of available tools and capabilities, with tool filtering applied based on the agent's configuration.

The tool automatically:
- Validates all agent configurations before execution
- Creates unique execution IDs for tracking each agent
- Saves chat history for each agent conversation
- Handles errors gracefully, allowing successful agents to complete even if others fail
- Aggregates results from all agents into a comprehensive summary

Usage:

```
invoke_agents(agents=[{"agentName": "agent-name", "message": "Your message"}])
```

### `invoke_agents` examples

Invoke a single research agent:

```json
{
  "agents": [
    {
      "agentName": "research-agent",
      "message": "Search for recent developments in artificial intelligence",
      "taskDescription": "Research task for AI developments"
    }
  ]
}
```

Invoke multiple agents in parallel with different specializations:

```json
{
  "agents": [
    {
      "agentName": "research-agent",
      "message": "Research market trends in renewable energy",
      "taskDescription": "Market research for renewable energy sector"
    },
    {
      "agentName": "analysis-agent",
      "method": "analyze",
      "message": "Analyze the quarterly financial data for cost optimization opportunities",
      "taskDescription": "Financial analysis task"
    },
    {
      "agentName": "writing-agent",
      "message": "Create a summary report of the project findings",
      "taskDescription": "Documentation task"
    }
  ],
  "executionId": "project-analysis-batch-2024"
}
```

Invoke agents with additional parameters and metadata:

```json
{
  "agents": [
    {
      "agentName": "data-processor",
      "message": "Process the user engagement data",
      "additionalParams": {
        "dataSource": "analytics_db",
        "timeRange": "last_30_days"
      },
      "metadata": {
        "priority": "high",
        "team": "data-science"
      }
    }
  ]
}
```

## Response Format

The tool returns a comprehensive response including:

### Summary Information
- Total number of agents invoked
- Number of successful and failed executions
- Overall execution duration
- Execution IDs for tracking

### Individual Agent Results
For each agent, the response includes:
- Agent name and method (if specified)
- Success/failure status
- Execution duration
- Response content or error message
- Child execution ID for chat history tracking

### Chat History Tracking
Each agent's conversation is automatically saved with a unique execution ID in the format:
- `{batchExecutionId}-agent-{index}` (e.g., `custom-exec-id-agent-0`)

## Important notes

- **Parallel execution:** All agents run simultaneously, which improves performance but means they cannot directly communicate with each other during execution
- **Tool filtering:** Each agent's available tools are filtered based on their configuration and preferences
- **Error handling:** Individual agent failures do not prevent other agents from completing successfully
- **Chat history:** Conversation history is automatically saved for each agent, allowing you to review individual agent interactions later
- **Execution tracking:** Use execution IDs to track and organize batch operations, especially for complex workflows
- **Agent discovery:** Agents are discovered from the configured agent directory, and must exist and be properly configured
- **Method validation:** If a method is specified, it must be supported by the target agent
- **Resource usage:** Running multiple agents in parallel may consume more computational resources