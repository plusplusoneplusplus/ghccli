/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Example plugin that adds delay/wait capabilities to workflows
 */

import { StepTypePlugin, StepTypePluginMetadata } from '../StepTypePlugin.js';
import { StepExecutor } from '../../StepExecutor.js';
import { WorkflowStep, WorkflowStepConfig } from '../../types.js';
import { WorkflowContext } from '../../WorkflowContext.js';

export interface DelayStepConfig {
  duration: number;
  unit?: 'ms' | 'seconds' | 'minutes' | 'hours';
  message?: string;
  showProgress?: boolean;
}

export interface DelayStepResult {
  duration: number;
  actualDelay: number;
  message?: string;
  startTime: number;
  endTime: number;
}

class DelayStepExecutor extends StepExecutor {
  getSupportedType(): string {
    return 'delay';
  }

  validate(step: WorkflowStep): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = step.config as unknown as DelayStepConfig;

    if (typeof config.duration !== 'number' || config.duration < 0) {
      errors.push('Delay duration must be a non-negative number');
    }

    if (config.unit && !['ms', 'seconds', 'minutes', 'hours'].includes(config.unit)) {
      errors.push('Delay unit must be one of: ms, seconds, minutes, hours');
    }

    if (config.showProgress !== undefined && typeof config.showProgress !== 'boolean') {
      errors.push('showProgress must be a boolean');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private convertToMilliseconds(duration: number, unit: string = 'ms'): number {
    switch (unit) {
      case 'ms':
        return duration;
      case 'seconds':
        return duration * 1000;
      case 'minutes':
        return duration * 60 * 1000;
      case 'hours':
        return duration * 60 * 60 * 1000;
      default:
        return duration;
    }
  }

  async execute(step: WorkflowStep, context: WorkflowContext): Promise<DelayStepResult> {
    const config = step.config as unknown as DelayStepConfig;
    const startTime = Date.now();
    
    const durationMs = this.convertToMilliseconds(config.duration, config.unit || 'ms');
    
    if (config.showProgress) {
      await this.delayWithProgress(durationMs, context, config.message);
    } else {
      await this.simpleDelay(durationMs);
    }

    const endTime = Date.now();
    const actualDelay = endTime - startTime;

    return {
      duration: durationMs,
      actualDelay,
      message: config.message,
      startTime,
      endTime
    };
  }

  private async simpleDelay(durationMs: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, durationMs);
    });
  }

  private async delayWithProgress(durationMs: number, context: WorkflowContext, message?: string): Promise<void> {
    const updateInterval = Math.min(durationMs / 10, 1000); // Update every 1 second or 10% of duration
    const steps = Math.ceil(durationMs / updateInterval);
    
    return new Promise(resolve => {
      let currentStep = 0;
      
      const progressTimer = setInterval(() => {
        currentStep++;
        const progress = Math.min((currentStep * updateInterval) / durationMs, 1);
        const percent = Math.round(progress * 100);
        
        const progressMessage = message 
          ? `${message} (${percent}% complete)`
          : `Waiting... ${percent}% complete`;
        
        context.log(progressMessage);
        
        if (currentStep >= steps) {
          clearInterval(progressTimer);
          resolve();
        }
      }, updateInterval);
    });
  }

  protected async beforeExecute(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    const config = step.config as unknown as DelayStepConfig;
    const durationMs = this.convertToMilliseconds(config.duration, config.unit || 'ms');
    
    const formatDuration = (ms: number): string => {
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
      return `${(ms / 3600000).toFixed(1)}h`;
    };

    const message = config.message || `Delaying for ${formatDuration(durationMs)}`;
    context.log(message);
  }

  protected async afterExecute(step: WorkflowStep, context: WorkflowContext, result: unknown): Promise<void> {
    const delayResult = result as DelayStepResult;
    context.log(`Delay completed (actual duration: ${delayResult.actualDelay}ms)`);
  }

  protected async onError(step: WorkflowStep, context: WorkflowContext, error: Error): Promise<void> {
    context.log(`Delay step failed: ${error.message}`, 'error');
  }
}

export class DelayStepPlugin extends StepTypePlugin {
  constructor() {
    const metadata: StepTypePluginMetadata = {
      name: 'delay-step-plugin',
      version: '1.0.0',
      description: 'Adds delay/wait capabilities to workflows',
      author: 'GHCCLI Team',
      license: 'Apache-2.0',
      keywords: ['delay', 'wait', 'timing', 'sleep'],
      supportedStepTypes: ['delay', 'wait', 'sleep'],
      capabilities: {
        concurrent: true,
        timeout: false, // Delays manage their own timing
        retry: false,   // Delays don't typically need retries
        conditional: true
      }
    };

    super(metadata);
  }

  createStepExecutor(stepType: string): StepExecutor | null {
    if (['delay', 'wait', 'sleep'].includes(stepType)) {
      return new DelayStepExecutor();
    }
    return null;
  }

  validateStepConfig(step: WorkflowStep): { valid: boolean; errors: string[] } {
    if (!['delay', 'wait', 'sleep'].includes(step.type)) {
      return {
        valid: false,
        errors: [`Invalid step type: expected 'delay', 'wait', or 'sleep', got '${step.type}'`]
      };
    }

    const executor = new DelayStepExecutor();
    return executor.validate(step);
  }
}

export function createPlugin(): DelayStepPlugin {
  return new DelayStepPlugin();
}