# Workflow Plugin Development Guide

This guide explains how to create custom step types for the GHCCLI workflow system using the plugin architecture.

## Overview

The GHCCLI workflow plugin system allows third-party developers to create custom step types that can be used in workflow definitions. Plugins are dynamically discovered, loaded, and executed in a secure sandbox environment.

## Plugin Architecture

### Core Components

- **StepTypePlugin**: Abstract base class for all plugins
- **PluginRegistry**: Manages plugin registration and discovery
- **PluginLoader**: Handles plugin discovery and loading from filesystem
- **PluginSandbox**: Provides secure execution environment for plugins

## Creating a Plugin

### 1. Plugin Structure

Create a plugin by extending the `StepTypePlugin` class:

```typescript
import { StepTypePlugin, StepTypePluginMetadata } from '@google/gemini-cli-core/workflow/plugins';
import { StepExecutor } from '@google/gemini-cli-core/workflow/StepExecutor';
import { WorkflowStep } from '@google/gemini-cli-core/workflow/types';

export class MyCustomPlugin extends StepTypePlugin {
  constructor() {
    const metadata: StepTypePluginMetadata = {
      name: 'my-custom-plugin',
      version: '1.0.0',
      description: 'Description of what this plugin does',
      author: 'Your Name',
      license: 'Apache-2.0',
      supportedStepTypes: ['my-step-type'],
      capabilities: {
        concurrent: true,
        timeout: true,
        retry: true,
        conditional: true
      }
    };

    super(metadata);
  }

  createStepExecutor(stepType: string): StepExecutor | null {
    if (stepType === 'my-step-type') {
      return new MyStepExecutor();
    }
    return null;
  }

  validateStepConfig(step: WorkflowStep): { valid: boolean; errors: string[] } {
    // Implement validation logic
    return { valid: true, errors: [] };
  }
}
```

### 2. Step Executor Implementation

Create a step executor that implements the actual logic:

```typescript
import { StepExecutor } from '@google/gemini-cli-core/workflow/StepExecutor';
import { WorkflowStep } from '@google/gemini-cli-core/workflow/types';
import { WorkflowContext } from '@google/gemini-cli-core/workflow/WorkflowContext';

interface MyStepConfig {
  parameter1: string;
  parameter2?: number;
}

class MyStepExecutor extends StepExecutor {
  getSupportedType(): string {
    return 'my-step-type';
  }

  validate(step: WorkflowStep): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = step.config as unknown as MyStepConfig;

    if (!config.parameter1) {
      errors.push('parameter1 is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async execute(step: WorkflowStep, context: WorkflowContext): Promise<any> {
    const config = step.config as unknown as MyStepConfig;
    
    // Implement your step logic here
    const result = await this.doSomething(config);
    
    return result;
  }

  private async doSomething(config: MyStepConfig): Promise<any> {
    // Your implementation
    return { message: `Processed ${config.parameter1}` };
  }
}
```

### 3. Plugin Export

Export a factory function for plugin creation:

```typescript
export function createPlugin(): MyCustomPlugin {
  return new MyCustomPlugin();
}
```

## Plugin Manifest

### Using ghccli-plugin.json

Create a `ghccli-plugin.json` file in your plugin directory:

```json
{
  "name": "my-custom-plugin",
  "version": "1.0.0",
  "main": "index.js",
  "stepTypes": ["my-step-type"],
  "description": "My custom workflow step plugin",
  "author": "Your Name",
  "license": "Apache-2.0",
  "keywords": ["ghccli", "workflow", "plugin"],
  "engines": {
    "node": ">=18.0.0",
    "ghccli": ">=0.1.0"
  },
  "config": {
    "enabled": true,
    "sandboxed": true
  }
}
```

### Using package.json

Alternatively, add plugin metadata to your `package.json`:

```json
{
  "name": "my-custom-plugin",
  "version": "1.0.0",
  "keywords": ["ghccli-plugin"],
  "ghccliPlugin": {
    "main": "dist/index.js",
    "stepTypes": ["my-step-type"],
    "config": {
      "enabled": true,
      "sandboxed": true
    }
  }
}
```

