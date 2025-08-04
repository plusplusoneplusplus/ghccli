# Workflow Definition

This document covers the structure of workflow YAML files, step types, dependencies, variables, and branching logic for the workflow system.

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
- id: unique-id                    # Unique step identifier (required)
	name: Display Name               # Human-readable name (required)
	type: script|agent|condition     # Step type (required)
	config: StepConfig               # Type-specific configuration (required)
	dependsOn: [string]              # List of step IDs this step depends on
	condition: string                # Conditional execution expression
	continueOnError: boolean         # Continue workflow if this step fails
	parallel:                        # Parallel execution configuration (optional)
		enabled: boolean               # Enable parallel execution for this step
		maxConcurrency: number         # Max concurrent executions for this step
		resource: string               # Named resource this step consumes
		isolateErrors: boolean         # Isolate errors from other parallel steps
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

### Condition Steps

Execute conditional logic and branching based on variables, step outputs, and complex boolean expressions:

```yaml
- id: check-build-status
	name: Check Build Status
	type: condition
	config:
		expression:
			type: and
			conditions:
				- type: equals
					left: '{{steps.build.result}}'
					right: 'success'
				- type: greater_than
					left: '{{steps.test.coverage}}'
					right: 80
		onTrue: ['deploy-production', 'notify-success']
		onFalse: ['rollback', 'notify-failure']
		continueOnError: false
		timeout: 5000
	dependsOn: ['build', 'test']
```

**Condition Configuration Options:**
- `expression` (required): The condition or boolean expression to evaluate
- `onTrue`: Array of step IDs to execute if condition evaluates to true
- `onFalse`: Array of step IDs to execute if condition evaluates to false
- `continueOnError`: Continue workflow execution if condition evaluation fails
- `timeout`: Condition evaluation timeout in milliseconds

#### Basic Condition Operators

Support for various comparison and existence operators:

```yaml
# Equality checks
- type: equals
	left: '{{variable.status}}'
	right: 'success'

- type: not_equals
	left: '{{steps.build.exitCode}}'
	right: 0

# Contains checks for strings and arrays
- type: contains
	left: '{{steps.test.output}}'
	right: 'PASSED'

- type: not_contains
	left: '{{variable.features}}'
	right: 'experimental'

# Existence checks
- type: exists
	left: '{{variable.apiKey}}'

- type: not_exists
	left: '{{steps.optional-step.result}}'

# Numeric comparisons
- type: greater_than
	left: '{{steps.performance.score}}'
	right: 90

- type: less_than
	left: '{{variable.timeout}}'
	right: 300

- type: greater_than_or_equal
	left: '{{steps.test.coverage}}'
	right: 85

- type: less_than_or_equal
	left: '{{variable.retryCount}}'
	right: 3

# Regular expression matching
- type: matches
	left: '{{variable.version}}'
	right: '^v\d+\.\d+\.\d+$'

- type: not_matches
	left: '{{steps.lint.output}}'
	right: 'error|ERROR'
```

#### Boolean Logic Expressions

Combine conditions with AND, OR, and NOT operators:

```yaml
# AND: All conditions must be true
expression:
	type: and
	conditions:
		- type: equals
			left: '{{variable.environment}}'
			right: 'production'
		- type: exists
			left: '{{variable.apiKey}}'
		- type: greater_than
			left: '{{steps.test.coverage}}'
			right: 80

# OR: At least one condition must be true
expression:
	type: or
	conditions:
		- type: equals
			left: '{{variable.branch}}'
			right: 'main'
		- type: equals
			left: '{{variable.branch}}'
			right: 'master'

# NOT: Inverts the result of the condition
expression:
	type: not
	conditions:
		- type: equals
			left: '{{steps.build.result}}'
			right: 'failed'

# Nested boolean expressions
expression:
	type: and
	conditions:
		- type: equals
			left: '{{variable.environment}}'
			right: 'production'
		- type: or
			conditions:
				- type: equals
					left: '{{variable.branch}}'
					right: 'main'
				- type: equals
					left: '{{variable.branch}}'
					right: 'release'
		- type: not
			conditions:
				- type: contains
					left: '{{steps.security-scan.issues}}'
					right: 'critical'
```

#### Variable and Step Output References

Reference workflow variables and step outputs in conditions:

```yaml
# Variable references
- type: equals
	left: '{{variable.deployTarget}}'
	right: 'staging'

# Nested variable references
- type: greater_than
	left: '{{variable.config.maxRetries}}'
	right: 5

# Step output references
- type: equals
	left: '{{steps.build.result}}'
	right: 'success'

# Nested step output references
- type: contains
	left: '{{steps.test.output.summary.failed}}'
	right: 0

# Mixed references in complex expressions
expression:
	type: and
	conditions:
		- type: equals
			left: '{{variable.environment}}'
			right: 'production'
		- type: equals
			left: '{{steps.security-check.vulnerabilities.critical}}'
			right: 0
		- type: greater_than
			left: '{{steps.performance-test.metrics.responseTime}}'
			right: 200
```

#### Branching Logic Examples

Common branching patterns for different scenarios:

