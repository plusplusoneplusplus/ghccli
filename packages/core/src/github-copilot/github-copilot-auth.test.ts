/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubCopilotTokenManager, GitHubCopilotChatClient } from './github-copilot-auth.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock fetch globally
global.fetch = vi.fn();

// Mock fs module
vi.mock('node:fs');
vi.mock('node:os');

describe('GitHubCopilotTokenManager', () => {
  let tokenManager: GitHubCopilotTokenManager;
  const mockConfig = {
    token: 'test-github-token',
    baseUrl: 'https://api.github.com',
    editorName: 'test-editor',
    editorVersion: '1.0.0',
    pluginName: 'test-plugin',
    pluginVersion: '1.0.0',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock os.homedir BEFORE creating the token manager
    vi.mocked(os.homedir).mockReturnValue('/mock/home');
    
    // Mock fs operations
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    
    tokenManager = new GitHubCopilotTokenManager(mockConfig);
  });

  afterEach(() => {
    vi.resetAllMocks();
    // Clean up global state after each test
    GitHubCopilotTokenManager.clearGlobalState();
  });

  describe('validateToken', () => {
    it('should return true for valid token', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ login: 'testuser' }),
      };
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse as any);

      const result = await tokenManager.validateToken();
      
      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token test-github-token',
            'Accept': 'application/json',
          }),
        })
      );
    });

    it('should return false for invalid token', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
      };
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse as any);

      const result = await tokenManager.validateToken();
      
      expect(result).toBe(false);
    });

    it('should handle network errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const result = await tokenManager.validateToken();
      
      expect(result).toBe(false);
    });
  });

  describe('getCopilotToken', () => {
    it('should return token info for successful request', async () => {
      const mockTokenData = {
        token: 'copilot-token-123',
        expires_at: 1640995200, // Unix timestamp
        refresh_in: 3600, // 1 hour
      };

      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(mockTokenData),
      };
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse as any);

      // Mock Date.now to return a fixed time
      const mockNow = 1640991600; // 1 hour before expiry
      vi.spyOn(Date, 'now').mockReturnValue(mockNow * 1000);

      const result = await tokenManager.getCopilotToken();
      
      expect(result).toMatchObject({
        token: 'copilot-token-123',
        refresh_in: 3600,
        username: 'NullUser',
        copilot_plan: 'unknown',
        isVscodeTeamMember: false,
      });
      
      expect(fetch).toHaveBeenCalledWith(
        'https://api.github.com/copilot_internal/v2/token',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'token test-github-token',
            'Accept': 'application/json',
            'User-Agent': 'test-editor/1.0.0',
          }),
        })
      );
    });

    it('should handle 401 unauthorized error', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue('Unauthorized'),
      };
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse as any);

      const result = await tokenManager.getCopilotToken();
      
      expect(result).toBeNull();
    });

    it('should handle invalid token response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({}), // Missing token
      };
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse as any);

      const result = await tokenManager.getCopilotToken();
      
      expect(result).toBeNull();
    });
  });

  describe('loadTokenFromFile', () => {
    it('should load token from file when it exists', () => {
      const mockToken = 'saved-github-token';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(mockToken);
      
      const result = tokenManager.loadTokenFromFile();
      
      expect(result).toBe('saved-github-token');
      expect(fs.readFileSync).toHaveBeenCalledWith(
        path.join('/mock/home', '.ghccli', '.github_token'),
        'utf8'
      );
    });

    it('should return null when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = tokenManager.loadTokenFromFile();
      
      expect(result).toBeNull();
    });

    it('should handle file read errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File read error');
      });

      const result = tokenManager.loadTokenFromFile();
      
      expect(result).toBeNull();
    });
  });

  describe('getGitHubToken', () => {
    it('should return existing token from file', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('existing-token');

      const result = await GitHubCopilotTokenManager.getGitHubToken(false);
      
      expect(result).toBe('existing-token');
    });

    it('should return environment variable when no file exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env['GITHUB_TOKEN'] = 'env-token';

      const result = await GitHubCopilotTokenManager.getGitHubToken(false);
      
      expect(result).toBe('env-token');
      
      delete process.env['GITHUB_TOKEN'];
    });

    it('should return null when no token is available', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      delete process.env['GITHUB_TOKEN'];
      delete process.env['GITHUB_COPILOT_TOKEN'];

      const result = await GitHubCopilotTokenManager.getGitHubToken(false);
      
      expect(result).toBeNull();
    });
  });
});

