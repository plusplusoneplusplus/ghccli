# Parallel Execution and Resource Management

This document details parallel execution, resource management, and related best practices for the workflow system.

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

## Resource Management

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

## Execution Control

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

## Parallel Execution Statistics

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

## Error Handling in Parallel Execution

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

## Complex Parallel Workflows

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
