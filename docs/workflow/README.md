# Workflow System

Define and execute automation workflows using YAML configuration files. The workflow system provides a robust execution engine with dependency resolution, error handling, status tracking, and support for both script and agent-based steps.

## Features

- **Parallel Execution**: Execute independent steps concurrently with configurable concurrency limits and resource management
- **Dependency Resolution**: Automatic step ordering based on dependencies with circular dependency detection
- **Error Handling**: Configurable error handling with `continueOnError` support and error isolation in parallel execution
- **Status Tracking**: Real-time execution monitoring with progress reporting and parallel execution statistics
- **Context Management**: Variable passing and step output sharing between steps
- **Resource Management**: Control resource usage with named resource pools and utilization tracking
- **Extensible Architecture**: Plugin system for custom step executors
- **Comprehensive Logging**: Detailed execution logs and reports

## Quick Start

### 1. Define a Workflow

```yaml
name: My Workflow
version: 1.0.0
description: Optional description
timeout: 300000  # 5 minutes global timeout

# Enable parallel execution
parallel:
  enabled: true
  defaultMaxConcurrency: 4
  resources:
    cpu: 2
    memory: 4

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
    parallel:
      enabled: true
      maxConcurrency: 2
      resource: cpu
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
  timeout: 600000, // 10 minutes
  parallelEnabled: true, // Enable parallel execution
  maxConcurrency: 6 // Override default concurrency
});

console.log(`Workflow ${result.success ? 'succeeded' : 'failed'}`);
console.log(runner.generateSummaryReport(workflow, result));

// Check parallel execution statistics
if (result.parallelStats) {
  console.log(`Executed ${result.parallelStats.totalGroups} parallel groups`);
  console.log(`Max concurrent steps: ${result.parallelStats.maxConcurrentSteps}`);
  if (result.parallelStats.resourceUtilization) {
    console.log('Resource utilization:', result.parallelStats.resourceUtilization);
  }
}
```

## Workflow Definition

### Basic Structure

```yaml
name: string                    # Workflow name (required)
version: string                 # Semantic version (required)
description: string             # Optional description
timeout: number                 # Global timeout in milliseconds
parallel:                      # Parallel execution configuration (optional)
  enabled: boolean             # Enable parallel execution
  defaultMaxConcurrency: number # Default max concurrent steps
  resources:                   # Named resource limits
    cpu: number                # CPU resource limit
    memory: number             # Memory resource limit
    custom: number             # Custom resource limits
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
  parallel:                   # Parallel execution configuration (optional)
    enabled: boolean          # Enable parallel execution for this step
    maxConcurrency: number    # Max concurrent executions for this step
    resource: string          # Named resource this step consumes
    isolateErrors: boolean    # Isolate errors from other parallel steps
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

## Parallel Execution

The workflow system supports executing independent steps concurrently to improve performance and enable efficient resource utilization. Parallel execution is automatically detected based on step dependencies and can be configured at both workflow and step levels.

### Automatic Parallel Detection

Steps with no dependencies or the same dependency level automatically run in parallel:

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

### Workflow-Level Parallel Configuration

Enable and configure parallel execution for the entire workflow:

```yaml
name: Parallel Workflow
version: 1.0.0

parallel:
  enabled: true                 # Enable parallel execution
  defaultMaxConcurrency: 4      # Default max concurrent steps
  resources:                    # Define named resource pools
    cpu: 2                      # CPU-intensive tasks limited to 2 concurrent
    memory: 3                   # Memory-intensive tasks limited to 3 concurrent
    network: 5                  # Network tasks limited to 5 concurrent

steps:
  # Steps will automatically execute in parallel groups
  - id: build-frontend
    name: Build Frontend
    type: script
    config:
      command: npm
      args: ["run", "build:frontend"]

  - id: build-backend
    name: Build Backend  
    type: script
    config:
      command: npm
      args: ["run", "build:backend"]

  - id: run-tests
    name: Run Tests
    type: script
    config:
      command: npm
      args: ["test"]
```

### Step-Level Parallel Configuration

Fine-tune parallel execution for individual steps:

```yaml
steps:
  - id: cpu-intensive-task
    name: CPU Intensive Task
    type: script
    config:
      command: ./process-data.sh
    parallel:
      enabled: true
      maxConcurrency: 1         # Limit this step to 1 concurrent execution
      resource: cpu             # Consume CPU resource pool
      isolateErrors: true       # Don't let errors affect other parallel steps

  - id: memory-task
    name: Memory Task
    type: agent
    config:
      agent: data-processor
      prompt: "Process large dataset"
    parallel:
      enabled: true
      resource: memory          # Consume memory resource pool
      isolateErrors: false      # Errors can affect other steps in group

  - id: network-task
    name: Network Task
    type: script
    config:
      command: curl
      args: ["-X", "POST", "https://api.example.com/webhook"]
    parallel:
      enabled: true
      resource: network         # Consume network resource pool
