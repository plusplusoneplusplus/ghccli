/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Example plugin that adds HTTP request capabilities to workflows
 */

import { StepTypePlugin, StepTypePluginMetadata } from '../StepTypePlugin.js';
import { StepExecutor } from '../../StepExecutor.js';
import { WorkflowStep, WorkflowStepConfig } from '../../types.js';
import { WorkflowContext } from '../../WorkflowContext.js';

export interface HttpStepConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string | object;
  timeout?: number;
  retries?: number;
  followRedirects?: boolean;
  validateStatus?: boolean;
}

export interface HttpStepResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: any;
  responseTime: number;
  url: string;
}

class HttpStepExecutor extends StepExecutor {
  getSupportedType(): string {
    return 'http';
  }

  validate(step: WorkflowStep): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = step.config as unknown as HttpStepConfig;

    if (!config.url || typeof config.url !== 'string') {
      errors.push('HTTP step must specify a valid URL');
    }

    if (config.url && !this.isValidUrl(config.url)) {
      errors.push('HTTP step URL must be a valid HTTP/HTTPS URL');
    }

    if (config.method && !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(config.method)) {
      errors.push('HTTP method must be one of: GET, POST, PUT, DELETE, PATCH');
    }

    if (config.timeout && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
      errors.push('HTTP timeout must be a positive number');
    }

    if (config.retries && (typeof config.retries !== 'number' || config.retries < 0)) {
      errors.push('HTTP retries must be a non-negative number');
    }

    if (config.headers && typeof config.headers !== 'object') {
      errors.push('HTTP headers must be an object');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async execute(step: WorkflowStep, context: WorkflowContext): Promise<HttpStepResult> {
    const config = step.config as unknown as HttpStepConfig;
    const startTime = Date.now();

    const requestOptions: RequestInit = {
      method: config.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ghccli-workflow-http-plugin/1.0.0',
        ...config.headers
      },
      redirect: config.followRedirects !== false ? 'follow' : 'manual'
    };

    if (config.body && ['POST', 'PUT', 'PATCH'].includes(config.method || 'GET')) {
      if (typeof config.body === 'object') {
        requestOptions.body = JSON.stringify(config.body);
      } else {
        requestOptions.body = config.body;
      }
    }

    const timeout = config.timeout || 30000;
    const retries = config.retries || 0;

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(config.url, {
          ...requestOptions,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (config.validateStatus !== false && !response.ok) {
          throw new Error(`HTTP request failed with status ${response.status}: ${response.statusText}`);
        }

        let data: any;
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else if (contentType.includes('text/')) {
          data = await response.text();
        } else {
          data = await response.arrayBuffer();
        }

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        return {
          status: response.status,
          statusText: response.statusText,
          headers,
          data,
          responseTime: Date.now() - startTime,
          url: response.url
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < retries) {
          const backoffDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
          context.log(`HTTP request attempt ${attempt + 1} failed, retrying in ${backoffDelay}ms: ${lastError.message}`, 'warn');
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }

    throw new Error(`HTTP request failed after ${retries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  protected async beforeExecute(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    const config = step.config as unknown as HttpStepConfig;
    context.log(`Making HTTP ${config.method || 'GET'} request to: ${config.url}`);
    
    if (config.timeout) {
      context.log(`Request timeout: ${config.timeout}ms`);
    }
    
    if (config.retries && config.retries > 0) {
      context.log(`Max retries: ${config.retries}`);
    }
  }

  protected async afterExecute(step: WorkflowStep, context: WorkflowContext, result: unknown): Promise<void> {
    const httpResult = result as HttpStepResult;
    context.log(`HTTP request completed with status ${httpResult.status} in ${httpResult.responseTime}ms`);
  }

  protected async onError(step: WorkflowStep, context: WorkflowContext, error: Error): Promise<void> {
    const config = step.config as unknown as HttpStepConfig;
    context.log(`HTTP request to ${config.url} failed: ${error.message}`, 'error');
  }
}

export class HttpStepPlugin extends StepTypePlugin {
  constructor() {
    const metadata: StepTypePluginMetadata = {
      name: 'http-step-plugin',
      version: '1.0.0',
      description: 'Adds HTTP request capabilities to workflows',
      author: 'GHCCLI Team',
      license: 'Apache-2.0',
      keywords: ['http', 'api', 'rest', 'web'],
      supportedStepTypes: ['http'],
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
    if (stepType === 'http') {
      return new HttpStepExecutor();
    }
    return null;
  }

  validateStepConfig(step: WorkflowStep): { valid: boolean; errors: string[] } {
    if (step.type !== 'http') {
      return {
        valid: false,
        errors: [`Invalid step type: expected 'http', got '${step.type}'`]
      };
    }

    const executor = new HttpStepExecutor();
    return executor.validate(step);
  }
}

export function createPlugin(): HttpStepPlugin {
  return new HttpStepPlugin();
}