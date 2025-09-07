/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

// Authentication components
export { GitHubCopilotAuthDialog } from './GitHubCopilotAuthDialog.js';
export { AzureOpenAIAuthDialog, type AzureOpenAIValues } from './AzureOpenAIAuthDialog.js';

// Agent system
export { agentCommand } from './agentCommand.js';
export { AgentDialog } from './AgentDialog.js';
export { AgentSelector } from './AgentSelector.js';
export { useAgentCommand } from './useAgentCommand.js';
export { switchAgent } from './agentUtils.js';

// Model system
export { modelCommand } from './modelCommand.js';
export { ModelDialog } from './ModelDialog.js';
export { ModelSelector } from './modelSelector.js';
export { useModelCommand } from './useModelCommand.js';
export { AVAILABLE_MODELS } from './models.js';

// Configuration system
export { configCommand } from './configCommand.js';
