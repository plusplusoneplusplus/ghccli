/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const logger = {
  debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

const execAsync = promisify(exec);

export interface GitHubConfig {
  token: string;
  baseUrl?: string;
  editorName?: string;
  editorVersion?: string;
  pluginName?: string;
  pluginVersion?: string;
}

export interface TokenInfo {
  token: string;
  expires_at: number;
  refresh_in: number;
}

export interface ExtendedTokenInfo extends TokenInfo {
  username?: string;
  copilot_plan?: string;
  isVscodeTeamMember?: boolean;
}

export interface DeviceFlowResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

export interface DeviceFlowInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export class GitHubCopilotTokenManager {
  private config: GitHubConfig;
  private cachedToken: ExtendedTokenInfo | null = null;
  private fetchInProgress = false;
  private tokenFilePath: string;

  // Deduplication: prevent multiple device flows per instance
  private deviceFlowInProgress = false;
  private deviceFlowPromise: Promise<DeviceFlowInfo> | null = null;
  private pollPromise: Promise<string | null> | null = null;

  // Static deduplication: prevent multiple device flows across all instances
  private static activeDeviceFlows = new Map<string, Promise<DeviceFlowInfo>>();
  private static activePollPromises = new Map<string, Promise<string | null>>();

  constructor(config: GitHubConfig) {
    this.config = {
      baseUrl: 'https://api.github.com',
      editorName: 'vscode',
      editorVersion: '1.103.0',
      pluginName: 'copilot-chat',
      pluginVersion: '1.7.21',
      ...config,
    };
    
    // Store token in .gemini directory
    const geminiDir = path.join(os.homedir(), '.gemini');
    if (!fs.existsSync(geminiDir)) {
      fs.mkdirSync(geminiDir, { recursive: true });
    }
    this.tokenFilePath = path.join(geminiDir, '.github_token');
  }

  private getEditorVersionHeaders(): Record<string, string> {
    return {
      'Editor-Version': `${this.config.editorName}/${this.config.editorVersion}`,
      'Editor-Plugin-Version': `${this.config.pluginName}/${this.config.pluginVersion}`,
    };
  }

  private nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  async validateToken(): Promise<boolean> {
    try {
      logger.debug('Validating GitHub token...');
      const response = await fetch(`${this.config.baseUrl}/user`, {
        headers: {
          'Authorization': `token ${this.config.token}`,
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const userInfo = await response.json();
        logger.debug('Token validation successful for user:', userInfo.login || 'unknown');
        return true;
      } else {
        logger.debug('Token validation failed with status:', response.status);
        return false;
      }
    } catch (error) {
      logger.debug('Token validation error:', error);
      return false;
    }
  }

  async getCopilotToken(): Promise<ExtendedTokenInfo | null> {
    const url = `${this.config.baseUrl}/copilot_internal/v2/token`;
    const headers = {
      'Authorization': `token ${this.config.token}`,
      'Accept': 'application/json',
      'User-Agent': `${this.config.editorName}/${this.config.editorVersion}`,
      ...this.getEditorVersionHeaders(),
    };

    try {
      const response = await fetch(url, { headers });
      
      if (!response.ok || response.status === 401 || response.status === 403) {
        const errorText = await response.text();
        throw new Error(
          `Failed to get copilot token: ${response.status} ${response.statusText}. ${errorText}`
        );
      }

      const tokenData = await response.json();
      
      if (!tokenData || !tokenData.token) {
        throw new Error('Invalid token response: missing token');
      }

      // Create token info from response
      const tokenInfo: TokenInfo = {
        token: tokenData.token,
        expires_at: tokenData.expires_at,
        refresh_in: tokenData.refresh_in,
      };

      // Adjust expires_at to handle clock skew and provide buffer
      const adjustedExpiresAt = this.nowSeconds() + tokenInfo.refresh_in + 60; // extra buffer

      const extendedInfo: ExtendedTokenInfo = {
        token: tokenInfo.token,
        expires_at: adjustedExpiresAt,
        refresh_in: tokenInfo.refresh_in,
        username: 'NullUser',
        copilot_plan: 'unknown',
        isVscodeTeamMember: false,
      };

      logger.debug('Token expiration info: expires_at =', adjustedExpiresAt, 'refresh_in =', tokenInfo.refresh_in);

      return extendedInfo;
    } catch (error) {
      logger.debug('Token request failed:', error);
      return null;
    }
  }

  async getCachedOrFreshToken(): Promise<ExtendedTokenInfo | null> {
    const currentTime = this.nowSeconds();

    // Check if we have a cached token that's still valid
    if (this.cachedToken && this.cachedToken.expires_at > currentTime + 30) { // 30 second buffer
      logger.debug('Using cached token');
      return this.cachedToken;
    }

    // Prevent multiple simultaneous fetches
    if (this.fetchInProgress) {
      logger.debug('Token fetch in progress');
      return null;
    }

    try {
      this.fetchInProgress = true;
      logger.debug('Fetching fresh token');

      const token = await this.getCopilotToken();
      if (token) {
        this.cachedToken = token;
        logger.debug('Token cached');
      }

      return token;
    } finally {
      this.fetchInProgress = false;
    }
  }

  isTokenExpired(): boolean {
    if (!this.cachedToken) {
      return true;
    }
    return this.nowSeconds() >= this.cachedToken.expires_at;
  }

  timeUntilRefresh(): number {
    if (!this.cachedToken) {
      return 0;
    }
    return Math.max(0, this.cachedToken.expires_at - this.nowSeconds());
  }

  async startDeviceFlow(): Promise<DeviceFlowInfo> {
    // Instance-level deduplication: return existing promise if already in progress
    if (this.deviceFlowInProgress && this.deviceFlowPromise) {
      logger.debug('Device flow already in progress for this instance, returning existing promise');
      return this.deviceFlowPromise;
    }

    // Global deduplication: check if any instance is already starting a device flow
    const globalKey = 'github-copilot-device-flow';
    const existingGlobalFlow = GitHubCopilotTokenManager.activeDeviceFlows.get(globalKey);
    if (existingGlobalFlow) {
      logger.debug('Device flow already in progress globally, reusing existing flow');
      return existingGlobalFlow;
    }

    logger.debug('Starting new device flow request to GitHub...');
    
    // Create the device flow promise
    const deviceFlowPromise = this._performDeviceFlow();
    
    // Store the promise both locally and globally
    this.deviceFlowInProgress = true;
    this.deviceFlowPromise = deviceFlowPromise;
    GitHubCopilotTokenManager.activeDeviceFlows.set(globalKey, deviceFlowPromise);

    try {
      const result = await deviceFlowPromise;
      return result;
    } finally {
      // Clean up after completion or error
      this.deviceFlowInProgress = false;
      this.deviceFlowPromise = null;
      GitHubCopilotTokenManager.activeDeviceFlows.delete(globalKey);
    }
  }

  private async _performDeviceFlow(): Promise<DeviceFlowInfo> {
    const clientId = 'Iv1.b507a08c87ecfe98'; // GitHub Copilot client ID
    const authHeaders = {
      'accept': 'application/json',
      'content-type': 'application/json',
      'user-agent': 'GithubCopilot/1.155.0',
      'accept-encoding': 'gzip,deflate,br',
      ...this.getEditorVersionHeaders(),
    };

    logger.debug('Making request to GitHub device code endpoint...');
    // Step 1: Request device code
    const deviceCodeResponse = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        client_id: clientId,
        scope: 'read:user',
      }),
    });

    logger.debug('Device code response status:', deviceCodeResponse.status);
    if (!deviceCodeResponse.ok) {
      const errorText = await deviceCodeResponse.text();
      logger.error('Device code request failed:', errorText);
      throw new Error(`Failed to get device code: ${deviceCodeResponse.status} ${errorText}`);
    }

    const deviceData: DeviceFlowResponse = await deviceCodeResponse.json();
    logger.debug('Device flow response received:', {
      hasDeviceCode: !!deviceData.device_code,
      hasUserCode: !!deviceData.user_code,
      hasVerificationUri: !!deviceData.verification_uri,
      expiresIn: deviceData.expires_in
    });
    
    if (!deviceData.device_code || !deviceData.user_code || !deviceData.verification_uri) {
      logger.error('Invalid device flow response:', deviceData);
      throw new Error(`Invalid response from GitHub: ${JSON.stringify(deviceData)}`);
    }

    logger.debug('Device flow initialized successfully');
    return {
      deviceCode: deviceData.device_code,
      userCode: deviceData.user_code,
      verificationUri: deviceData.verification_uri,
      expiresIn: deviceData.expires_in,
      interval: deviceData.interval || 5,
    };
  }

  async pollForToken(deviceCode: string, interval: number): Promise<string | null> {
    // Create a unique key for this device code to prevent duplicate polling
    const pollKey = `poll-${deviceCode}`;
    
    // Instance-level deduplication
    if (this.pollPromise) {
      logger.debug('Poll already in progress for this instance, returning existing promise');
      return this.pollPromise;
    }

    // Global deduplication: check if any instance is already polling this device code
    const existingGlobalPoll = GitHubCopilotTokenManager.activePollPromises.get(pollKey);
    if (existingGlobalPoll) {
      logger.debug('Poll already in progress globally for this device code, reusing existing poll');
      return existingGlobalPoll;
    }

    // Create the poll promise
    const pollPromise = this._performPollForToken(deviceCode, interval);
    
    // Store the promise both locally and globally
    this.pollPromise = pollPromise;
    GitHubCopilotTokenManager.activePollPromises.set(pollKey, pollPromise);

    try {
      const result = await pollPromise;
      return result;
    } finally {
      // Clean up after completion or error
      this.pollPromise = null;
      GitHubCopilotTokenManager.activePollPromises.delete(pollKey);
    }
  }

  private async _performPollForToken(deviceCode: string, interval: number): Promise<string | null> {
    const clientId = 'Iv1.b507a08c87ecfe98';
    const authHeaders = {
      'accept': 'application/json',
      'content-type': 'application/json',
      'user-agent': 'GithubCopilot/1.155.0',
      'accept-encoding': 'gzip,deflate,br',
      ...this.getEditorVersionHeaders(),
    };

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const tokenData: AccessTokenResponse = await tokenResponse.json();

    if (tokenData.error) {
      const error = tokenData.error;
      if (error === 'authorization_pending') {
        return null; // Continue polling
      } else if (error === 'slow_down') {
        throw new Error('slow_down');
      } else if (error === 'expired_token') {
        throw new Error('Device code expired. Please restart authentication.');
      } else if (error === 'access_denied') {
        throw new Error('Authentication was denied.');
      } else {
        throw new Error(`Authentication error: ${error}`);
      }
    }

    if (tokenData.access_token) {
      await this.saveTokenToFile(tokenData.access_token);
      return tokenData.access_token;
    }

    return null;
  }

  async setupDeviceFlowAuth(): Promise<string | null> {
    logger.debug('Starting GitHub OAuth device flow authentication...');

    try {
      const deviceFlowInfo = await this.startDeviceFlow();
      
      logger.debug(`Please visit ${deviceFlowInfo.verificationUri} and enter code ${deviceFlowInfo.userCode} to authenticate.`);
      logger.debug('Waiting for authentication...');

      // Step 2: Poll for access token
      const interval = deviceFlowInfo.interval * 1000; // Convert to milliseconds
      const maxTime = Date.now() + (deviceFlowInfo.expiresIn * 1000);

      while (Date.now() < maxTime) {
        await new Promise(resolve => setTimeout(resolve, interval));

        try {
          const token = await this.pollForToken(deviceFlowInfo.deviceCode, deviceFlowInfo.interval);
          if (token) {
            logger.debug('Authentication success!');
            logger.debug(`Token saved to ${this.tokenFilePath}`);
            return token;
          }
        } catch (error) {
          if (error instanceof Error) {
            if (error.message === 'slow_down') {
              logger.debug('Polling too fast, slowing down...');
              await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
              continue;
            } else {
              logger.error(error.message);
              return null;
            }
          }
        }
      }

      logger.error('Authentication timeout. Please try again.');
      return null;
    } catch (error) {
      logger.error(`Device flow authentication failed: ${error}`);
      return null;
    }
  }

  /**
   * Clean up any ongoing operations for this instance.
   * Useful when the instance is being destroyed or reset.
   */
  cleanup(): void {
    this.deviceFlowInProgress = false;
    this.deviceFlowPromise = null;
    this.pollPromise = null;
    this.cachedToken = null;
  }

  /**
   * Static method to clean up all global state.
   * Useful for testing or when resetting the entire application state.
   */
  static clearGlobalState(): void {
    GitHubCopilotTokenManager.activeDeviceFlows.clear();
    GitHubCopilotTokenManager.activePollPromises.clear();
  }

  private async saveTokenToFile(token: string): Promise<void> {
    try {
      fs.writeFileSync(this.tokenFilePath, token, { mode: 0o600 }); // Restrict permissions
    } catch (error) {
      logger.error(`Error saving token file: ${error}`);
      throw error;
    }
  }

  loadTokenFromFile(): string | null {
    try {
      if (fs.existsSync(this.tokenFilePath)) {
        const token = fs.readFileSync(this.tokenFilePath, 'utf8').trim();
        if (token) {
          logger.debug('Token loaded from file');
          return token;
        }
      }
    } catch (error) {
      logger.debug('Error reading token file:', error);
    }
    return null;
  }

  static async getGitHubToken(useDeviceFlow = true): Promise<string | null> {
    const manager = new GitHubCopilotTokenManager({ token: '' });
    
    // Try loading from file first
    const existingToken = manager.loadTokenFromFile();
    if (existingToken) {
      return existingToken;
    }

    // Use device flow by default when no token is found
    if (useDeviceFlow) {
      logger.debug('No existing token found. Starting OAuth device flow authentication...');
      return await manager.setupDeviceFlowAuth();
    }

    // Fallback to environment variable
    const envToken = process.env.GITHUB_TOKEN || process.env.GITHUB_COPILOT_TOKEN;
    if (envToken) {
      logger.debug('Using token from environment variable');
      return envToken;
    }

    logger.error('GitHub token not found in file or environment variables.');
    return null;
  }
}

