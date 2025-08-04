# Merge Conflict Reduction Strategy

This document outlines the strategy implemented to reduce merge conflicts when pulling from the upstream Gemini CLI repository.

## Problem

This project is a fork of the [official Google Gemini CLI](https://github.com/google-gemini/gemini-cli) with custom agent and workflow features. Frequent upstream changes create merge conflicts, especially in:

1. **Agent and workflow configurations** - Custom features added to the codebase
2. **Logging modifications** - Enhanced logging for workflow operations

## Solution: Configuration Reorganization

### 1. Moved Custom Configurations to Top of Classes/Interfaces

All custom agent and workflow configurations have been moved to the beginning of configuration classes and interfaces. This reduces conflicts because upstream changes typically happen at the end.

#### Files Modified:

**`packages/core/src/config/config.ts`:**
- `ConfigParameters` interface: Moved custom parameters (`agent`, `enableOpenAILogging`, `outputLoggerFile`, `approvalMode`) to top with clear section markers
- `Config` class: Moved custom properties (`agent`, `agentSwitchedDuringSession`, `enableOpenAILogging`, `outputLoggerFile`, `approvalMode`) to top
- Constructor: Moved custom initialization to top of constructor
- Methods: Added custom methods (`getAgent()`, `getCurrentAgent()`, `getEnableOpenAILogging()`, `getOutputLoggerFile()`, `getApprovalMode()`, `setApprovalMode()`, etc.) near beginning
- Tool registration: Moved custom tools (`AgentInvocationTool`, `WorkflowTool`) to top

**`packages/cli/src/config/settings.ts`:**
- `Settings` interface: Moved custom settings (`selectedAgent`, `approvalMode`) to top with section markers

**`packages/cli/src/config/config.ts`:**
- `CliArgs` interface: Moved custom parameters (`agent`, `outputLoggerFile`) to top with section markers

### 2. Section Markers Added

Clear comments added to distinguish custom vs upstream code:

```typescript
// === CUSTOM WORKFLOW & AGENT CONFIGURATIONS (GHCCLI Extensions) ===
// Keep these at the top to minimize merge conflicts with upstream changes

// === ORIGINAL GEMINI CLI CONFIGURATIONS ===
```

## Benefits

1. **Reduced Merge Conflicts**: Custom configurations at top are less likely to conflict with upstream additions at the end
2. **Clear Separation**: Easy to identify custom vs upstream code
3. **Maintainable**: Future custom additions should follow the same pattern
4. **Documentation**: Clear comments explain the reasoning

## Next Steps

### 2. Logging Extraction (Pending)

Extract custom logging modifications into configurable modules:
- Create wrapper classes for custom logging
- Use configuration-driven logging enhancements
- Avoid modifying upstream logging files directly

### 3. Git Configuration (Pending)

Set up automated merge strategies:
- Custom merge drivers for specific file types
- Git attributes for workflow-specific files
- Automated conflict resolution where possible

### 4. Monitoring System (Pending)

Track which files frequently cause conflicts to identify patterns and improve strategy.

## Guidelines for Future Development

1. **Always add custom configurations at the top** of interfaces and classes
2. **Use clear section markers** to distinguish custom vs upstream code
3. **Prefer composition over modification** - create wrapper classes instead of modifying upstream code
4. **Group related custom features** together to minimize scattered changes
5. **Document the reasoning** for custom modifications

## Custom Features Inventory

### Agent System
- `packages/core/src/agents/` - Agent configurations and implementations
- `packages/core/src/tools/agent-invocation.ts` - Multi-agent invocation tool
- Agent-related properties in config classes

### Workflow System
- `packages/core/src/workflow/` - Complete workflow system
- `packages/core/src/tools/workflow-tool.ts` - Workflow execution tool
- YAML workflow configurations

### Enhanced Logging & Configuration
- `packages/core/src/workflow/logging.ts` - Workflow-specific logging
- Enhanced debug logging throughout workflow system
- `enableOpenAILogging` and `outputLoggerFile` configuration options
- `approvalMode` configuration for automatic tool call confirmation

This strategy should significantly reduce merge conflicts while maintaining clean separation between custom and upstream code.