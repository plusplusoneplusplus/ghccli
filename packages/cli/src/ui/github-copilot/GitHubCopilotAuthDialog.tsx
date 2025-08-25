/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../colors.js';
import { 
  GitHubCopilotTokenManager, 
  DeviceFlowInfo 
} from '@google/gemini-cli-core';

const logger = {
  debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
};

interface GitHubCopilotAuthDialogProps {
  onSuccess: (token: string) => void;
  onCancel: () => void;
  onError: (error: string) => void;
}

interface DeviceFlowState {
  deviceFlowInfo?: DeviceFlowInfo;
  isPolling: boolean;
  isCompleted: boolean;
  error?: string;
}

export function GitHubCopilotAuthDialog({
  onSuccess,
  onCancel,
  onError,
}: GitHubCopilotAuthDialogProps): React.JSX.Element {
  const [deviceFlowState, setDeviceFlowState] = useState<DeviceFlowState>({
    isPolling: false,
    isCompleted: false,
  });
  const [isInitializing, setIsInitializing] = useState(true);
  const hasInitialized = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onCancelRef = useRef(onCancel);

  // Update refs when props change
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
    onCancelRef.current = onCancel;
  }, [onSuccess, onError, onCancel]);

  useEffect(() => {
    // Prevent multiple initializations
    if (hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;

    const initializeDeviceFlow = async () => {
      try {
        setIsInitializing(true);
        
        // Check if token already exists
        logger.debug('Checking for existing GitHub Copilot token...');
        const manager = new GitHubCopilotTokenManager({ token: '' });
        const existingToken = manager.loadTokenFromFile();
        
        if (existingToken) {
          logger.debug('Found existing token, validating...');
          // Validate existing token with timeout
          const validationManager = new GitHubCopilotTokenManager({ token: existingToken });
          
          // Add timeout to prevent hanging
          const validationPromise = validationManager.validateToken();
          const timeoutPromise = new Promise<boolean>((_, reject) => 
            setTimeout(() => reject(new Error('Token validation timeout')), 10000)
          );
          
          try {
            const isValid = await Promise.race([validationPromise, timeoutPromise]);
            
            if (isValid) {
              logger.debug('Existing token is valid, using it');
              setDeviceFlowState({ isPolling: false, isCompleted: true });
              onSuccessRef.current(existingToken);
              return;
            } else {
              logger.debug('Existing token is invalid, proceeding with device flow');
            }
          } catch (validationError) {
            logger.debug('Token validation failed or timed out:', validationError);
            // Continue with device flow if validation fails
          }
        } else {
          logger.debug('No existing token found, starting device flow');
        }

        // Start device flow
        logger.debug('Starting GitHub device flow...');
        await startDeviceFlow();
        setIsInitializing(false);
      } catch (error) {
        logger.error('Device flow initialization error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        setDeviceFlowState({ isPolling: false, isCompleted: false, error: errorMessage });
        onErrorRef.current(errorMessage);
        setIsInitializing(false);
      }
    };

    void initializeDeviceFlow();
  }, []); // Empty dependency array - run only once

  const startDeviceFlow = useCallback(async () => {
    const manager = new GitHubCopilotTokenManager({ token: '' });
    
    try {
      logger.debug('Requesting device code from GitHub...');
      // Get device flow information with timeout
      const deviceFlowPromise = manager.startDeviceFlow();
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('GitHub device flow request timeout after 15 seconds')), 15000)
      );
      
      const deviceFlowInfo = await Promise.race([deviceFlowPromise, timeoutPromise]);
      
      logger.debug('Device flow info received:', {
        verificationUri: deviceFlowInfo.verificationUri,
        userCode: deviceFlowInfo.userCode,
        expiresIn: deviceFlowInfo.expiresIn
      });
      
      setDeviceFlowState({
        deviceFlowInfo,
        isPolling: true,
        isCompleted: false,
      });

      // Start polling for token after a brief delay to allow UI to render
      logger.debug('Starting token polling...');
      setTimeout(() => {
        pollForToken(manager, deviceFlowInfo).catch((error) => {
          logger.error('Polling error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          setDeviceFlowState({ isPolling: false, isCompleted: false, error: errorMessage });
          onErrorRef.current(errorMessage);
        });
      }, 100); // Small delay to ensure UI renders
    } catch (error) {
      logger.error('Device flow error:', error);
      throw error;
    }
  }, []); // useCallback dependency array

  const pollForToken = useCallback(async (manager: GitHubCopilotTokenManager, deviceFlowInfo: DeviceFlowInfo) => {
    const interval = deviceFlowInfo.interval * 1000; // Convert to milliseconds
    const maxTime = Date.now() + (deviceFlowInfo.expiresIn * 1000);

    while (Date.now() < maxTime) {
      await new Promise(resolve => setTimeout(resolve, interval));

      try {
        const token = await manager.pollForToken(deviceFlowInfo.deviceCode, deviceFlowInfo.interval);
        if (token) {
          setDeviceFlowState({ isPolling: false, isCompleted: true });
          onSuccessRef.current(token);
          return;
        }
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'slow_down') {
            // Wait longer and continue
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
          } else {
            throw error;
          }
        }
      }
    }

    throw new Error('Authentication timeout. Please try again.');
  }, []); // useCallback dependency array

  useInput((_input, key) => {
    if (key.escape && !deviceFlowState.isPolling) {
      onCancelRef.current();
    }
  });

  if (isInitializing) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.Gray}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold>GitHub Copilot Authentication</Text>
        <Box marginTop={1}>
          <Text>Initializing GitHub Copilot authentication...</Text>
        </Box>
      </Box>
    );
  }

  if (deviceFlowState.error) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.AccentRed}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold color={Colors.AccentRed}>GitHub Copilot Authentication Failed</Text>
        <Box marginTop={1}>
          <Text color={Colors.AccentRed}>{deviceFlowState.error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Press Escape to go back</Text>
        </Box>
      </Box>
    );
  }

  if (deviceFlowState.isCompleted) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.AccentGreen}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold color={Colors.AccentGreen}>GitHub Copilot Authentication Successful</Text>
        <Box marginTop={1}>
          <Text>Successfully authenticated with GitHub Copilot!</Text>
        </Box>
      </Box>
    );
  }

  // Show device flow information to user
  if (deviceFlowState.deviceFlowInfo) {
    return (
      <Box
        borderStyle="round"
        borderColor={Colors.AccentBlue}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold>GitHub Copilot Authentication</Text>
        
        <Box marginTop={1}>
          <Text>To complete authentication, follow these steps:</Text>
        </Box>
        
        <Box marginTop={1}>
          <Text>1. Open your browser and visit:</Text>
        </Box>
        <Box marginLeft={2} marginTop={1}>
          <Text color={Colors.AccentBlue} bold>
            {deviceFlowState.deviceFlowInfo.verificationUri}
          </Text>
        </Box>
        
        <Box marginTop={1}>
          <Text>2. Enter this code when prompted:</Text>
        </Box>
        <Box marginLeft={2} marginTop={1}>
          <Text color={Colors.AccentGreen} bold>
            {deviceFlowState.deviceFlowInfo.userCode}
          </Text>
        </Box>
        
        <Box marginTop={1}>
          <Text>3. Follow the instructions to authorize Gemini CLI</Text>
        </Box>
        
        <Box marginTop={1}>
          <Text color={Colors.Gray}>
            You'll need an active GitHub Copilot subscription to proceed.
          </Text>
        </Box>
        
        <Box marginTop={1}>
          <Text color={Colors.Gray}>
            {deviceFlowState.isPolling ? 'Waiting for authorization...' : 'Ready to authenticate'}
          </Text>
        </Box>
        
        <Box marginTop={1}>
          <Text color={Colors.Gray}>Press Escape to cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={Colors.AccentBlue}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>GitHub Copilot Authentication</Text>
      <Box marginTop={1}>
        <Text>Setting up GitHub Copilot authentication...</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={Colors.Gray}>Press Escape to cancel</Text>
      </Box>
    </Box>
  );
}