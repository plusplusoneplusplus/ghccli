# Workflow System

Define and execute automation workflows using YAML configuration files. Workflows consist of steps that can execute scripts or invoke AI agents.

## Basic Structure

```yaml
name: My Workflow
version: 1.0.0
description: Optional description

steps:
  - id: step1
    name: First Step
    type: script
    config:
      command: npm
      args: ["install"]
    
  - id: step2
    name: Second Step
    type: agent
    config:
      agent: code-analyzer
      prompt: "Analyze the code"
    dependsOn: ["step1"]
```

## Step Types

### Script Steps
Execute shell commands:
```yaml
- id: build
  name: Build Project
  type: script
  config:
    command: npm
    args: ["run", "build"]
    timeout: 600
  dependsOn: ["install"]
```

### Agent Steps
Invoke AI agents:
```yaml
- id: review
  name: Code Review
  type: agent
  config:
    agent: code-reviewer
    prompt: "Review for issues"
    parameters:
      language: typescript
  dependsOn: ["build"]
```

## Example

```yaml
name: Simple Build Workflow
version: 1.0.0

steps:
  - id: install
    name: Install Dependencies
    type: script
    config:
      command: npm
      args: ["install"]

  - id: test
    name: Run Tests
    type: script
    config:
      command: npm
      args: ["test"]
    dependsOn: ["install"]

  - id: build
    name: Build Project
    type: script
    config:
      command: npm
      args: ["run", "build"]
    dependsOn: ["test"]
```