## Plugin Discovery

Plugins are automatically discovered from:

- `./plugins` directory
- `./node_modules` (packages with `ghccli-plugin` keyword)

### Manual Plugin Loading

You can also load plugins programmatically:

```typescript
import { PluginRegistry, PluginLoader } from '@google/gemini-cli-core/workflow/plugins';

const registry = new PluginRegistry();
const loader = new PluginLoader(registry);

// Load from specific path
await loader.loadPluginFromPath('./my-plugin');

// Auto-discover and load all plugins
await loader.loadAllDiscoveredPlugins();
```

## Security and Sandboxing

### Sandbox Environment

Plugins run in a restricted sandbox that:

- Limits access to Node.js modules
- Restricts network access
- Controls filesystem access
- Monitors resource usage
- Provides isolated console logging

### Security Best Practices

1. **Minimize Permissions**: Only request access to resources you actually need
2. **Validate Input**: Always validate step configuration and context data
3. **Handle Errors**: Implement proper error handling and recovery
4. **Limit Resource Usage**: Be mindful of memory and CPU usage
5. **No Sensitive Data**: Never log or expose sensitive information

## Example Plugins

### HTTP Request Plugin

```typescript
// See: packages/core/src/workflow/plugins/examples/HttpStepPlugin.ts
export class HttpStepPlugin extends StepTypePlugin {
  // Enables making HTTP requests in workflows
}
```

### Delay/Wait Plugin

```typescript
// See: packages/core/src/workflow/plugins/examples/DelayStepPlugin.ts
export class DelayStepPlugin extends StepTypePlugin {
  // Adds timing control to workflows
}
```

## Using Plugins in Workflows

Once installed, plugins can be used in workflow definitions:

```yaml
name: Example Workflow
version: "1.0"
steps:
  - id: fetch-data
    name: Fetch API Data
    type: http
    config:
      url: https://api.example.com/data
      method: GET
      headers:
        Authorization: "Bearer {{env.API_TOKEN}}"

  - id: wait
    name: Wait for Processing
    type: delay
    config:
      duration: 5
      unit: seconds
      message: "Waiting for data processing..."

  - id: custom-processing
    name: Custom Processing
    type: my-step-type
    config:
      parameter1: "{{steps.fetch-data.data}}"
      parameter2: 42
```

## Plugin Lifecycle

1. **Discovery**: Plugin loader scans configured directories
2. **Validation**: Plugin manifests and exports are validated
3. **Registration**: Valid plugins are registered in the plugin registry
4. **Integration**: Step executors are registered with the workflow runner
5. **Execution**: Plugins execute steps within sandbox constraints
6. **Cleanup**: Resources are cleaned up when workflows complete

## Troubleshooting

### Common Issues

1. **Plugin Not Found**: Check manifest file and export structure
2. **Validation Errors**: Review step configuration validation logic
3. **Sandbox Restrictions**: Verify required permissions are granted
4. **Type Errors**: Ensure proper TypeScript type definitions

### Debugging

Enable plugin debugging:

```typescript
const registry = new PluginRegistry({
  enableSandboxing: false  // Disable for debugging only
});
```

## API Reference

### StepTypePlugin

- `createStepExecutor(stepType: string): StepExecutor | null`
- `validateStepConfig(step: WorkflowStep): ValidationResult`
- `initialize(): Promise<void>`
- `shutdown(): Promise<void>`

### StepExecutor

- `execute(step: WorkflowStep, context: WorkflowContext): Promise<any>`
- `validate(step: WorkflowStep): ValidationResult`
- `getSupportedType(): string`

### PluginRegistry

- `registerPlugin(plugin: StepTypePlugin): Promise<RegistrationResult>`
- `getPlugin(name: string): StepTypePlugin | undefined`
- `getSupportedStepTypes(): string[]`

For complete API documentation, see the TypeScript definitions in the source code.