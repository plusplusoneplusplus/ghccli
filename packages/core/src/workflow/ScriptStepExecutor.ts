/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import { WorkflowStep, ScriptConfig } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';
import { StepExecutor } from './StepExecutor.js';
import { VariableInterpolator } from './VariableInterpolator.js';

export interface ScriptExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  executionTime: number;
}

/**
 * Executor for script-type workflow steps
 * Runs shell commands and scripts with configurable environment and working directory
 */
export class ScriptStepExecutor extends StepExecutor {
  private interpolator: VariableInterpolator;

  constructor() {
    super();
    this.interpolator = new VariableInterpolator();
  }

  getSupportedType(): string {
    return 'script';
  }

  validate(step: WorkflowStep): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (step.type !== 'script') {
      errors.push(`Invalid step type: expected 'script', got '${step.type}'`);
    }

    const config = step.config as ScriptConfig;
    if (!config.command) {
      errors.push('Script step must have a command');
    }

    if (typeof config.command !== 'string') {
      errors.push('Script command must be a string');
    }

    if (config.args && !Array.isArray(config.args)) {
      errors.push('Script args must be an array of strings');
    }

    if (config.args && config.args.some(arg => typeof arg !== 'string')) {
      errors.push('All script args must be strings');
    }

    if (config.timeout && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
      errors.push('Script timeout must be a positive number');
    }

    if (config.env && typeof config.env !== 'object') {
      errors.push('Script env must be an object');
    }

    if (config.workingDirectory && typeof config.workingDirectory !== 'string') {
      errors.push('Script workingDirectory must be a string');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async execute(step: WorkflowStep, context: WorkflowContext): Promise<ScriptExecutionResult> {
    const config = step.config as ScriptConfig;
    const startTime = Date.now();

    // Interpolate configuration values
    const interpolatedConfig = this.interpolateConfig(config, context);

    // Prepare environment variables
    const env = {
      ...process.env,
      ...context.getEnvironmentVariables(),
      ...interpolatedConfig.env,
      // Add workflow context variables as environment variables
      ...this.contextToEnvVars(context)
    };

    // Prepare arguments
    const args = interpolatedConfig.args || [];

    return new Promise<ScriptExecutionResult>((resolve, reject) => {
      const child = spawn(interpolatedConfig.command, args, {
        cwd: interpolatedConfig.workingDirectory || process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to start process: ${error.message}`));
      });

      child.on('close', (exitCode) => {
        const executionTime = Date.now() - startTime;
        const result: ScriptExecutionResult = {
          exitCode: exitCode || 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          executionTime
        };

        if (exitCode === 0) {
          resolve(result);
        } else {
          reject(new Error(`Script failed with exit code ${exitCode}: ${stderr || stdout}`));
        }
      });

      // Handle timeout
      if (interpolatedConfig.timeout) {
        setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Script execution timed out after ${interpolatedConfig.timeout}ms`));
        }, interpolatedConfig.timeout);
      }
    });
  }

  /**
   * Interpolate variables in script configuration
   */
  private interpolateConfig(config: ScriptConfig, context: WorkflowContext): ScriptConfig {
    const result = this.interpolator.interpolateValue(config, context);
    
    if (!result.success) {
      context.log(`Warning: Variable interpolation had errors: ${result.errors.join(', ')}`, 'warn');
    }
    
    return result.value as ScriptConfig;
  }

  /**
   * Convert workflow context variables to environment variables
   * Flattens nested objects and prefixes with WORKFLOW_
   */
  private contextToEnvVars(context: WorkflowContext): Record<string, string> {
    const envVars: Record<string, string> = {};
    const variables = context.getVariables();

    // Add workflow ID
    envVars.WORKFLOW_ID = context.getWorkflowId();

    // Add current step ID if available
    const currentStepId = context.getCurrentStepId();
    if (currentStepId) {
      envVars.WORKFLOW_CURRENT_STEP_ID = currentStepId;
    }

    // Flatten and add variables
    this.flattenObject(variables, 'WORKFLOW_VAR_', envVars);

    // Add step outputs
    const outputs = context.getAllStepOutputs();
    for (const [stepId, output] of Object.entries(outputs)) {
      const prefix = `WORKFLOW_OUTPUT_${stepId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;
      if (typeof output === 'object' && output !== null) {
        this.flattenObject(output, prefix, envVars);
      } else {
        envVars[prefix + 'RESULT'] = String(output);
      }
    }

    return envVars;
  }

  /**
   * Recursively flatten an object into environment variable format
   */
  private flattenObject(obj: any, prefix: string, result: Record<string, string>): void {
    for (const [key, value] of Object.entries(obj)) {
      const envKey = prefix + key.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      
      if (value === null || value === undefined) {
        result[envKey] = '';
      } else if (typeof value === 'object') {
        // Recursively flatten nested objects
        this.flattenObject(value, envKey + '_', result);
      } else {
        result[envKey] = String(value);
      }
    }
  }

  protected async beforeExecute(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    const config = step.config as ScriptConfig;
    context.log(`Executing script: ${config.command} ${(config.args || []).join(' ')}`);
    
    if (config.workingDirectory) {
      context.log(`Working directory: ${config.workingDirectory}`);
    }
  }

  protected async afterExecute(step: WorkflowStep, context: WorkflowContext, result: unknown): Promise<void> {
    const scriptResult = result as ScriptExecutionResult;
    context.log(`Script completed with exit code ${scriptResult.exitCode} in ${scriptResult.executionTime}ms`);
    
    if (scriptResult.stdout) {
      context.log(`STDOUT: ${scriptResult.stdout}`);
    }
    
    if (scriptResult.stderr) {
      context.log(`STDERR: ${scriptResult.stderr}`);
    }
  }

  protected async onError(step: WorkflowStep, context: WorkflowContext, error: Error): Promise<void> {
    context.log(`Script execution failed: ${error.message}`, 'error');
  }
}