```

### Resource Management

Control resource usage with named resource pools:

```yaml
parallel:
  enabled: true
  resources:
    # Database connections limited to 2 concurrent
    database: 2
    # API calls limited to 10 concurrent  
    api: 10
    # File system operations limited to 5 concurrent
    filesystem: 5

steps:
  - id: db-migration
    name: Run Database Migration
    type: script
    config:
      command: npm
      args: ["run", "migrate"]
    parallel:
      enabled: true
      resource: database        # Uses database resource pool

  - id: api-sync
    name: Sync with External API
    type: script
    config:
      command: ./sync-api.sh
    parallel:
      enabled: true
      resource: api            # Uses API resource pool
```

### Execution Control

Control when and how parallel execution occurs:

```typescript
// Enable parallel execution
const result = await runner.execute(workflow, {
  parallelEnabled: true,       // Enable parallel execution
  maxConcurrency: 8           // Override default max concurrency
});

// Force sequential execution
const result = await runner.execute(workflow, {
  parallelEnabled: false      // Force sequential execution
});

// Let workflow configuration decide
const result = await runner.execute(workflow, {
  // parallelEnabled not specified - uses workflow config
});
```

### Parallel Execution Statistics

Monitor parallel execution performance:

```typescript
const result = await runner.execute(workflow, { parallelEnabled: true });

if (result.parallelStats) {
  console.log('Parallel Execution Statistics:');
  console.log(`- Total parallel groups: ${result.parallelStats.totalGroups}`);
  console.log(`- Max concurrent steps: ${result.parallelStats.maxConcurrentSteps}`);
  
  if (result.parallelStats.resourceUtilization) {
    console.log('Resource Utilization:');
    for (const [resource, utilization] of Object.entries(result.parallelStats.resourceUtilization)) {
      console.log(`  - ${resource}: ${(utilization * 100).toFixed(1)}%`);
    }
  }
}

// Step-level parallel information
for (const [stepId, stepResult] of Object.entries(result.stepResults)) {
  if (stepResult.parallelGroup !== undefined) {
    console.log(`Step ${stepId} executed in parallel group ${stepResult.parallelGroup}`);
    console.log(`Execution time: ${stepResult.executionTime}ms`);
  }
}
```

### Error Handling in Parallel Execution

Control how errors propagate in parallel execution:

```yaml
steps:
  - id: critical-step
    name: Critical Step
    type: script
    config:
      command: ./critical-task.sh
    parallel:
      enabled: true
      isolateErrors: false      # Failure stops other steps in group
    continueOnError: false      # Failure stops entire workflow

  - id: optional-step
    name: Optional Step
    type: script
    config:
      command: ./optional-task.sh  
    parallel:
      enabled: true
      isolateErrors: true       # Failure doesn't affect other steps
    continueOnError: true       # Workflow continues on failure

  - id: independent-step
    name: Independent Step
    type: script
    config:
      command: ./independent-task.sh
    parallel:
      enabled: true
      isolateErrors: true       # Isolated from other step failures
```

### Complex Parallel Workflows

Example of a complex workflow with multiple parallel groups:

```yaml
name: Complex Parallel Workflow
version: 1.0.0

parallel:
  enabled: true
  defaultMaxConcurrency: 6
  resources:
    cpu: 2
    network: 4
    database: 1

steps:
  # Group 1: Independent initialization steps (run in parallel)
  - id: setup-env
    name: Setup Environment
    type: script
    config:
      command: ./setup-env.sh
    parallel:
      enabled: true

  - id: validate-config
    name: Validate Configuration
    type: script
    config:
      command: ./validate-config.sh
    parallel:
      enabled: true

  - id: check-dependencies
    name: Check Dependencies
    type: script
    config:
      command: ./check-deps.sh
    parallel:
      enabled: true

  # Group 2: Build steps that depend on Group 1 (run in parallel)
  - id: build-frontend
    name: Build Frontend
    type: script
    config:
      command: npm
      args: ["run", "build:frontend"]
    dependsOn: ["setup-env", "validate-config"]
    parallel:
      enabled: true
      resource: cpu

  - id: build-backend
    name: Build Backend
    type: script  
    config:
      command: npm
      args: ["run", "build:backend"]
    dependsOn: ["setup-env", "check-dependencies"]
    parallel:
      enabled: true
      resource: cpu

  - id: prepare-database
    name: Prepare Database
    type: script
    config:
      command: ./prepare-db.sh
    dependsOn: ["validate-config"]
    parallel:
      enabled: true
      resource: database

  # Group 3: Testing steps (run in parallel)
  - id: test-frontend
    name: Test Frontend
    type: script
    config:
      command: npm
      args: ["run", "test:frontend"]
    dependsOn: ["build-frontend"]
    parallel:
      enabled: true

  - id: test-backend
    name: Test Backend
    type: script
    config:
      command: npm
      args: ["run", "test:backend"]
    dependsOn: ["build-backend", "prepare-database"]
    parallel:
      enabled: true

  - id: integration-tests
    name: Integration Tests
    type: script
    config:
      command: npm
      args: ["run", "test:integration"]
    dependsOn: ["build-frontend", "build-backend", "prepare-database"]
    parallel:
      enabled: true
      resource: network

  # Group 4: Final deployment (sequential)
  - id: deploy
    name: Deploy Application
    type: script
    config:
      command: ./deploy.sh
    dependsOn: ["test-frontend", "test-backend", "integration-tests"]
