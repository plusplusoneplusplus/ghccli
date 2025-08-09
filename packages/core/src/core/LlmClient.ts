/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
  SchemaUnion,
} from '@google/genai';
import { AuthType } from './contentGenerator.js';

/**
 * Provider-agnostic client surface used by lightweight helpers and call sites
 * that should not depend on a specific concrete client implementation.
 */
export interface LlmClient {
  getAuthType(): AuthType | undefined;
  getModel(): string | undefined;

  generateContent(
    contents: Content[],
    config: GenerateContentConfig,
    signal: AbortSignal,
    model?: string,
  ): Promise<GenerateContentResponse>;

  generateJson(
    contents: Content[],
    schema: SchemaUnion,
    signal: AbortSignal,
    model?: string,
    config?: GenerateContentConfig,
  ): Promise<Record<string, unknown>>;
}


