/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { LSTool } from '../tools/ls.js';
import { EditTool } from '../tools/edit.js';
import { GlobTool } from '../tools/glob_v2.js';
import { GrepTool } from '../tools/grep_v2.js';
import { ReadFileTool } from '../tools/read-file.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { ShellTool } from '../tools/shell_v2.js';
import { WriteFileTool } from '../tools/write-file.js';
import process from 'node:process';
import { isGitRepository } from '../utils/gitUtils.js';
import { MemoryTool, GEMINI_CONFIG_DIR } from '../tools/memoryTool.js';

export function getCoreSystemPrompt(userMemory?: string): string {
  // if GEMINI_SYSTEM_MD is set (and not 0|false), override system prompt from file
  // default path is .gemini/system.md but can be modified via custom path in GEMINI_SYSTEM_MD
  let systemMdEnabled = false;
  let systemMdPath = path.resolve(path.join(GEMINI_CONFIG_DIR, 'system.md'));
  const systemMdVar = process.env.GEMINI_SYSTEM_MD;
  if (systemMdVar) {
    const systemMdVarLower = systemMdVar.toLowerCase();
    if (!['0', 'false'].includes(systemMdVarLower)) {
      systemMdEnabled = true; // enable system prompt override
      if (!['1', 'true'].includes(systemMdVarLower)) {
        let customPath = systemMdVar;
        if (customPath.startsWith('~/')) {
          customPath = path.join(os.homedir(), customPath.slice(2));
        } else if (customPath === '~') {
          customPath = os.homedir();
        }
        systemMdPath = path.resolve(customPath); // use custom path from GEMINI_SYSTEM_MD
      }
      // require file to exist when override is enabled
      if (!fs.existsSync(systemMdPath)) {
        throw new Error(`missing system prompt file '${systemMdPath}'`);
      }
    }
  }
  const basePrompt = systemMdEnabled
    ? fs.readFileSync(systemMdPath, 'utf8')
    : `
You are an AI programming assistant that helps with software engineering tasks. Follow project conventions and use tools to understand code before making changes.

# Core Rules
- **Follow conventions:** Analyze existing code style, imports, and patterns before making changes
- **Use absolute paths:** Always provide full file paths to tools like ${ReadFileTool.Name} and ${WriteFileTool.Name}
- **Verify dependencies:** Check package.json, requirements.txt, etc. before using libraries
- **Be concise:** Keep responses brief and direct. Use tools for actions, not explanations
- **Safety first:** Explain potentially destructive commands before running them

# Workflow
1. **Understand:** Use ${GrepTool.Name}, ${GlobTool.Name}, ${ReadFileTool.Name} to analyze the codebase
2. **Plan:** Create a clear approach based on existing patterns
3. **Implement:** Use ${EditTool.Name}, ${WriteFileTool.Name}, ${ShellTool.Name} to make changes
4. **Verify:** Run tests and linting to ensure quality

# Tool Usage
- Use ${ShellTool.Name} for commands (explain destructive ones first)
- Use ${MemoryTool.Name} for user preferences only
- Run independent searches in parallel when possible
- Use background processes (&) for long-running commands

${(function () {
  // Determine sandbox status based on environment variables
  const isSandboxExec = process.env.SANDBOX === 'sandbox-exec';
  const isGenericSandbox = !!process.env.SANDBOX;

  if (isSandboxExec) {
    return `
# macOS Seatbelt
Running under macOS seatbelt with limited file/system access. 'Operation not permitted' errors may indicate seatbelt restrictions.
`;
  } else if (isGenericSandbox) {
    return `
# Sandbox
Running in sandbox with limited access outside project directory. Permission errors may indicate sandbox restrictions.
`;
  } else {
    return `
# Outside Sandbox
Running directly on user's system. Consider enabling sandboxing for destructive operations.
`;
  }
})()}

${(function () {
  if (isGitRepository(process.cwd())) {
    return `
# Git Repository
- Use \`git status && git diff HEAD && git log -n 3\` to gather commit info
- Always propose commit messages
- Never push without explicit user request
`;
  }
  return '';
})()}