describe('GitHubCopilotChatClient', () => {
  let chatClient: GitHubCopilotChatClient;
  let mockTokenManager: GitHubCopilotTokenManager;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock os.homedir BEFORE creating the token manager
    vi.mocked(os.homedir).mockReturnValue('/mock/home');
    
    // Mock fs operations
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    
    mockTokenManager = new GitHubCopilotTokenManager({
      token: 'test-token',
    });
    chatClient = new GitHubCopilotChatClient(mockTokenManager, 'gpt-4o');
  });

  describe('sendMessage', () => {
    it('should send message and return response', async () => {
      // Mock token validation
      vi.spyOn(mockTokenManager, 'validateToken').mockResolvedValue(true);
      
      // Mock copilot token retrieval
      vi.spyOn(mockTokenManager, 'getCopilotToken').mockResolvedValue({
        token: 'copilot-internal-token',
        expires_at: Date.now() / 1000 + 3600,
        refresh_in: 3600,
      });

      // Mock fetch response for chat completion
      const mockChatResponse = `data: {"choices":[{"delta":{"content":"Hello there!"}}]}
data: [DONE]`;
      
      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(mockChatResponse),
      };
      vi.mocked(fetch).mockResolvedValueOnce(mockResponse as any);

      const result = await chatClient.sendMessage('Hello');
      
      expect(result).toBe('Hello there!');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.githubcopilot.com/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'authorization': 'Bearer copilot-internal-token',
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          }),
          body: expect.stringContaining('"messages":[{"content":"Hello","role":"user"}]'),
        })
      );
    });

    it('should handle chat errors gracefully', async () => {
      vi.spyOn(mockTokenManager, 'validateToken').mockResolvedValue(false);

      const result = await chatClient.sendMessage('Hello');
      
      expect(result).toBe('Error: Unable to obtain Copilot token');
    });
  });

  describe('clearHistory', () => {
    it('should clear chat history', () => {
      chatClient.clearHistory();
      
      const history = chatClient.getHistory();
      expect(history).toEqual([]);
    });
  });
});