```yaml
# Deploy based on environment and test results
- id: deployment-check
	name: Check Deployment Readiness
	type: condition
	config:
		expression:
			type: and
			conditions:
				- type: equals
					left: '{{variable.environment}}'
					right: 'production'
				- type: equals
					left: '{{steps.tests.result}}'
					right: 'success'
				- type: equals
					left: '{{steps.security-scan.vulnerabilities.critical}}'
					right: 0
		onTrue: ['deploy-production', 'notify-deployment']
		onFalse: ['deploy-staging', 'notify-staging']
	dependsOn: ['tests', 'security-scan']

# Feature flag controlled execution
- id: feature-check
	name: Check Feature Flag
	type: condition
	config:
		expression:
			type: or
			conditions:
				- type: equals
					left: '{{variable.featureEnabled}}'
					right: true
				- type: contains
					left: '{{variable.enabledFeatures}}'
					right: 'new-ui'
		onTrue: ['run-feature-tests', 'deploy-with-feature']
		onFalse: ['skip-feature-tests']

# Error handling and retry logic
- id: build-status-check
	name: Check Build Status
	type: condition
	config:
		expression:
			type: not
			conditions:
				- type: equals
					left: '{{steps.build.result}}'
					right: 'failed'
		onTrue: ['proceed-to-test']
		onFalse: ['retry-build', 'notify-build-failure']
		continueOnError: true  # Continue workflow even if condition evaluation fails

# Multi-stage deployment approval
- id: approval-check
	name: Check Deployment Approval
	type: condition
	config:
		expression:
			type: and
			conditions:
				- type: exists
					left: '{{variable.approvalToken}}'
				- type: equals
					left: '{{variable.approvedBy}}'
					right: 'deployment-manager'
				- type: greater_than
					left: '{{variable.approvalTimestamp}}'
					right: '{{variable.buildTimestamp}}'
		onTrue: ['deploy-production']
		onFalse: ['request-approval', 'notify-pending-approval']
```

#### Advanced Condition Features

**Error Handling:**
```yaml
- id: resilient-condition
	name: Resilient Condition Check
	type: condition
	config:
		expression:
			type: equals
			left: '{{steps.flaky-service.status}}'
			right: 'healthy'
		onTrue: ['proceed-with-service']
		onFalse: ['use-fallback-service']
		continueOnError: true  # Continue on evaluation errors
		timeout: 10000         # 10 second timeout
```

**Context Variable Setting:**
Condition steps automatically set context variables for use by subsequent steps:
- `condition_<step-id>_result`: Boolean result of the condition
- `condition_<step-id>_triggered_steps`: Array of step IDs that were triggered

```yaml
# Later steps can reference condition results
- id: cleanup
	name: Cleanup Resources
	type: script
	config:
		command: cleanup.sh
		args: ['--mode', '{{variable.condition_deployment-check_result}}']
	condition: '{{variable.condition_deployment-check_triggered_steps}}.includes("deploy-production")'
```

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

## Conditional Execution and Branching

The workflow system supports sophisticated conditional execution through dedicated condition steps that can evaluate complex expressions and trigger different execution paths.

### Simple Conditional Execution

Use condition steps to make branching decisions:

```yaml
steps:
	- id: check-environment
		name: Check Deployment Environment
		type: condition
		config:
			expression:
				type: equals
				left: '{{variable.environment}}'
				right: 'production'
			onTrue: ['deploy-production', 'notify-production']
			onFalse: ['deploy-staging']
		dependsOn: ['run-tests']

	- id: deploy-production
		name: Deploy to Production
		type: script
		config:
			command: deploy-prod.sh
		# This step only runs if check-environment condition is true

	- id: deploy-staging
		name: Deploy to Staging
		type: script
		config:
			command: deploy-staging.sh
		# This step only runs if check-environment condition is false
```

### Complex Conditional Logic

Combine multiple factors for sophisticated decision making:

```yaml
steps:
	- id: deployment-readiness-check
		name: Check Deployment Readiness
		type: condition
		config:
			expression:
				type: and
				conditions:
					- type: equals
						left: '{{steps.tests.result}}'
						right: 'success'
					- type: greater_than_or_equal
						left: '{{steps.tests.coverage}}'
						right: 85
					- type: not_contains
						left: '{{steps.security-scan.issues}}'
						right: 'critical'
					- type: or
						conditions:
							- type: equals
								left: '{{variable.branch}}'
								right: 'main'
							- type: equals
								left: '{{variable.branch}}'
								right: 'release'
			onTrue: ['deploy-production', 'update-changelog', 'notify-success']
			onFalse: ['deploy-staging', 'create-issue', 'notify-failure']
		dependsOn: ['tests', 'security-scan']
		continueOnError: false

	# Multiple parallel branches can be triggered
	- id: deploy-production
		name: Deploy to Production
		type: script
		config:
			command: kubectl apply -f production/
		parallel:
			enabled: true

	- id: update-changelog
		name: Update Changelog
		type: script
		config:
			command: update-changelog.sh
			args: ['--version', '{{variable.version}}']
		parallel:
			enabled: true

	- id: notify-success
		name: Send Success Notification
		type: agent
		config:
			agent: notification-sender
			prompt: "🎉 Production deployment successful! Version {{variable.version}}"
		parallel:
			enabled: true
```

### Failure Recovery and Retry Logic

Use conditions for sophisticated error handling:

```yaml
steps:
	- id: build-project
		name: Build Project
		type: script
		config:
			command: npm run build
		continueOnError: true

	- id: check-build-result
		name: Check Build Result
		type: condition
		config:
			expression:
				type: equals
				left: '{{steps.build-project.result}}'
				right: 'success'
			onTrue: ['run-tests']
			onFalse: ['retry-build']
		dependsOn: ['build-project']

	- id: retry-build
		name: Retry Build with Cache Clear
		type: script
		config:
			command: npm run build
			args: ['--no-cache']
		continueOnError: true

	- id: check-retry-result
		name: Check Retry Result
		type: condition
		config:
			expression:
				type: equals
				left: '{{steps.retry-build.result}}'
				right: 'success'
			onTrue: ['run-tests']
			onFalse: ['notify-build-failure', 'create-incident']
		dependsOn: ['retry-build']
```