export class GitHubCopilotChatClient {
  private tokenManager: GitHubCopilotTokenManager;
  private model: string;
  private chatMessages: Array<{ content: string; role: string }> = [];
  private currentCopilotToken: string | null = null;

  constructor(tokenManager: GitHubCopilotTokenManager, model = 'gpt-4o') {
    this.tokenManager = tokenManager;
    this.model = model;
  }

  private async ensureCopilotToken(): Promise<boolean> {
    if (this.currentCopilotToken === null) {
      // Validate GitHub token first
      const isValid = await this.tokenManager.validateToken();
      if (!isValid) {
        logger.debug('Invalid GitHub token');
        return false;
      }

      // Get Copilot token
      const copilotTokenInfo = await this.tokenManager.getCopilotToken();
      if (copilotTokenInfo) {
        this.currentCopilotToken = copilotTokenInfo.token;
        logger.debug('Successfully obtained Copilot token for chat');
        return true;
      } else {
        logger.debug('Failed to obtain Copilot token for chat');
        return false;
      }
    }
    return true;
  }

  async sendMessage(message: string): Promise<string> {
    // Ensure we have a valid Copilot token
    if (!(await this.ensureCopilotToken())) {
      return 'Error: Unable to obtain Copilot token';
    }

    this.chatMessages.push({ content: message, role: 'user' });

    try {
      const response = await fetch('https://api.githubcopilot.com/chat/completions', {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${this.currentCopilotToken}`,
          'Editor-Version': `${this.tokenManager['config'].editorName}/${this.tokenManager['config'].editorVersion}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          intent: false,
          model: this.model,
          temperature: 0,
          top_p: 1,
          n: 1,
          stream: true,
          messages: this.chatMessages,
        }),
      });

