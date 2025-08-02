# Workflow Error Handling and Logging

This guide covers the comprehensive error handling, logging, and monitoring capabilities added to the workflow system in Phase 2.4. These features provide enterprise-grade reliability, observability, and debugging capabilities for workflow execution.

## Overview

The workflow system now includes:

- **🚨 Structured Error Handling** - Workflow-specific error types with actionable context
- **📊 Comprehensive Logging** - Detailed execution logging with telemetry integration
- **🔄 Retry Logic** - Intelligent retry mechanisms with exponential backoff
- **🛑 Graceful Shutdown** - State preservation and resource cleanup
- **📈 Performance Metrics** - Execution timing, resource utilization, and bottleneck analysis

## Error Handling

### Workflow-Specific Error Types

The system provides specialized error types that include structured context for better debugging and monitoring:

```typescript
import { 
  WorkflowError,
  WorkflowStepError,
  WorkflowTimeoutError,
  WorkflowCancelledError,
  WorkflowDependencyError,
  WorkflowExecutorError,
  WorkflowConfigurationError,
  WorkflowParallelExecutionError,
  WorkflowResourceError
} from '@google/gemini-cli-core/workflow';
```

#### Error Context Information

All workflow errors include:
- **Workflow ID** - Unique identifier for the workflow execution
- **Step ID** - Specific step where the error occurred (when applicable)
- **Error Code** - Structured error code for programmatic handling
- **Context** - Additional metadata about the error
- **Structured Serialization** - JSON-exportable error details

```typescript
// Example error with full context
const stepError = new WorkflowStepError(
  'Step execution failed: Connection timeout',
  step,
  'workflow-123',
  originalError,
  { 
    attempt: 2,
    timeout: 30000,
    resource: 'database'
  }
);

console.log(stepError.toJSON());
// {
//   "name": "WorkflowStepError",
//   "message": "Step execution failed: Connection timeout",
//   "code": "WORKFLOW_STEP_ERROR",
//   "workflowId": "workflow-123",
//   "stepId": "database-migration",
//   "step": { "id": "database-migration", "name": "Run Migration", "type": "script" },
//   "context": { "attempt": 2, "timeout": 30000, "resource": "database" },
//   "originalError": { "name": "Error", "message": "Connection timeout" }
// }
```

#### Error Types Reference

| Error Type | When It Occurs | Key Properties |
|------------|----------------|----------------|
| `WorkflowValidationError` | Invalid workflow definition | `workflowId` |
| `WorkflowStepError` | Step execution failure | `step`, `originalError` |
| `WorkflowTimeoutError` | Step or workflow timeout | `timeoutMs` |
| `WorkflowCancelledError` | Workflow cancellation | `workflowId`, `stepId` |
| `WorkflowDependencyError` | Failed step dependencies | `failedDependencies[]` |
| `WorkflowExecutorError` | Missing step executor | `stepType` |
| `WorkflowConfigurationError` | Invalid configuration | `workflowId` |
| `WorkflowParallelExecutionError` | Parallel execution failure | `failedSteps[]`, `errors[]` |
| `WorkflowResourceError` | Resource limit exceeded | `resource`, `limit`, `current` |

### Enhanced Error Handling in WorkflowRunner

The `WorkflowRunner` now provides comprehensive error handling with detailed context:

```typescript
const runner = new WorkflowRunner();

try {
  const result = await runner.execute(workflow, {
    enableLogging: true,
    enableMetrics: true,
    retryOptions: {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000
    }
  });

  if (!result.success) {
    console.error('Workflow failed:', result.error);
    
    // Access detailed step results
    for (const [stepId, stepResult] of Object.entries(result.stepResults)) {
      if (!stepResult.success) {
        console.error(`Step ${stepId} failed:`, stepResult.error);
        console.error(`Execution time: ${stepResult.executionTime}ms`);
      }
    }
  }
} catch (error) {
  if (error instanceof WorkflowError) {
    console.error('Workflow Error:', error.toJSON());
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Logging System

### Structured Workflow Logging

The logging system provides comprehensive execution tracking with structured output:

```typescript
import { WorkflowLogger, WorkflowLogLevel } from '@google/gemini-cli-core/workflow';

// Logging is automatically enabled by default
const result = await runner.execute(workflow, {
  enableLogging: true,     // Enable structured logging (default: true)
  enableTelemetry: true    // Enable telemetry integration (default: true)
});

