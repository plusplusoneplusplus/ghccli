# Workflow System

Define and execute automation workflows using YAML configuration files. The workflow system provides a robust execution engine with dependency resolution, error handling, status tracking, and support for both script and agent-based steps.

## Features

- **Dependency Resolution**: Automatic step ordering based on dependencies with circular dependency detection
- **Error Handling**: Configurable error handling with `continueOnError` support
- **Status Tracking**: Real-time execution monitoring with progress reporting
- **Context Management**: Variable passing and step output sharing between steps
- **Extensible Architecture**: Plugin system for custom step executors
- **Comprehensive Logging**: Detailed execution logs and reports

## Quick Start

### 1. Define a Workflow

```yaml
name: My Workflow
version: 1.0.0
description: Optional description
timeout: 300000  # 5 minutes global timeout

env:
  NODE_ENV: production
  BUILD_NUMBER: "123"

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
      prompt: "Analyze the code for issues"
      parameters:
        depth: full
    dependsOn: ["step1"]
```

### 2. Execute the Workflow

```typescript
import { WorkflowRunner, validateWorkflowDefinition } from '@google/gemini-cli-core/workflow';

const runner = new WorkflowRunner();

// Validate workflow first
const validation = validateWorkflowDefinition(workflow);
if (!validation.valid) {
  console.error('Invalid workflow:', validation.errors);
  return;
}

// Execute workflow
const result = await runner.execute(workflow, {
  variables: { buildNumber: '123' },
  continueOnError: false,
  timeout: 600000 // 10 minutes
});

console.log(`Workflow ${result.success ? 'succeeded' : 'failed'}`);
console.log(runner.generateSummaryReport(workflow, result));
```

## Workflow Definition

### Basic Structure

```yaml
name: string                    # Workflow name (required)
version: string                 # Semantic version (required)
description: string             # Optional description
timeout: number                 # Global timeout in milliseconds
env:                           # Global environment variables
  KEY: value
metadata:                      # Optional metadata
  author: string
  tags: [string]
steps: [WorkflowStep]          # Array of steps (required)
```

### Step Configuration

```yaml
- id: unique-id               # Unique step identifier (required)
  name: Display Name          # Human-readable name (required)
  type: script|agent          # Step type (required)
  config: StepConfig          # Type-specific configuration (required)
  dependsOn: [string]         # List of step IDs this step depends on
  condition: string           # Conditional execution expression
  continueOnError: boolean    # Continue workflow if this step fails
```

## Step Types

### Script Steps

Execute shell commands with full environment control:

```yaml
- id: build-project
  name: Build Project
  type: script
  config:
    command: npm                    # Command to execute (required)
    args: ["run", "build"]          # Command arguments
    workingDirectory: ./src         # Working directory
    timeout: 120000                 # Step timeout (2 minutes)
    env:                           # Step-specific environment variables
      NODE_ENV: production
  dependsOn: ["install-deps"]
```

**Script Configuration Options:**
- `command` (required): The command to execute
- `args`: Array of command line arguments
- `workingDirectory`: Working directory for command execution
- `timeout`: Step-specific timeout in milliseconds
- `env`: Environment variables for the command

### Agent Steps

Invoke AI agents with configurable parameters:

```yaml
- id: code-analysis
  name: Analyze Code Quality
  type: agent
  config:
    agent: code-analyzer            # Agent name (required)
    prompt: |                       # Prompt template with variable substitution
      Analyze the codebase for potential issues.
      Build number: {{variables.buildNumber}}
      Previous results: {{steps.build-project.output}}
    parameters:                     # Agent-specific parameters
      includeTests: true
      outputFormat: json
      depth: full
    timeout: 300000                 # 5 minutes for analysis
  dependsOn: ["build-project"]
  continueOnError: true             # Don't fail workflow if analysis fails
```

**Agent Configuration Options:**
- `agent` (required): Name of the agent to invoke
- `prompt`: Prompt template (supports variable substitution)
- `parameters`: Agent-specific parameters object
- `timeout`: Agent execution timeout

## Dependency Management

### Basic Dependencies

Steps can depend on one or more other steps:

```yaml
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
    dependsOn: ["install"]        # Runs after install

  - id: build
    name: Build Project
    type: script
    config:
      command: npm
      args: ["run", "build"]
    dependsOn: ["install"]        # Also runs after install

  - id: deploy
    name: Deploy Application
    type: script
    config:
      command: npm
      args: ["run", "deploy"]
    dependsOn: ["test", "build"]  # Runs after both test and build
```

### Parallel Execution

Steps with no dependencies or the same dependency level can run in parallel:

```yaml
steps:
  - id: install
    name: Install Dependencies
    type: script
    config:
      command: npm
      args: ["install"]

  # These two steps will run in parallel after install completes
  - id: lint
    name: Lint Code
    type: script
    config:
      command: npm
      args: ["run", "lint"]
    dependsOn: ["install"]

  - id: type-check
    name: Type Check
    type: script
    config:
      command: npm
      args: ["run", "type-check"]
    dependsOn: ["install"]
```