describe('GitHubCopilotTokenManager Deduplication', () => {
  let tokenManager1: GitHubCopilotTokenManager;
  let tokenManager2: GitHubCopilotTokenManager;
  const mockConfig = {
    token: 'test-github-token',
    baseUrl: 'https://api.github.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock os.homedir BEFORE creating the token managers
    vi.mocked(os.homedir).mockReturnValue('/mock/home');
    
    // Mock fs operations
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    
    tokenManager1 = new GitHubCopilotTokenManager(mockConfig);
    tokenManager2 = new GitHubCopilotTokenManager(mockConfig);
  });

  afterEach(() => {
    vi.resetAllMocks();
    GitHubCopilotTokenManager.clearGlobalState();
  });

  describe('startDeviceFlow deduplication', () => {
    it('should reuse the same device flow when called multiple times on the same instance', async () => {
      const mockDeviceResponse = {
        ok: true,
        json: () => Promise.resolve({
          device_code: 'test-device-code',
          user_code: 'TEST-CODE',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
      };

      vi.mocked(fetch).mockResolvedValue(mockDeviceResponse as any);

      // Start two device flows simultaneously on the same instance
      const [result1, result2] = await Promise.all([
        tokenManager1.startDeviceFlow(),
        tokenManager1.startDeviceFlow(),
      ]);

      // Should only make one API call
      expect(fetch).toHaveBeenCalledTimes(1);
      
      // Should return the same result
      expect(result1).toEqual(result2);
      expect(result1.deviceCode).toBe('test-device-code');
    });

    it('should reuse device flow across different instances', async () => {
      const mockDeviceResponse = {
        ok: true,
        json: () => Promise.resolve({
          device_code: 'test-device-code',
          user_code: 'TEST-CODE',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
      };

      vi.mocked(fetch).mockResolvedValue(mockDeviceResponse as any);

      // Start device flows on different instances simultaneously
      const [result1, result2] = await Promise.all([
        tokenManager1.startDeviceFlow(),
        tokenManager2.startDeviceFlow(),
      ]);

      // Should only make one API call
      expect(fetch).toHaveBeenCalledTimes(1);
      
      // Should return the same result
      expect(result1).toEqual(result2);
      expect(result1.deviceCode).toBe('test-device-code');
    });

    it('should allow new device flow after previous one completes', async () => {
      const mockDeviceResponse = {
        ok: true,
        json: () => Promise.resolve({
          device_code: 'test-device-code',
          user_code: 'TEST-CODE',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
      };

      vi.mocked(fetch).mockResolvedValue(mockDeviceResponse as any);

      // First device flow
      await tokenManager1.startDeviceFlow();
      expect(fetch).toHaveBeenCalledTimes(1);

      // Second device flow should make a new API call
      await tokenManager1.startDeviceFlow();
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('pollForToken deduplication', () => {
    it('should reuse the same poll when called multiple times with the same device code', async () => {
      const mockTokenResponse = {
        ok: true,
        json: () => Promise.resolve({
          error: 'authorization_pending',
        }),
      };

      vi.mocked(fetch).mockResolvedValue(mockTokenResponse as any);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const deviceCode = 'test-device-code';

      // Start two polls simultaneously on the same instance
      const [result1, result2] = await Promise.all([
        tokenManager1.pollForToken(deviceCode, 5),
        tokenManager1.pollForToken(deviceCode, 5),
      ]);

      // Should only make one API call
      expect(fetch).toHaveBeenCalledTimes(1);
      
      // Should return the same result
      expect(result1).toEqual(result2);
      expect(result1).toBeNull(); // authorization_pending returns null
    });

    it('should reuse poll across different instances for the same device code', async () => {
      const mockTokenResponse = {
        ok: true,
        json: () => Promise.resolve({
          access_token: 'test-access-token',
        }),
      };

      vi.mocked(fetch).mockResolvedValue(mockTokenResponse as any);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const deviceCode = 'test-device-code';

      // Start polls on different instances simultaneously
      const [result1, result2] = await Promise.all([
        tokenManager1.pollForToken(deviceCode, 5),
        tokenManager2.pollForToken(deviceCode, 5),
      ]);

      // Should only make one API call
      expect(fetch).toHaveBeenCalledTimes(1);
      
      // Should return the same result
      expect(result1).toEqual(result2);
      expect(result1).toBe('test-access-token');
    });

    it('should allow different polls for different device codes', async () => {
      const mockTokenResponse = {
        ok: true,
        json: () => Promise.resolve({
          error: 'authorization_pending',
        }),
      };

      vi.mocked(fetch).mockResolvedValue(mockTokenResponse as any);

      const deviceCode1 = 'test-device-code-1';
      const deviceCode2 = 'test-device-code-2';

      // Start polls for different device codes
      await Promise.all([
        tokenManager1.pollForToken(deviceCode1, 5),
        tokenManager2.pollForToken(deviceCode2, 5),
      ]);

      // Should make separate API calls for different device codes
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('cleanup', () => {
    it('should clean up instance state', () => {
      tokenManager1.cleanup();
      
      // Instance should be clean (can't directly test private fields, but this ensures method exists)
      expect(() => tokenManager1.cleanup()).not.toThrow();
    });

    it('should clear global state', () => {
      GitHubCopilotTokenManager.clearGlobalState();
      
      // Should not throw when clearing again
      expect(() => GitHubCopilotTokenManager.clearGlobalState()).not.toThrow();
    });
  });
}); 