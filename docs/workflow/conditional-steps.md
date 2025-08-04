# Conditional Steps and Branching Logic

The workflow system provides powerful conditional execution capabilities through dedicated condition steps that can evaluate complex expressions and trigger different execution paths based on variables, step outputs, and sophisticated boolean logic.

## Overview

Condition steps allow you to:
- **Evaluate expressions** based on workflow variables and step outputs
- **Make branching decisions** that trigger different sets of steps
- **Implement retry logic** and error handling patterns
- **Support complex boolean expressions** with AND, OR, and NOT operators
- **Reference nested data structures** in variables and step outputs

## Basic Syntax

```yaml
- id: condition-step-id
  name: Descriptive Condition Name
  type: condition
  config:
    expression: <ConditionExpression>
    onTrue: [list-of-step-ids]
    onFalse: [list-of-step-ids]
    continueOnError: boolean
    timeout: number
  dependsOn: [dependency-step-ids]
```

## Expression Types

### Simple Operators

#### Equality Operators
```yaml
# Exact equality
expression:
  type: equals
  left: '{{variable.status}}'
  right: 'success'

# Inequality  
expression:
  type: not_equals
  left: '{{steps.build.exitCode}}'
  right: 0
```

#### Contains Operators
```yaml
# String contains
expression:
  type: contains
  left: '{{steps.test.output}}'
  right: 'PASSED'

# Array contains
expression:
  type: contains
  left: '{{variable.features}}'
  right: 'dark-mode'

# Object property exists
expression:
  type: contains
  left: '{{steps.api-response.headers}}'
  right: 'authorization'

# Negated contains
expression:
  type: not_contains
  left: '{{steps.lint.errors}}'
  right: 'critical'
```

#### Existence Operators
```yaml
# Check if variable/property exists
expression:
  type: exists
  left: '{{variable.apiKey}}'

# Check if variable/property doesn't exist
expression:
  type: not_exists
  left: '{{steps.optional-step.result}}'
```

#### Numeric Comparison Operators
```yaml
# Greater than
expression:
  type: greater_than
  left: '{{steps.performance.score}}'
  right: 90

# Less than
expression:
  type: less_than
  left: '{{variable.timeout}}'
  right: 300

# Greater than or equal
expression:
  type: greater_than_or_equal
  left: '{{steps.test.coverage}}'
  right: 85

# Less than or equal
expression:
  type: less_than_or_equal
  left: '{{variable.retryCount}}'
  right: 3
```

#### Regular Expression Operators
```yaml
# Regex match
expression:
  type: matches
  left: '{{variable.version}}'
  right: '^v\d+\.\d+\.\d+$'

# Regex no match
expression:
  type: not_matches
  left: '{{steps.lint.output}}'
  right: 'error|ERROR|warning'
```

### Boolean Logic Expressions

#### AND Expressions
All conditions must be true:
```yaml
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
```

#### OR Expressions  
At least one condition must be true:
```yaml
expression:
  type: or
  conditions:
    - type: equals
      left: '{{variable.branch}}'
      right: 'main'
    - type: equals
      left: '{{variable.branch}}'
      right: 'master'
    - type: equals
      left: '{{variable.branch}}'
      right: 'release'
```

#### NOT Expressions
Inverts the result of the condition:
```yaml
expression:
  type: not
  conditions:
    - type: equals
      left: '{{steps.build.result}}'
      right: 'failed'
```

#### Nested Boolean Expressions
Complex combinations of logical operators:
```yaml
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

## Variable and Step Output References

### Variable References
```yaml
# Simple variable
left: '{{variable.deployTarget}}'

# Nested variable
left: '{{variable.config.database.host}}'

# Array element access
left: '{{variable.environments[0]}}'
```

### Step Output References
```yaml
# Simple step output
left: '{{steps.build.result}}'

# Nested step output
left: '{{steps.api-test.response.status}}'

# Complex nested access
left: '{{steps.analysis.results.security.vulnerabilities.critical}}'
```

### Literal Values
```yaml
# String literal
right: 'production'

# Number literal
right: 42

# Boolean literal
right: true

# Null literal
right: null
```

## Branching Patterns

### Simple Branching
```yaml
- id: environment-check
  name: Check Environment
  type: condition
  config:
    expression:
      type: equals
      left: '{{variable.env}}'
      right: 'production'
    onTrue: ['prod-deploy']
    onFalse: ['staging-deploy']
```

### Multi-Branch Logic
```yaml
- id: deployment-strategy
  name: Determine Deployment Strategy
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
          right: 90
    onTrue: ['blue-green-deploy', 'update-monitoring']
    onFalse: ['canary-deploy', 'increase-monitoring']
