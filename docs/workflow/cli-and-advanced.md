# CLI Integration and Advanced Features

This document covers CLI usage, monitoring, reporting, advanced features, best practices, and a complete example for the workflow system.

## CLI Integration

### Workflow Discovery

The CLI automatically discovers workflows from YAML files (`.yml` or `.yaml` extensions) in the current directory and subdirectories. Workflows must have a valid structure with `name` and `steps` properties.

### Command Reference

#### `/workflow list [path]`

Lists all available workflows with their metadata:

```bash
# List workflows in current directory
/workflow list

# List workflows in specific directory
/workflow list ./ci-workflows
```

#### `/workflow run <name> [variables]`

Executes a workflow with optional JSON variables:

```bash
# Basic execution
/workflow run build-and-test

# With variables (JSON format)
/workflow run deploy-staging {"environment": "staging", "version": "1.2.3"}

# Complex variables
/workflow run integration-tests {"config": {"timeout": 300, "retries": 3}, "parallel": true}
```

**Features:**
- Real-time progress updates in the CLI
- Interactive error reporting
- Automatic workflow validation before execution
- Support for complex JSON variable structures

#### `/workflow status <name>`

Shows the current execution status of a workflow:

```bash
/workflow status build-and-test

# Output example:
# Workflow Status
# 
# Name: build-and-test
# Status: 🔄 running
# Progress: 60%
# Completed Steps: 3
```

**Status Indicators:**
- ⏳ pending - Workflow not yet started
- 🔄 running - Currently executing
- ✅ completed - Finished successfully
- ❌ failed - Execution failed
- 🚫 cancelled - Workflow was cancelled

#### `/workflow validate <name>`

Validates workflow definition syntax and configuration:

```bash
/workflow validate my-workflow

# Note: Currently shows placeholder message
# Future implementation will provide detailed validation results
```

### Tab Completion

The `/workflow` command supports intelligent tab completion:

- **Subcommands**: Type `/workflow ` and press Tab to see available subcommands (`run`, `list`, `status`, `validate`)
- **Workflow Names**: Type `/workflow run ` and press Tab to see available workflow names
- **Partial Matching**: Type `/workflow run bui` and press Tab to complete matching workflow names

### Error Handling

The CLI provides user-friendly error messages for common issues:

```bash
# Missing workflow
/workflow run nonexistent
# Error: Workflow "nonexistent" not found. Available workflows: build, test, deploy

# Invalid JSON variables
/workflow run deploy {"invalid": json}
# Error: Invalid variables format. Use JSON format: {"key": "value"}

# Missing required arguments
/workflow status
# Error: Usage: /workflow status <name>
```

### Integration with Workflow Tool

The CLI `/workflow` command integrates with the core `WorkflowTool` to provide:
- Automatic workflow discovery from filesystem
- YAML parsing and validation
- Execution progress tracking
- Result formatting and display
- Error handling and user feedback

For advanced programmatic usage, see the [Programmatic API](#using-the-programmatic-api) section above.

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

### Condition Step Best Practices
1. **Use Clear Variable Names**: Choose descriptive variable and step output references
2. **Keep Expressions Simple**: Break complex logic into multiple condition steps when needed
3. **Test All Branches**: Ensure both onTrue and onFalse paths are tested
4. **Handle Missing Data**: Use existence checks before value comparisons
5. **Set Appropriate Timeouts**: Condition evaluation should be fast, but allow for complex expressions
6. **Use continueOnError Wisely**: Consider if condition failures should stop the workflow
7. **Document Complex Logic**: Add meaningful names and comments for complex boolean expressions
8. **Prefer Explicit Conditions**: Use specific comparisons rather than implicit truthiness
9. **Validate Input Data**: Ensure referenced variables and step outputs exist
10. **Consider Edge Cases**: Account for null, undefined, and empty values in conditions

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

	- id: production-deployment-check
		name: Check Production Deployment Readiness
		type: condition
		config:
			expression:
				type: and
				conditions:
					- type: equals
						left: '{{variable.environment}}'
						right: 'production'
					- type: equals
						left: '{{variable.deployProduction}}'
						right: true
					- type: equals
						left: '{{steps.integration-tests.result}}'
						right: 'success'
			onTrue: ['deploy-production']
			onFalse: ['skip-production-deployment']
		dependsOn: ["integration-tests"]

	- id: deploy-production
		name: Deploy to Production
		type: script
		config:
			command: npm
			args: ["run", "deploy:production"]
			env:
				DEPLOY_TARGET: production
		parallel:
			enabled: true
			resource: network     # Network intensive deployment

	- id: skip-production-deployment
		name: Skip Production Deployment
		type: script
		config:
			command: echo
			args: ["Skipping production deployment based on conditions"]

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