```

This workflow demonstrates:
- **4 parallel execution groups** based on dependencies
- **Resource constraints** preventing overuse of CPU and database
- **Mixed parallel and sequential** execution patterns
- **Complex dependency chains** that still allow parallelization

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
description: Full build, test, and deployment pipeline with parallel execution
version: 1.2.0
timeout: 1800000  # 30 minutes

# Enable parallel execution for better performance
parallel:
  enabled: true
  defaultMaxConcurrency: 4
  resources:
    cpu: 2        # Build tasks are CPU intensive
    network: 3    # Deployment and API calls
    database: 1   # Database operations

env:
  NODE_ENV: production
  CI: true

metadata:
  author: development-team
  tags: ["ci", "cd", "automation", "parallel"]

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
    parallel:
      enabled: true
      isolateErrors: true    # Don't let linting errors stop other tasks

  - id: type-check
    name: TypeScript Check
    type: script
    config:
      command: npm
      args: ["run", "type-check"]
    dependsOn: ["install-deps"]
    parallel:
      enabled: true
      resource: cpu         # CPU intensive type checking

  - id: run-tests
    name: Run Unit Tests  
    type: script
    config:
      command: npm
      args: ["run", "test:coverage"]
      env:
        NODE_ENV: test
    dependsOn: ["install-deps"]
    parallel:
      enabled: true
      resource: cpu         # CPU intensive test execution

  - id: build
    name: Build Application
    type: script
    config:
      command: npm
      args: ["run", "build"]
      env:
        NODE_ENV: production
    dependsOn: ["type-check", "run-tests"]
    parallel:
      enabled: true
      resource: cpu         # CPU intensive build process

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
    parallel:
      enabled: true
      resource: network     # Network intensive deployment

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
    parallel:
      enabled: true
      resource: network     # Network intensive deployment

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
- **Parallel execution** with resource constraints (lint, type-check, tests run concurrently)
- **Resource management** (CPU for builds/tests, network for deployments)
- **Error isolation** (linting errors don't stop other parallel tasks)
- **Conditional deployment** steps with parallel execution
- **Agent integration** for security scanning and notifications
- **Mixed sequential and parallel** execution patterns
- **Environment and variable usage** in parallel contexts
- **Complex dependency chains** that still allow parallelization

## Best Practices

### General Workflow Design
1. **Keep Steps Focused**: Each step should have a single responsibility
2. **Use Meaningful IDs**: Step IDs should be descriptive and unique
3. **Handle Errors Appropriately**: Use `continueOnError` judiciously
4. **Set Reasonable Timeouts**: Prevent workflows from hanging indefinitely
5. **Use Variables**: Make workflows reusable with parameterization
6. **Test Dependencies**: Ensure dependency chains are logical and necessary
7. **Monitor Execution**: Use status tracking for long-running workflows
8. **Log Appropriately**: Use context logs for debugging and auditing

### Parallel Execution Best Practices
1. **Design for Parallelism**: Structure workflows to maximize parallel execution opportunities
2. **Use Resource Constraints**: Define resource pools to prevent system overload
3. **Isolate Non-Critical Errors**: Use `isolateErrors: true` for optional steps like linting
4. **Balance Concurrency**: Don't set concurrency too high - it can hurt performance
5. **Group Related Resources**: Use consistent resource names (cpu, memory, network, database)
6. **Monitor Resource Usage**: Use parallel execution statistics to optimize performance
7. **Test with Realistic Load**: Test workflows with expected concurrency levels
8. **Consider Step Duration**: Balance short and long-running steps in parallel groups
9. **Use Appropriate Timeouts**: Set step-level timeouts for better parallel execution control
10. **Profile and Optimize**: Use execution statistics to identify bottlenecks and optimize resource allocation