// Access the logger
const logger = runner.getLogger();
if (logger) {
  // Get execution metrics
  const metrics = logger.getMetrics();
  console.log('Workflow metrics:', metrics);
  
  // Get log entries
  const logEntries = logger.getLogEntries();
  console.log('Execution logs:', logEntries);
  
  // Get logs for specific step
  const stepLogs = logger.getStepLogEntries('build-step');
  
  // Export all logs as JSON
  const exportedLogs = logger.exportLogs();
}
```

### Log Levels and Filtering

The system uses structured log levels for different types of events:

```typescript
enum WorkflowLogLevel {
  ERROR = 'error',    // Workflow and step failures
  WARN = 'warn',      // Warnings, retries, resource issues
  INFO = 'info',      // Workflow and step lifecycle events
  DEBUG = 'debug',    // Detailed execution information
  TRACE = 'trace'     // Very detailed debugging information
}

// Filter logs by level
const errorLogs = logger.getLogEntriesByLevel(WorkflowLogLevel.ERROR);
const warningLogs = logger.getLogEntriesByLevel(WorkflowLogLevel.WARN);
```

### Log Entry Structure

Each log entry contains structured information:

```typescript
interface WorkflowLogEntry {
  timestamp: string;           // ISO 8601 timestamp
  level: WorkflowLogLevel;     // Log level
  message: string;             // Human-readable message
  context: {                   // Execution context
    workflowId: string;
    stepId?: string;
    phase?: 'init' | 'validation' | 'execution' | 'cleanup' | 'completed' | 'failed';
    executionTime?: number;
    metadata?: Record<string, unknown>;
  };
  error?: WorkflowError;       // Associated error (if any)
  data?: Record<string, unknown>; // Additional structured data
}
```

### Telemetry Integration

The logging system integrates with the existing telemetry infrastructure:

```typescript
// Telemetry events are automatically logged for:
// - Workflow initialization and completion
// - Step start, completion, and failure
// - Retry attempts
// - Resource utilization
// - Performance metrics

// Note: Full telemetry integration requires Config object
// Current implementation provides telemetry hooks
```

## Retry Logic

### Intelligent Retry Mechanisms

The system includes sophisticated retry logic with exponential backoff and circuit breaker patterns:

```typescript
import { WorkflowRetryManager, createWorkflowRetryManager } from '@google/gemini-cli-core/workflow';

// Configure retry behavior
const result = await runner.execute(workflow, {
  retryOptions: {
    enableRetry: true,           // Enable retry logic (default: true)
    maxAttempts: 5,             // Maximum retry attempts (default: 3)
    initialDelayMs: 1000,       // Initial delay (default: 1000ms)
    maxDelayMs: 30000,          // Maximum delay (default: 10000ms)
    stepSpecificRetry: {        // Step-specific retry configuration
      'database-migration': {
        maxAttempts: 2,
        initialDelayMs: 5000
      },
      'api-call': {
        maxAttempts: 10,
        initialDelayMs: 500,
        maxDelayMs: 5000
      }
    }
  }
});
```

### Retryable Error Detection

The system automatically identifies retryable errors:

```typescript
import { isRetryableError } from '@google/gemini-cli-core/workflow';

// Automatically retried errors:
// - Network errors (ECONNRESET, ENOTFOUND, ETIMEDOUT)
// - HTTP errors (429, 502, 503, 504)
// - Timeout errors

// Non-retryable errors:
// - Validation errors
// - Configuration errors
// - Cancelled workflows
// - Missing executors

const shouldRetry = isRetryableError(error);
```

### Circuit Breaker Pattern

Prevent cascading failures with circuit breaker functionality:

```typescript
// Circuit breaker automatically activates after repeated failures
// - Default: 5 consecutive failures trigger open circuit
// - Timeout: 60 seconds before attempting half-open state
// - Auto-recovery when operations succeed

// Circuit breaker state tracking
const retryManager = createWorkflowRetryManager();
const state = retryManager.getCircuitBreakerState();
console.log('Circuit breaker state:', state);
// { state: 'closed', failureCount: 0, lastFailureTime: 0 }
```

## Graceful Shutdown

### Shutdown Management

Handle process termination gracefully with state preservation:

```typescript
import { WorkflowShutdownManager, GlobalWorkflowShutdownManager } from '@google/gemini-cli-core/workflow';

// Graceful shutdown is enabled by default
const result = await runner.execute(workflow, {
  enableGracefulShutdown: true  // Enable shutdown handling (default: true)
});

// Shutdown managers automatically:
// - Register signal handlers (SIGINT, SIGTERM)
// - Wait for current steps to complete
// - Save workflow state
// - Clean up resources
// - Handle uncaught exceptions and rejections
```

### Shutdown Handlers

Register custom shutdown handlers for cleanup:

```typescript
const shutdownManager = new WorkflowShutdownManager(workflowId, logger);