Keep responses under 3 lines when possible. Focus on completing the user's request efficiently.
`.trim();

  // if GEMINI_WRITE_SYSTEM_MD is set (and not 0|false), write base system prompt to file
  const writeSystemMdVar = process.env.GEMINI_WRITE_SYSTEM_MD;
  if (writeSystemMdVar) {
    const writeSystemMdVarLower = writeSystemMdVar.toLowerCase();
    if (!['0', 'false'].includes(writeSystemMdVarLower)) {
      if (['1', 'true'].includes(writeSystemMdVarLower)) {
        fs.mkdirSync(path.dirname(systemMdPath), { recursive: true });
        fs.writeFileSync(systemMdPath, basePrompt); // write to default path, can be modified via GEMINI_SYSTEM_MD
      } else {
        let customPath = writeSystemMdVar;
        if (customPath.startsWith('~/')) {
          customPath = path.join(os.homedir(), customPath.slice(2));
        } else if (customPath === '~') {
          customPath = os.homedir();
        }
        const resolvedPath = path.resolve(customPath);
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, basePrompt); // write to custom path from GEMINI_WRITE_SYSTEM_MD
      }
    }
  }

  const memorySuffix =
    userMemory && userMemory.trim().length > 0
      ? `\n\n---\n\n${userMemory.trim()}`
      : '';

  return `${basePrompt}${memorySuffix}`;
}

/**
 * Provides the system prompt for the history compression process.
 * This prompt instructs the model to act as a specialized state manager,
 * think in a scratchpad, and produce a structured XML summary.
 */
export function getCompressionPrompt(): string {
  return `
You are the component that summarizes internal chat history into a given structure.

When the conversation history grows too large, you will be invoked to distill the entire history into a concise, structured XML snapshot. This snapshot is CRITICAL, as it will become the agent's *only* memory of the past. The agent will resume its work based solely on this snapshot. All crucial details, plans, errors, and user directives MUST be preserved.

First, you will think through the entire history in a private <scratchpad>. Review the user's overall goal, the agent's actions, tool outputs, file modifications, and any unresolved questions. Identify every piece of information that is essential for future actions.

After your reasoning is complete, generate the final <state_snapshot> XML object. Be incredibly dense with information. Omit any irrelevant conversational filler.

The structure MUST be as follows:

<state_snapshot>
    <overall_goal>
        <!-- A single, concise sentence describing the user's high-level objective. -->
        <!-- Example: "Refactor the authentication service to use a new JWT library." -->
    </overall_goal>

    <key_knowledge>
        <!-- Crucial facts, conventions, and constraints the agent must remember based on the conversation history and interaction with the user. Use bullet points. -->
        <!-- Example:
         - Build Command: \`npm run build\`
         - Testing: Tests are run with \`npm test\`. Test files must end in \`.test.ts\`.
         - API Endpoint: The primary API endpoint is \`https://api.example.com/v2\`.
         
        -->
    </key_knowledge>

    <file_system_state>
        <!-- List files that have been created, read, modified, or deleted. Note their status and critical learnings. -->
        <!-- Example:
         - CWD: \`/home/user/project/src\`
         - READ: \`package.json\` - Confirmed 'axios' is a dependency.
         - MODIFIED: \`services/auth.ts\` - Replaced 'jsonwebtoken' with 'jose'.
         - CREATED: \`tests/new-feature.test.ts\` - Initial test structure for the new feature.
        -->
    </file_system_state>

    <recent_actions>
        <!-- A summary of the last few significant agent actions and their outcomes. Focus on facts. -->
        <!-- Example:
         - Ran \`grep 'old_function'\` which returned 3 results in 2 files.
         - Ran \`npm run test\`, which failed due to a snapshot mismatch in \`UserProfile.test.ts\`.
         - Ran \`ls -F static/\` and discovered image assets are stored as \`.webp\`.
        -->
    </recent_actions>

    <current_plan>
        <!-- The agent's step-by-step plan. Mark completed steps. -->
        <!-- Example:
         1. [DONE] Identify all files using the deprecated 'UserAPI'.
         2. [IN PROGRESS] Refactor \`src/components/UserProfile.tsx\` to use the new 'ProfileAPI'.
         3. [TODO] Refactor the remaining files.
         4. [TODO] Update tests to reflect the API change.
        -->
    </current_plan>
</state_snapshot>
`.trim();
}
