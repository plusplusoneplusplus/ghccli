/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { OpenAIContentGenerator } from './openaiContentGenerator.js';

/**
 * Azure OpenAI content generator that reuses the OpenAI generator while
 * providing Azure endpoint, headers and api-version query via request options.
 * Only API key authentication is implemented.
 */
export class AzureOpenAIContentGenerator extends OpenAIContentGenerator {
  private readonly apiVersion: string;

  constructor(
    apiKey: string,
    model: string,
    config: Config,
    options: { endpoint: string; apiVersion: string },
  ) {
    // Set base URL for OpenAI SDK through env var that OpenAIContentGenerator reads
    // We temporarily set process.env.OPENAI_BASE_URL for this instance creation.
    const previousBaseUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = `${options.endpoint}/openai/deployments/${model}`;
    super(apiKey, model, config);
    // Restore previous value to avoid leaking into other instances
    if (previousBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = previousBaseUrl;
    }

    this.apiVersion = options.apiVersion;
  }

  protected override async getAdditionalHeaders(): Promise<Record<string, string> | undefined> {
    return {
      'api-key': 'REDACTED', // Placeholder; actual key provided in request options
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async getAdditionalRequestOptions(): Promise<Record<string, any> | undefined> {
    // Provide api-version as query and api-key header per Azure requirements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientAny = (this as any).client as { apiKey?: string };
    return {
      headers: { 'api-key': clientAny.apiKey || process.env.AZURE_OPENAI_API_KEY || '' },
      query: { 'api-version': this.apiVersion },
    } as any;
  }
}