shutdownManager.addShutdownHandler({
  async onShutdownStarted(state) {
    console.log('Shutdown initiated for workflow:', state.workflowId);
  },
  
  async onStateSaved(state) {
    console.log('Workflow state saved:', state.completedSteps.length, 'steps completed');
  },
  
  async onShutdownComplete(state) {
    console.log('Shutdown complete. Duration:', state.shutdownTime - state.startTime, 'ms');
  }
});
```

### Force Shutdown

For emergency situations, force immediate shutdown:

```typescript
// Emergency shutdown bypasses graceful waiting
await shutdownManager.forceShutdown('Emergency stop requested');
```

## Performance Metrics

### Execution Metrics Collection

Comprehensive performance tracking and analysis:

```typescript
// Metrics collection is enabled by default
const result = await runner.execute(workflow, {
  enableMetrics: true  // Enable metrics collection (default: true)
});

// Access metrics from result
if (result.metrics) {
  const metrics = result.metrics as WorkflowExecutionMetrics;
  
  console.log('Workflow Metrics:');
  console.log(`- Total duration: ${metrics.totalDuration}ms`);
  console.log(`- Completed steps: ${metrics.completedSteps}/${metrics.totalSteps}`);
  console.log(`- Failed steps: ${metrics.failedSteps}`);
  console.log(`- Retried steps: ${metrics.retriedSteps}`);
  console.log(`- Peak memory: ${(metrics.memoryPeak / 1024 / 1024).toFixed(2)}MB`);
  console.log(`- Average CPU: ${metrics.averageCpuUsage.toFixed(2)}%`);
}
```

### Step-Level Metrics

Detailed timing and resource usage for each step:

```typescript
// Access step metrics
for (const [stepId, stepMetrics] of metrics.stepMetrics) {
  console.log(`Step ${stepId}:`);
  console.log(`  - Duration: ${stepMetrics.duration}ms`);
  console.log(`  - Retry count: ${stepMetrics.retryCount}`);
  console.log(`  - Success: ${stepMetrics.success}`);
  
  if (stepMetrics.memoryUsage) {
    console.log(`  - Memory used: ${(stepMetrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
  }
  
  if (stepMetrics.parallelGroup !== undefined) {
    console.log(`  - Parallel group: ${stepMetrics.parallelGroup}`);
  }
}
```

### Performance Analysis

Identify bottlenecks and optimization opportunities:

```typescript
import { WorkflowMetricsAnalyzer } from '@google/gemini-cli-core/workflow';

// Analyze performance bottlenecks
const analysis = WorkflowMetricsAnalyzer.analyzeBottlenecks(metrics);

console.log('Performance Analysis:');
console.log(`- Efficiency score: ${analysis.efficiencyScore}/100`);

console.log('Slowest steps:');
analysis.slowestSteps.forEach((step, index) => {
  console.log(`  ${index + 1}. ${step.stepName}: ${step.duration}ms`);
});

console.log('Resource bottlenecks:', analysis.resourceBottlenecks);
console.log('Recommendations:');
analysis.recommendations.forEach(rec => console.log(`  - ${rec}`));
```

### Metrics Comparison

Compare performance across workflow runs:

```typescript
// Compare with previous execution
const comparison = WorkflowMetricsAnalyzer.compareMetrics(currentMetrics, previousMetrics);

console.log('Performance Comparison:');
console.log(`- Duration change: ${(comparison.durationChange * 100).toFixed(1)}%`);
console.log(`- Success rate change: ${(comparison.successRateChange * 100).toFixed(1)}%`);
console.log(`- Overall performance: ${comparison.performanceChange}`);

console.log('Improvements:');
comparison.improvements.forEach(imp => console.log(`  ✅ ${imp}`));

console.log('Regressions:');
comparison.regressions.forEach(reg => console.log(`  ❌ ${reg}`));
```

## Configuration Options

### Workflow Execution Options

Configure error handling, logging, and monitoring behavior:

```typescript
interface WorkflowExecutionOptions {
  // Existing options
  timeout?: number;
  continueOnError?: boolean;
  variables?: Record<string, unknown>;
  parallelEnabled?: boolean;
  maxConcurrency?: number;
  
  // New error handling and logging options
  enableLogging?: boolean;           // Enable structured logging (default: true)
  enableTelemetry?: boolean;         // Enable telemetry integration (default: true)  
  enableMetrics?: boolean;           // Enable metrics collection (default: true)
  enableGracefulShutdown?: boolean;  // Enable graceful shutdown (default: true)
  retryOptions?: WorkflowRetryOptions; // Retry configuration
}
```

### Retry Configuration

Detailed retry behavior configuration:

```typescript
interface WorkflowRetryOptions {
  enableRetry?: boolean;                    // Enable retry logic (default: true)
  maxAttempts?: number;                     // Max retry attempts (default: 3)
  initialDelayMs?: number;                  // Initial delay (default: 1000ms)
  maxDelayMs?: number;                      // Maximum delay (default: 10000ms)
  stepSpecificRetry?: Record<string, Partial<RetryOptions>>; // Per-step config
}
```

## Best Practices

### Error Handling Best Practices

1. **Use Appropriate Error Types**: Choose specific error types for better debugging
2. **Include Context**: Add relevant metadata to error contexts
3. **Handle Errors Gracefully**: Use `continueOnError` for non-critical steps
4. **Monitor Error Patterns**: Analyze error logs for recurring issues
5. **Set Reasonable Timeouts**: Prevent indefinite hanging

### Logging Best Practices

1. **Enable Logging**: Always enable structured logging in production
2. **Monitor Log Levels**: Use appropriate log levels for different events
3. **Export Logs**: Save execution logs for post-mortem analysis
4. **Filter Effectively**: Use log filtering for targeted debugging
5. **Correlate with Metrics**: Combine logs with metrics for comprehensive analysis

### Retry Logic Best Practices

1. **Configure Appropriately**: Set reasonable retry limits and delays
2. **Identify Retryable Errors**: Understand which errors should be retried
3. **Use Step-Specific Config**: Configure retries per step based on requirements
4. **Monitor Circuit Breakers**: Watch for circuit breaker activations
5. **Balance Resilience and Speed**: Don't over-retry fast-failing operations

### Performance Monitoring Best Practices

1. **Enable Metrics**: Always collect performance metrics
2. **Analyze Regularly**: Review metrics after significant changes
3. **Compare Over Time**: Track performance trends across executions
4. **Optimize Bottlenecks**: Address identified performance issues
5. **Resource Planning**: Use resource utilization data for capacity planning

## Troubleshooting

### Common Issues and Solutions

#### High Retry Rates
```typescript
// Check retry statistics
const metrics = runner.getMetrics();
if (metrics && metrics.retriedSteps > metrics.totalSteps * 0.3) {
  console.warn('High retry rate detected:', metrics.retriedSteps, 'retries');
  // Consider reviewing network connectivity, timeouts, or external dependencies
}
```

#### Memory Issues
```typescript
// Monitor memory usage
const performanceStats = metricsCollector.getPerformanceStats();
if (performanceStats.peakMemoryUsage > 1024 * 1024 * 1024) { // 1GB
  console.warn('High memory usage detected:', performanceStats.peakMemoryUsage);
  // Consider breaking down large steps or adjusting concurrency
}
```

#### Timeout Problems
```typescript
// Analyze step timeouts
const timeoutErrors = logger.getLogEntriesByLevel(WorkflowLogLevel.ERROR)
  .filter(entry => entry.error instanceof WorkflowTimeoutError);

if (timeoutErrors.length > 0) {
  console.log('Timeout errors detected:');
  timeoutErrors.forEach(entry => {
    console.log(`- Step ${entry.context.stepId}: ${entry.error?.message}`);
  });
}
```

#### Resource Bottlenecks
```typescript
// Check resource utilization
logger.getLogEntries().forEach(entry => {
  if (entry.message.includes('Resource utilization') && entry.level === WorkflowLogLevel.WARN) {
    console.warn('Resource bottleneck:', entry.message);
  }
});
```

### Debug Mode

Enable verbose logging for debugging:

```typescript
import { setGlobalLoggerConfig, LogLevel } from '@google/gemini-cli-core/workflow';

// Enable verbose debug logging
setGlobalLoggerConfig({
  debugEnabled: true,
  debugLevel: LogLevel.VERBOSE,
  isNonInteractive: false
});
```

## Migration Guide

### Updating Existing Workflows

Existing workflows automatically benefit from the new error handling and logging without changes. To take full advantage:

1. **Update Execution Options**:
```typescript
// Before
const result = await runner.execute(workflow);

// After  
const result = await runner.execute(workflow, {
  enableLogging: true,
  enableMetrics: true,
  retryOptions: {
    maxAttempts: 3,
    initialDelayMs: 1000
  }
});
```

2. **Add Error Handling**:
```typescript
try {
  const result = await runner.execute(workflow, options);
  
  // Check for metrics
  if (result.metrics) {
    analyzePerformance(result.metrics);
  }
  
} catch (error) {
  if (error instanceof WorkflowError) {
    console.error('Workflow error:', error.toJSON());
  }
  throw error;
}
```

3. **Monitor and Analyze**:
```typescript
// Access new monitoring capabilities
const logger = runner.getLogger();
const metrics = runner.getMetrics();

if (logger && metrics) {
  // Export for analysis
  const logs = logger.exportLogs();
  const metricsExport = metricsCollector.exportMetrics();
  
  // Save for historical analysis
  await saveExecutionData(logs, metricsExport);
}
```

The new error handling and logging system provides comprehensive observability and reliability for workflow execution, making it easier to debug issues, monitor performance, and ensure robust automation workflows.