```

### Parallel Branch Execution
```yaml
- id: success-actions
  name: Success Actions
  type: condition
  config:
    expression:
      type: equals
      left: '{{steps.build.result}}'
      right: 'success'
    onTrue: ['deploy', 'update-docs', 'notify-team']
    # All three steps will run in parallel if condition is true
```

## Advanced Use Cases

### Feature Flag Implementation
```yaml
- id: feature-flag-check
  name: Check Feature Flags
  type: condition
  config:
    expression:
      type: or
      conditions:
        - type: equals
          left: '{{variable.featureFlags.newUI}}'
          right: true
        - type: contains
          left: '{{variable.enabledFeatures}}'
          right: 'new-ui'
    onTrue: ['deploy-with-new-ui', 'run-ui-tests']
    onFalse: ['deploy-legacy-ui']
```

### Retry Logic with Backoff
```yaml
steps:
  - id: api-call
    name: Call External API
    type: script
    config:
      command: curl
      args: ['-f', 'https://api.example.com/health']
    continueOnError: true

  - id: check-api-success
    name: Check API Call Success
    type: condition
    config:
      expression:
        type: equals
        left: '{{steps.api-call.exitCode}}'
        right: 0
      onTrue: ['proceed-with-api']
      onFalse: ['wait-and-retry']
    dependsOn: ['api-call']

  - id: wait-and-retry
    name: Wait and Retry API Call
    type: script
    config:
      command: sleep
      args: ['5']

  - id: retry-api-call
    name: Retry API Call
    type: script
    config:
      command: curl
      args: ['-f', 'https://api.example.com/health']
    dependsOn: ['wait-and-retry']
    continueOnError: true

  - id: check-retry-success
    name: Check Retry Success
    type: condition
    config:
      expression:
        type: equals
        left: '{{steps.retry-api-call.exitCode}}'
        right: 0
      onTrue: ['proceed-with-api']
      onFalse: ['handle-api-failure']
    dependsOn: ['retry-api-call']
```

### Multi-Environment Deployment
```yaml
- id: select-deployment-targets
  name: Select Deployment Targets
  type: condition
  config:
    expression:
      type: and
      conditions:
        - type: equals
          left: '{{variable.branch}}'
          right: 'main'
        - type: equals
          left: '{{steps.all-tests.result}}'
          right: 'success'
        - type: not_contains
          left: '{{steps.security-scan.vulnerabilities}}'
          right: 'critical'
    onTrue: ['deploy-staging', 'deploy-production']
    onFalse: ['deploy-development-only']
  dependsOn: ['all-tests', 'security-scan']

- id: deploy-staging
  name: Deploy to Staging
  type: script
  config:
    command: deploy.sh
    args: ['staging']
  parallel:
    enabled: true

- id: deploy-production
  name: Deploy to Production  
  type: script
  config:
    command: deploy.sh
    args: ['production']
  parallel:
    enabled: true

- id: deploy-development-only
  name: Deploy to Development
  type: script
  config:
    command: deploy.sh
    args: ['development']
```

### Quality Gate Implementation
```yaml
- id: quality-gate
  name: Quality Gate Check
  type: condition
  config:
    expression:
      type: and
      conditions:
        - type: greater_than_or_equal
          left: '{{steps.unit-tests.coverage}}'
          right: 85
        - type: greater_than_or_equal
          left: '{{steps.integration-tests.passRate}}'
          right: 95
        - type: less_than_or_equal
          left: '{{steps.performance-tests.responseTime}}'
          right: 200
        - type: equals
          left: '{{steps.security-scan.vulnerabilities.critical}}'
          right: 0
        - type: less_than_or_equal
          left: '{{steps.security-scan.vulnerabilities.high}}'
          right: 2
    onTrue: ['approve-release', 'create-release-notes']
    onFalse: ['reject-release', 'create-quality-report']
  dependsOn: [
    'unit-tests',
    'integration-tests', 
    'performance-tests',
    'security-scan'
  ]
```

## Error Handling

### Graceful Degradation
```yaml
- id: external-service-check
  name: Check External Service
  type: condition
  config:
    expression:
      type: equals
      left: '{{steps.health-check.status}}'
      right: 'healthy'
    onTrue: ['use-external-service']
    onFalse: ['use-fallback-service']
    continueOnError: true  # Continue even if condition evaluation fails
    timeout: 10000         # 10 second timeout
  dependsOn: ['health-check']
```

### Error Recovery Chains
```yaml
- id: primary-deployment
  name: Primary Deployment
  type: script
  config:
    command: deploy-primary.sh
  continueOnError: true

