/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, Mock, afterEach } from 'vitest';
import { Content, GoogleGenAI, Models } from '@google/genai';
import { DEFAULT_GEMINI_FLASH_LITE_MODEL, getLightweightModel } from '../config/models.js';
import { AuthType } from '../core/contentGenerator.js';
import { GeminiClient } from '../core/client.js';
import { Config } from '../config/config.js';
import { checkNextSpeaker, NextSpeakerResponse, checkNextSpeakerWithSelector } from './nextSpeakerChecker.js';
import { TaskClientSelector, LlmTask } from '../github-copilot/index.js';
import { GeminiChat } from '../core/geminiChat.js';

// Mock GeminiClient and Config constructor
vi.mock('../core/client.js');
vi.mock('../config/config.js');

// Define mocks for GoogleGenAI and Models instances that will be used across tests
const mockModelsInstance = {
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
  countTokens: vi.fn(),
  embedContent: vi.fn(),
  batchEmbedContents: vi.fn(),
} as unknown as Models;

const mockGoogleGenAIInstance = {
  getGenerativeModel: vi.fn().mockReturnValue(mockModelsInstance),
  // Add other methods of GoogleGenAI if they are directly used by GeminiChat constructor or its methods
} as unknown as GoogleGenAI;

vi.mock('@google/genai', async () => {
  const actualGenAI =
    await vi.importActual<typeof import('@google/genai')>('@google/genai');
  return {
    ...actualGenAI,
    GoogleGenAI: vi.fn(() => mockGoogleGenAIInstance), // Mock constructor to return the predefined instance
    // If Models is instantiated directly in GeminiChat, mock its constructor too
    // For now, assuming Models instance is obtained via getGenerativeModel
  };
});