      if (!response.ok) {
        logger.error(`Chat error - Status code: ${response.status}`);
        const errorText = await response.text();
        logger.error(`Response: ${errorText}`);
        return `Error: No response received (Status: ${response.status})`;
      }

      const responseText = await response.text();
      let result = '';

      // Parse the response text, splitting it by newlines
      const lines = responseText.split('\n');
      for (const line of lines) {
        // If the line contains a completion, process it
        if (line.startsWith('data: {')) {
          try {
            // Parse the completion from the line as json
            const jsonCompletion = JSON.parse(line.slice(6));
            const choices = jsonCompletion.choices || [];
            if (choices.length > 0) {
              const delta = choices[0].delta || {};
              const completion = delta.content;
              if (completion) {
                result += completion;
              } else {
                result += '\n';
              }
            }
          } catch (error) {
            // Ignore JSON parse errors
          }
        }
      }

      this.chatMessages.push({ content: result, role: 'assistant' });

      if (result === '') {
        return `Error: No response received (Status: ${response.status})`;
      }

      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Connection')) {
        return 'Error: Connection failed';
      }
      return `Error: ${error}`;
    }
  }

  clearHistory(): void {
    this.chatMessages = [];
    logger.debug('Chat history cleared');
  }

  getHistory(): Array<{ content: string; role: string }> {
    return [...this.chatMessages];
  }
} 