## Error Handling

### Continue on Error

Control workflow behavior when steps fail:

```yaml
steps:
  - id: optional-step
    name: Optional Analysis
    type: agent
    config:
      agent: code-analyzer
      prompt: "Analyze code quality"
    continueOnError: true         # Workflow continues even if this fails

  - id: critical-step
    name: Critical Build
    type: script
    config:
      command: npm
      args: ["run", "build"]
    continueOnError: false        # Workflow stops if this fails (default)
```

### Global Error Handling

```typescript
const result = await runner.execute(workflow, {
  continueOnError: true  // Continue on any step failure
});
```

## Variable and Context Management

### Environment Variables

Set global and step-specific environment variables:

```yaml
name: Environment Example
version: 1.0.0

env:                              # Global environment variables
  NODE_ENV: production
  API_URL: https://api.example.com

steps:
  - id: deploy
    name: Deploy to Staging
    type: script
    config:
      command: deploy.sh
      env:                        # Step-specific environment variables
        DEPLOY_ENV: staging       # Overrides or adds to global env
        DATABASE_URL: postgres://localhost/staging
```

### Runtime Variables

Pass variables during execution:

```typescript
const result = await runner.execute(workflow, {
  variables: {
    buildNumber: process.env.BUILD_NUMBER,
    gitCommit: process.env.GIT_COMMIT,
    deployTarget: 'staging'
  }
});
```

### Variable Substitution

Use variables in prompts and configurations:

```yaml
steps:
  - id: notify
    name: Send Notification
    type: agent
    config:
      agent: notification-sender
      prompt: |
        Build {{variables.buildNumber}} completed successfully.
        Commit: {{variables.gitCommit}}
        Target: {{variables.deployTarget}}
        Test results: {{steps.run-tests.output.summary}}
```

## Conditional Execution

Execute steps based on conditions:

```yaml
steps:
  - id: deploy-production
    name: Deploy to Production
    type: script
    config:
      command: deploy-prod.sh
    condition: "env.NODE_ENV === 'production'"  # Only run in production
    dependsOn: ["run-tests"]

  - id: notify-on-failure
    name: Send Failure Notification
    type: agent
    config:
      agent: notification-sender
      prompt: "Build failed for commit {{variables.gitCommit}}"
    condition: "steps.run-tests.success === false"  # Only run if tests failed
```

## Monitoring and Reporting

### Real-time Monitoring

```typescript
const runner = new WorkflowRunner();
const executionPromise = runner.execute(workflow);

// Monitor progress
const interval = setInterval(() => {
  console.log(`Status: ${runner.getStatus()}`);
  console.log(`Progress: ${runner.getProgress()}%`);
  
  const report = runner.getExecutionReport(workflow);
  console.log(`Completed: ${report.completedSteps}/${report.totalSteps}`);
}, 1000);

const result = await executionPromise;
clearInterval(interval);
```

### Reports

Generate detailed execution reports:

```typescript
// Summary report (human-readable)
const summary = runner.generateSummaryReport(workflow, result);
console.log(summary);

// Detailed JSON report
const detailed = runner.generateDetailedReport(workflow, result);
const reportData = JSON.parse(detailed);

// Access execution logs
const context = runner.getContext();
const logs = context?.getLogs();
```

### Status Tracking

```typescript
import { WorkflowStatus } from '@google/gemini-cli-core/workflow';

const status = runner.getStatus();
switch (status) {
  case WorkflowStatus.PENDING:
    console.log('Workflow not started');
    break;
  case WorkflowStatus.RUNNING:
    console.log('Workflow executing');
    break;
  case WorkflowStatus.COMPLETED:
    console.log('Workflow completed successfully');
    break;
  case WorkflowStatus.FAILED:
    console.log('Workflow failed');
    break;
  case WorkflowStatus.CANCELLED:
    console.log('Workflow was cancelled');
    break;
}
```

## Advanced Features

### Custom Step Executors

Extend the system with custom step types:

```typescript
import { StepExecutor, WorkflowStep, WorkflowContext } from '@google/gemini-cli-core/workflow';

class DatabaseStepExecutor extends StepExecutor {
  getSupportedType(): string {
    return 'database';
  }

  validate(step: WorkflowStep): { valid: boolean; errors: string[] } {
    // Validate database step configuration
    return { valid: true, errors: [] };
  }

  async execute(step: WorkflowStep, context: WorkflowContext): Promise<unknown> {
    // Execute database operation
    const config = step.config as DatabaseConfig;
    // ... database logic
    return { recordsProcessed: 100 };
  }
}

// Register custom executor
const runner = new WorkflowRunner();
runner.registerStepExecutor('database', new DatabaseStepExecutor());
```