describe('checkNextSpeaker', () => {
  let chatInstance: GeminiChat;
  let mockGeminiClient: GeminiClient;
  let MockConfig: Mock;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    MockConfig = vi.mocked(Config);
    const mockConfigInstance = new MockConfig(
      'test-api-key',
      'gemini-pro',
      false,
      '.',
      false,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
    );

    mockGeminiClient = new GeminiClient(mockConfigInstance);
    
    // Add spy for getAuthType method
    vi.spyOn(mockGeminiClient, 'getAuthType').mockReturnValue(undefined);

    // Reset mocks before each test to ensure test isolation
    vi.mocked(mockModelsInstance.generateContent).mockReset();
    vi.mocked(mockModelsInstance.generateContentStream).mockReset();

    // GeminiChat will receive the mocked instances via the mocked GoogleGenAI constructor
    chatInstance = new GeminiChat(
      mockConfigInstance,
      mockModelsInstance, // This is the instance returned by mockGoogleGenAIInstance.getGenerativeModel
      {},
      [], // initial history
    );

    // Spy on getHistory for chatInstance
    vi.spyOn(chatInstance, 'getHistory');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return null if history is empty', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([]);
    const result = await checkNextSpeaker(
      chatInstance,
      mockGeminiClient,
      abortSignal,
    );
    expect(result).toBeNull();
    expect(mockGeminiClient.generateJson).not.toHaveBeenCalled();
  });

  it('should return null if the last speaker was the user', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'user', parts: [{ text: 'Hello' }] },
    ] as Content[]);
    const result = await checkNextSpeaker(
      chatInstance,
      mockGeminiClient,
      abortSignal,
    );
    expect(result).toBeNull();
    expect(mockGeminiClient.generateJson).not.toHaveBeenCalled();
  });

  it("should return { next_speaker: 'model' } when model intends to continue", async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'I will now do something.' }] },
    ] as Content[]);
    const mockApiResponse: NextSpeakerResponse = {
      reasoning: 'Model stated it will do something.',
      next_speaker: 'model',
    };
    (mockGeminiClient.generateJson as Mock).mockResolvedValue(mockApiResponse);

    const result = await checkNextSpeaker(
      chatInstance,
      mockGeminiClient,
      abortSignal,
    );
    expect(result).toEqual(mockApiResponse);
    expect(mockGeminiClient.generateJson).toHaveBeenCalledTimes(1);
  });

  it("should return { next_speaker: 'user' } when model asks a question", async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'What would you like to do?' }] },
    ] as Content[]);
    const mockApiResponse: NextSpeakerResponse = {
      reasoning: 'Model asked a question.',
      next_speaker: 'user',
    };
    (mockGeminiClient.generateJson as Mock).mockResolvedValue(mockApiResponse);

    const result = await checkNextSpeaker(
      chatInstance,
      mockGeminiClient,
      abortSignal,
    );
    expect(result).toEqual(mockApiResponse);
  });

  it("should return { next_speaker: 'user' } when model makes a statement", async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'This is a statement.' }] },
    ] as Content[]);
    const mockApiResponse: NextSpeakerResponse = {
      reasoning: 'Model made a statement, awaiting user input.',
      next_speaker: 'user',
    };
    (mockGeminiClient.generateJson as Mock).mockResolvedValue(mockApiResponse);

    const result = await checkNextSpeaker(
      chatInstance,
      mockGeminiClient,
      abortSignal,
    );
    expect(result).toEqual(mockApiResponse);
  });

  it('should return null if geminiClient.generateJson throws an error', async () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'Some model output.' }] },
    ] as Content[]);
    (mockGeminiClient.generateJson as Mock).mockRejectedValue(
      new Error('API Error'),
    );

    const result = await checkNextSpeaker(
      chatInstance,
      mockGeminiClient,
      abortSignal,
    );
    expect(result).toBeNull();
    consoleWarnSpy.mockRestore();
  });

  it('should return null if geminiClient.generateJson returns invalid JSON (missing next_speaker)', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'Some model output.' }] },
    ] as Content[]);
    (mockGeminiClient.generateJson as Mock).mockResolvedValue({
      reasoning: 'This is incomplete.',
    } as unknown as NextSpeakerResponse); // Type assertion to simulate invalid response

    const result = await checkNextSpeaker(
      chatInstance,
      mockGeminiClient,
      abortSignal,
    );
    expect(result).toBeNull();
  });

  it('should return null if geminiClient.generateJson returns a non-string next_speaker', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'Some model output.' }] },
    ] as Content[]);
    (mockGeminiClient.generateJson as Mock).mockResolvedValue({
      reasoning: 'Model made a statement, awaiting user input.',
      next_speaker: 123, // Invalid type
    } as unknown as NextSpeakerResponse);

    const result = await checkNextSpeaker(
      chatInstance,
      mockGeminiClient,
      abortSignal,
    );
    expect(result).toBeNull();
  });

  it('should return null if geminiClient.generateJson returns an invalid next_speaker string value', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'Some model output.' }] },
    ] as Content[]);
    (mockGeminiClient.generateJson as Mock).mockResolvedValue({
      reasoning: 'Model made a statement, awaiting user input.',
      next_speaker: 'neither', // Invalid enum value
    } as unknown as NextSpeakerResponse);

    const result = await checkNextSpeaker(
      chatInstance,
      mockGeminiClient,
      abortSignal,
    );
    expect(result).toBeNull();
  });

  it('should call generateJson with lightweight model for undefined auth type', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'Some model output.' }] },
    ] as Content[]);
    const mockApiResponse: NextSpeakerResponse = {
      reasoning: 'Model made a statement, awaiting user input.',
      next_speaker: 'user',
    };
    (mockGeminiClient.generateJson as Mock).mockResolvedValue(mockApiResponse);
    (mockGeminiClient.getAuthType as Mock).mockReturnValue(undefined);

    await checkNextSpeaker(chatInstance, mockGeminiClient, abortSignal);

    expect(mockGeminiClient.generateJson).toHaveBeenCalled();
    const generateJsonCall = (mockGeminiClient.generateJson as Mock).mock
      .calls[0];
    expect(generateJsonCall[3]).toBe(getLightweightModel(undefined));
  });

  it('should call generateJson with gpt-4o for OpenAI auth type', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'Some model output.' }] },
    ] as Content[]);
    const mockApiResponse: NextSpeakerResponse = {
      reasoning: 'Model made a statement, awaiting user input.',
      next_speaker: 'user',
    };
    (mockGeminiClient.generateJson as Mock).mockResolvedValue(mockApiResponse);
    (mockGeminiClient.getAuthType as Mock).mockReturnValue(AuthType.OPENAI);

    await checkNextSpeaker(chatInstance, mockGeminiClient, abortSignal);

    expect(mockGeminiClient.generateJson).toHaveBeenCalled();
    const generateJsonCall = (mockGeminiClient.generateJson as Mock).mock
      .calls[0];
    expect(generateJsonCall[3]).toBe(getLightweightModel(AuthType.OPENAI));
  });

  it('should handle the case where LLM returns just "user" instead of JSON', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'I need to think about this.' }] },
    ] as Content[]);

    // Mock generateJson to return a properly formatted response when the LLM
    // just returns "user" (this simulates the fix in client.ts)
    (mockGeminiClient.generateJson as Mock).mockResolvedValue({
      reasoning: "Determined that 'user' should speak next.",
      next_speaker: 'user'
    });

    const result = await checkNextSpeaker(chatInstance, mockGeminiClient, abortSignal);

    expect(result).toEqual({
      reasoning: "Determined that 'user' should speak next.",
      next_speaker: 'user'
    });
  });

  it('should handle the case where LLM returns just "model" instead of JSON', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'Let me continue with the next step...' }] },
    ] as Content[]);

    // Mock generateJson to return a properly formatted response when the LLM
    // just returns "model" (this simulates the fix in client.ts)
    (mockGeminiClient.generateJson as Mock).mockResolvedValue({
      reasoning: "Determined that 'model' should speak next.",
      next_speaker: 'model'
    });

    const result = await checkNextSpeaker(chatInstance, mockGeminiClient, abortSignal);

    expect(result).toEqual({
      reasoning: "Determined that 'model' should speak next.",
      next_speaker: 'model'
    });
  });

  it('should use TaskClientSelector overrides when provided', async () => {
    (chatInstance.getHistory as Mock).mockReturnValue([
      { role: 'model', parts: [{ text: 'Some model output.' }] },
    ] as Content[]);

    const mockApiResponse: NextSpeakerResponse = {
      reasoning: 'Override path',
      next_speaker: 'user',
    };
    (mockGeminiClient.generateJson as Mock).mockResolvedValue(mockApiResponse);

    const selector = {
      getClientFor: vi.fn().mockReturnValue(mockGeminiClient),
      getModelFor: vi.fn().mockReturnValue('override-model'),
    } as unknown as TaskClientSelector;

    const result = await checkNextSpeakerWithSelector(
      chatInstance,
      selector,
      abortSignal,
    );

    expect(selector.getClientFor).toHaveBeenCalledWith(LlmTask.NEXT_SPEAKER);
    const generateJsonCall = (mockGeminiClient.generateJson as Mock).mock.calls[0];
    expect(generateJsonCall[3]).toBe('override-model');
    expect(result).toEqual(mockApiResponse);
  });
});