- id: check-primary-success
  name: Check Primary Deployment
  type: condition
  config:
    expression:
      type: equals
      left: '{{steps.primary-deployment.exitCode}}'
      right: 0
    onTrue: ['verify-deployment']
    onFalse: ['fallback-deployment']
  dependsOn: ['primary-deployment']

- id: fallback-deployment
  name: Fallback Deployment
  type: script
  config:
    command: deploy-fallback.sh
  continueOnError: true

- id: check-fallback-success
  name: Check Fallback Success
  type: condition
  config:
    expression:
      type: equals
      left: '{{steps.fallback-deployment.exitCode}}'
      right: 0
    onTrue: ['verify-deployment']
    onFalse: ['emergency-rollback']
  dependsOn: ['fallback-deployment']
```

## Context Variables

Condition steps automatically set context variables that can be referenced by subsequent steps:

### Automatic Variables
- `condition_<step-id>_result`: Boolean result of the condition evaluation
- `condition_<step-id>_triggered_steps`: Array of step IDs that were triggered

### Usage Example
```yaml
- id: deployment-check
  name: Check Deployment Readiness
  type: condition
  config:
    expression:
      type: equals
      left: '{{variable.ready}}'
      right: true
    onTrue: ['deploy']
    onFalse: ['skip-deploy']

- id: report-results
  name: Report Results
  type: script
  config:
    command: echo
    args: [
      'Deployment check result:',
      '{{variable.condition_deployment-check_result}}',
      'Triggered steps:',
      '{{variable.condition_deployment-check_triggered_steps}}'
    ]
  dependsOn: ['deployment-check']
```

## Best Practices

### Expression Design
1. **Keep expressions readable**: Use meaningful variable names and break complex logic into multiple steps
2. **Handle edge cases**: Always consider null, undefined, and empty values
3. **Use existence checks**: Check if variables exist before comparing their values
4. **Be explicit**: Use specific comparisons rather than relying on implicit truthiness

### Performance
1. **Set appropriate timeouts**: Condition evaluation should be fast, but allow time for complex expressions
2. **Minimize nested references**: Deep nesting can slow down evaluation
3. **Use efficient operators**: `exists` is faster than value comparisons for existence checks

### Maintainability
1. **Document complex logic**: Use descriptive step names and add comments
2. **Test all branches**: Ensure both onTrue and onFalse paths are tested
3. **Validate inputs**: Ensure referenced variables and step outputs exist
4. **Keep steps focused**: Each condition step should evaluate one logical concept

### Error Handling
1. **Use continueOnError wisely**: Consider whether condition failures should stop the workflow
2. **Provide fallback paths**: Always have onFalse paths for critical decisions
3. **Handle evaluation errors**: Plan for cases where condition evaluation itself fails
4. **Log decisions**: Use step names and context variables to track decision paths

## Common Patterns

### Environment-Based Deployment
```yaml
- id: environment-deployment
  name: Environment-Based Deployment
  type: condition
  config:
    expression:
      type: or
      conditions:
        - type: and
          conditions:
            - type: equals
              left: '{{variable.environment}}'
              right: 'production'
            - type: equals
              left: '{{variable.branch}}'
              right: 'main'
        - type: and
          conditions:
            - type: equals
              left: '{{variable.environment}}'
              right: 'staging'
            - type: contains
              left: ['main', 'develop', 'release']
              right: '{{variable.branch}}'
    onTrue: ['deploy-to-environment']
    onFalse: ['skip-deployment']
```

### Test Result Aggregation
```yaml
- id: aggregate-test-results
  name: Aggregate Test Results
  type: condition
  config:
    expression:
      type: and
      conditions:
        - type: equals
          left: '{{steps.unit-tests.result}}'
          right: 'success'
        - type: equals
          left: '{{steps.integration-tests.result}}'
          right: 'success'
        - type: equals
          left: '{{steps.e2e-tests.result}}'
          right: 'success'
    onTrue: ['mark-build-success']
    onFalse: ['mark-build-failed', 'analyze-failures']
```

### Feature Toggle Deployment
```yaml
- id: feature-toggle-deployment
  name: Feature Toggle Deployment
  type: condition
  config:
    expression:
      type: or
      conditions:
        - type: equals
          left: '{{variable.forceFeature}}'
          right: true
        - type: and
          conditions:
            - type: contains
              left: '{{variable.enabledUsers}}'
              right: '{{variable.currentUser}}'
            - type: less_than
              left: '{{variable.rolloutPercentage}}'
              right: 50
    onTrue: ['deploy-with-feature']
    onFalse: ['deploy-without-feature']
```

This comprehensive guide covers all aspects of conditional steps and branching logic in the workflow system, providing both reference material and practical examples for implementing sophisticated workflow control flow.