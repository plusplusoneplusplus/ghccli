
# Workflow System

Welcome! This documentation lets you define and execute automation workflows using YAML configuration files, with robust dependency resolution, error handling, status tracking, and support for both script and agent-based steps.

## 📚 Documentation Structure

- **[Workflow Definition](./workflow-definition.md)** - Core workflow structure, step types, and dependencies
- **[Variable Interpolation](./variable-interpolation.md)** - Dynamic configuration with variables, functions, and data access
- **[Conditional Steps & Branching](./conditional-steps.md)** - Complex conditional logic and branching patterns
- **[Parallel Execution & Resource Management](./parallel-and-resources.md)** - Parallel execution and resource constraints  
- **[Error Handling & Logging](./error-handling-and-logging.md)** - Error handling, logging, retry logic, and monitoring
- **[CLI Integration & Advanced Features](./cli-and-advanced.md)** - CLI commands, monitoring, reporting, and best practices

## 🚀 Quick Start

1. **Create a workflow** - Define your automation in a YAML file with `name`, `version`, and `steps`
2. **Run the workflow** - Use `/workflow run <name>` to execute
3. **Monitor progress** - Use `/workflow status <name>` to check execution status

## 📋 Key Features

- **Multiple Step Types**: Script execution, AI agent integration, and conditional logic
- **Variable Interpolation**: Dynamic configuration with `{{variables}}`, built-in functions, and data access
- **Dependency Management**: Define step execution order and dependencies
- **Parallel Execution**: Automatic parallel detection with resource management
- **Error Handling**: Sophisticated error handling, retry logic, and graceful shutdown
- **Monitoring**: Real-time progress tracking, logging, and performance metrics
- **CLI Integration**: Built-in commands for workflow management and execution

## 📖 Example Workflow

```yaml
name: Dynamic Build Pipeline
version: 1.0.0

env:
  NODE_ENV: "production"

steps:
  - id: install
    name: Install Dependencies
    type: script
    config:
      command: npm
      args: ["install"]
      env:
        BUILD_ID: "build-{{date()}}-{{timestamp()}}"

  - id: test
    name: Run Tests
    type: script
    config:
      command: npm
      args: ["run", "test:{{env.NODE_ENV}}"]
      timeout: "{{multiply(30000, 2)}}"
    dependsOn: ["install"]

  - id: build
    name: Build Application  
    type: script
    config:
      command: npm
      args: ["run", "build"]
      env:
        BUILD_VERSION: "{{version}}-{{date('YYYYMMDD')}}"
        OUTPUT_DIR: "{{joinPath('dist', env.NODE_ENV)}}"
    dependsOn: ["test"]

  - id: notify
    name: Send Notification
    type: agent
    config:
      agent: slack-notifier
      prompt: "Build completed! Version {{steps.build.env.BUILD_VERSION}} deployed to {{upper(env.NODE_ENV)}}"
    dependsOn: ["build"]
```

See the detailed documentation files above for comprehensive examples and configuration options.