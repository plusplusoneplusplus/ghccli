/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall,
  ToolRegistry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  GeminiEventType,
  ToolErrorType,
} from '@google/gemini-cli-core';
import { Content, Part, FunctionCall } from '@google/genai';

import { parseAndFormatApiError } from './ui/utils/errorParsing.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';

// === CUSTOM JSON OUTPUT SUPPORT (GHCCLI Extensions) ===
// Keep JSON imports at the top to minimize upstream merge conflicts
import { JsonOutputHandler, ToolCallResult } from './output/index.js';

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,

  // === CUSTOM JSON OUTPUT PARAMETERS (GHCCLI Extensions) ===
  outputFormat?: string,
  prettyPrint?: boolean,
): Promise<void> {
    
  // === CUSTOM JSON OUTPUT SETUP (GHCCLI Extensions) ===
  // Keep JSON setup isolated to minimize upstream merge conflicts
  const isJsonOutput = outputFormat === 'json';
  const jsonHandler = isJsonOutput ? new JsonOutputHandler(prettyPrint ?? true) : null;
  let contentBuffer = '';
  let toolCallResults: ToolCallResult[] = [];

  const consolePatcher = new ConsolePatcher({
    stderr: true,
    debugMode: config.getDebugMode(),
  });

  let turnCount = 0;

  try {
    consolePatcher.patch();

    // Handle EPIPE errors when the output is piped to a command that closes early.
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE') {
        // Exit gracefully if the pipe is closed.
        process.exit(0);
      }
    });

    const geminiClient = config.getGeminiClient();
    const toolRegistry: ToolRegistry = await config.getToolRegistry();

    const abortController = new AbortController();
    let currentMessages: Content[] = [
      { role: 'user', parts: [{ text: input }] },
    ];
    
    while (true) {
      turnCount++;
      if (
        config.getMaxSessionTurns() >= 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        console.error(
          '\n Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
        );
        return;
      }
      const functionCalls: FunctionCall[] = [];

      const responseStream = geminiClient.sendMessageStream(
        currentMessages[0]?.parts || [],
        abortController.signal,
        prompt_id,
        100, // max turns
        undefined, // originalModel
        true, // skipNextSpeakerCheck - bypass in noninteractive mode
      );

      for await (const event of responseStream) {
        if (abortController.signal.aborted) {
          console.error('Operation cancelled.');
          return;
        }

        if (event.type === GeminiEventType.Content) {
          // === CUSTOM JSON OUTPUT HANDLING (GHCCLI Extensions) ===
          if (isJsonOutput) {
            // Buffer content for JSON output
            contentBuffer += event.value;
          } else {
            // === ORIGINAL STREAMING OUTPUT ===
            process.stdout.write(event.value);
          }
        } else if (event.type === GeminiEventType.ToolCallRequest) {
          const toolCallRequest = event.value;
          const fc: FunctionCall = {
            name: toolCallRequest.name,
            args: toolCallRequest.args,
            id: toolCallRequest.callId,
          };
          functionCalls.push(fc);
        }
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const fc of functionCalls) {
          const callId = fc.id ?? `${fc.name}-${Date.now()}`;
          const requestInfo: ToolCallRequestInfo = {
            callId,
            name: fc.name as string,
            args: (fc.args ?? {}) as Record<string, unknown>,
            isClientInitiated: false,
            prompt_id,
          };

          const startTime = Date.now();
          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            toolRegistry,
            abortController.signal,
          );
          const duration = Date.now() - startTime;

          // === CUSTOM JSON OUTPUT - TOOL CALL TRACKING (GHCCLI Extensions) ===
          if (isJsonOutput && jsonHandler) {
            const toolCallResult = jsonHandler.createToolCallResult(
              callId,
              fc.name as string,
              (fc.args ?? {}) as Record<string, unknown>,
              typeof toolResponse.resultDisplay === 'string' ? toolResponse.resultDisplay : (toolResponse.error?.message || ''),
              toolResponse.error ? 'error' : 'success',
              duration
            );
            toolCallResults.push(toolCallResult);
          }

          if (toolResponse.error) {
            // === CUSTOM JSON OUTPUT - ERROR SUPPRESSION (GHCCLI Extensions) ===
            if (!isJsonOutput) {
              // === ORIGINAL ERROR OUTPUT ===
              console.error(
                `Error executing tool ${fc.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
              );
            }
            if (toolResponse.errorType === ToolErrorType.UNHANDLED_EXCEPTION)
              process.exit(1);
          }

          if (toolResponse.responseParts) {
            const parts = Array.isArray(toolResponse.responseParts)
              ? toolResponse.responseParts
              : [toolResponse.responseParts];
            for (const part of parts) {
              if (typeof part === 'string') {
                toolResponseParts.push({ text: part });
              } else if (part) {
                toolResponseParts.push(part);
              }
            }
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        // === CUSTOM JSON OUTPUT - FINAL RESULT (GHCCLI Extensions) ===
        if (isJsonOutput && jsonHandler) {
          const metadata = jsonHandler.createMetadata(
            config.getSessionId(),
            prompt_id,
            config.getContentGeneratorConfig()?.model || 'unknown',
            turnCount
          );
          const jsonOutput = jsonHandler.createSuccess(
            'Request completed successfully',
            metadata,
            contentBuffer,
            toolCallResults
          );
          process.stdout.write(jsonHandler.format(jsonOutput));
        } else {
          // === ORIGINAL FINAL NEWLINE ===
          process.stdout.write('\n'); // Ensure a final newline
        }
        return;
      }
    }
  } catch (error) {
    // === CUSTOM JSON OUTPUT - ERROR FORMATTING (GHCCLI Extensions) ===
    if (isJsonOutput && jsonHandler) {
      const metadata = jsonHandler.createMetadata(
        config.getSessionId(),
        prompt_id,
        config.getContentGeneratorConfig()?.model || 'unknown',
        turnCount
      );
      const jsonError = {
        type: 'api_error',
        message: parseAndFormatApiError(
          error,
          config.getContentGeneratorConfig()?.authType,
        ),
        details: { error: error instanceof Error ? error.message : String(error) }
      };
      const jsonOutput = jsonHandler.createError(
        'Request failed',
        metadata,
        jsonError,
        contentBuffer,
        toolCallResults
      );
      process.stdout.write(jsonHandler.format(jsonOutput));
    } else {
      // === ORIGINAL ERROR OUTPUT ===
      console.error(
        parseAndFormatApiError(
          error,
          config.getContentGeneratorConfig()?.authType,
        ),
      );
    }
    process.exit(1);
  } finally {
    consolePatcher.cleanup();
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry();
    }
  }
}