### Workflow Cancellation

```typescript
const runner = new WorkflowRunner();
const executionPromise = runner.execute(workflow);

// Cancel after 30 seconds
setTimeout(() => {
  runner.cancel();
}, 30000);

const result = await executionPromise;
console.log(result.success); // false if cancelled
```

### Context Snapshots

Save and restore workflow state:

```typescript
const context = runner.getContext();
if (context) {
  // Create snapshot
  const snapshot = context.createSnapshot();
  
  // Save to storage
  await saveSnapshot(snapshot);
  
  // Later, restore from snapshot
  const restoredSnapshot = await loadSnapshot();
  context.restoreFromSnapshot(restoredSnapshot);
}
```

## Complete Example

Here's a comprehensive CI/CD workflow example:

```yaml
name: Complete CI/CD Pipeline
description: Full build, test, and deployment pipeline
version: 1.2.0
timeout: 1800000  # 30 minutes

env:
  NODE_ENV: production
  CI: true

metadata:
  author: development-team
  tags: ["ci", "cd", "automation"]

steps:
  - id: checkout
    name: Checkout Code
    type: script
    config:
      command: git
      args: ["checkout", "{{variables.branch}}"]
      workingDirectory: ./

  - id: install-deps
    name: Install Dependencies
    type: script
    config:
      command: npm
      args: ["ci"]
      timeout: 300000  # 5 minutes
    dependsOn: ["checkout"]

  - id: lint
    name: Lint Code
    type: script
    config:
      command: npm
      args: ["run", "lint"]
    dependsOn: ["install-deps"]
    continueOnError: true

  - id: type-check
    name: TypeScript Check
    type: script
    config:
      command: npm
      args: ["run", "type-check"]
    dependsOn: ["install-deps"]

  - id: run-tests
    name: Run Unit Tests  
    type: script
    config:
      command: npm
      args: ["run", "test:coverage"]
      env:
        NODE_ENV: test
    dependsOn: ["install-deps"]

  - id: build
    name: Build Application
    type: script
    config:
      command: npm
      args: ["run", "build"]
      env:
        NODE_ENV: production
    dependsOn: ["type-check", "run-tests"]

  - id: security-scan
    name: Security Analysis
    type: agent
    config:
      agent: security-scanner
      prompt: |
        Perform security analysis on the built application.
        Focus on:
        - Dependency vulnerabilities
        - Code security patterns
        - Configuration security
        
        Build output: {{steps.build.output}}
      parameters:
        scanDependencies: true
        scanCode: true
        outputFormat: "json"
    dependsOn: ["build"]
    continueOnError: true

  - id: deploy-staging
    name: Deploy to Staging
    type: script
    config:
      command: npm
      args: ["run", "deploy:staging"]
      env:
        DEPLOY_TARGET: staging
    dependsOn: ["build"]
    condition: "variables.deployStaging === true"

  - id: integration-tests
    name: Run Integration Tests
    type: script
    config:
      command: npm
      args: ["run", "test:integration"]
      env:
        BASE_URL: "https://staging.example.com"
    dependsOn: ["deploy-staging"]
    condition: "variables.deployStaging === true"

  - id: deploy-production
    name: Deploy to Production
    type: script
    config:
      command: npm
      args: ["run", "deploy:production"]
      env:
        DEPLOY_TARGET: production
    dependsOn: ["integration-tests"]
    condition: "env.NODE_ENV === 'production' && variables.deployProduction === true"

  - id: notify-success
    name: Send Success Notification
    type: agent
    config:
      agent: notification-sender
      prompt: |
        🎉 Deployment successful!
        
        Build: {{variables.buildNumber}}
        Commit: {{variables.gitCommit}}
        Environment: {{variables.deployTarget}}
        
        Test Results: {{steps.run-tests.output.summary}}
        Security Scan: {{steps.security-scan.output.summary}}
      parameters:
        channel: "#deployments"
        priority: "normal"
    dependsOn: ["deploy-production"]
    continueOnError: true
```

This workflow demonstrates:
- Parallel execution (lint, type-check, tests)
- Conditional deployment steps
- Agent integration for security scanning and notifications
- Error handling strategies
- Environment and variable usage
- Complex dependency chains

## Best Practices

1. **Keep Steps Focused**: Each step should have a single responsibility
2. **Use Meaningful IDs**: Step IDs should be descriptive and unique
3. **Handle Errors Appropriately**: Use `continueOnError` judiciously
4. **Set Reasonable Timeouts**: Prevent workflows from hanging indefinitely
5. **Use Variables**: Make workflows reusable with parameterization
6. **Test Dependencies**: Ensure dependency chains are logical and necessary
7. **Monitor Execution**: Use status tracking for long-running workflows
8. **Log Appropriately**: Use context logs for debugging and auditing