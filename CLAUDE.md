# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GHCCLI is a command-line AI workflow tool built on top of the Gemini CLI. It connects to various AI providers (Gemini, GitHub Copilot, OpenAI), understands code, and accelerates development workflows through tools, MCP servers, and multimodal capabilities.

## ⚠️ Fork/Merge Conflict Minimization

This is a fork of the upstream Gemini CLI repository. All changes must minimize merge conflicts:
- Make incremental, focused commits
- Avoid unnecessary divergence (reformatting, renaming, restructuring)
- Regularly pull upstream changes and resolve conflicts early
- Consider merge impact when planning changes

## Architecture

### Workspace Structure
- `packages/cli/` - Main CLI application with React-based TUI
- `packages/core/` - Core functionality including AI clients, tools, and services
- `packages/test-utils/` - Shared testing utilities
- `packages/vscode-ide-companion/` - VSCode extension companion
- `bundle/` - Built distribution files
- `scripts/` - Build and development scripts

### Key Components
- **UI Layer** (`packages/cli/src/ui/`): React-based terminal interface with contexts, hooks, and components
- **Core Services** (`packages/core/src/`): 
  - AI providers (Gemini, GitHub Copilot, OpenAI, Azure OpenAI)
  - Tools system (file operations, shell, web search, MCP integration)
  - Agent system for multi-step workflows
- **Configuration** (`packages/cli/src/config/`): Settings, authentication, extensions
- **Tools** (`packages/core/src/tools/`): File operations, shell execution, web search, MCP clients

## Development Commands

### Essential Commands
```bash
# Start development
npm start
npm run debug                    # Start with debugger

# Build and bundle
npm run build                   # Build all packages
npm run bundle                  # Create distribution bundle
npm run build:all              # Build everything including sandbox and vscode

# Testing
npm test                        # Run all tests
npm run test:ci                 # CI test suite with coverage
npm run test:e2e               # End-to-end tests
npm run typecheck              # TypeScript checking

# Code Quality
npm run lint                    # Lint code
npm run lint:fix               # Fix linting issues
npm run format                 # Format code with Prettier

# Complete verification
npm run preflight              # Full build, test, and quality checks
```

### Package-Specific Commands
```bash
# Run commands in specific workspaces
npm run build --workspaces     # Build all packages
npm run test --workspaces --if-present  # Test all packages
npm run typecheck --workspaces --if-present  # Type check all packages
```

## Development Workflow

### Required Verification Steps
After making changes, always run:
1. `npm run typecheck` - Verify TypeScript
2. `npm test` - Run test suite  
3. `npm run lint` - Check code style
4. `npm run build` - Ensure build succeeds

### Testing Strategy
- Unit tests: Vitest for individual components/functions
- Integration tests: Full workflow testing in `integration-tests/`
- E2E tests: `npm run test:e2e` for end-to-end scenarios
- Test debugging: When tests fail, prioritize fixing test logic over production code

### Code Standards
- Strict TypeScript with comprehensive type checking
- ESLint with custom rules and import organization
- Prettier for consistent formatting
- React patterns for UI components
- ES modules (`"type": "module"`)

## Key Technologies

- **Runtime**: Node.js 20+ with ES modules
- **UI**: React with custom terminal interface (Ink-style)
- **Build**: esbuild for bundling, npm workspaces for monorepo
- **Testing**: Vitest with coverage, MSW for API mocking
- **AI Integration**: Multiple providers with unified interface
- **Tools**: MCP (Model Context Protocol) for extensibility

## Special Considerations

### Authentication
Multiple auth methods supported:
- OAuth (Google accounts)
- Gemini API keys
- GitHub Copilot integration
- OpenAI API keys
- Azure OpenAI

### Sandbox Execution
- Configurable sandbox modes: none, docker, podman
- Platform-specific sandbox profiles in `packages/cli/src/utils/`

### Extension System
- MCP server integration for tools and capabilities
- Command system with slash commands and completions
- Plugin architecture for custom functionality

## File Patterns to Know

- `*.test.ts` - Unit tests
- `*.integration.test.ts` - Integration tests  
- `*Command.ts` - UI commands
- `*Tool.ts` - Core tool implementations
- `*Service.ts` - Service layer components
- `*Context.tsx` - React contexts
- `use*.ts` - React hooks

## Troubleshooting

### Common Issues
- Build failures: Check TypeScript errors first
- Test failures: Usually test logic issues, not production code
- Import errors: Verify ES module syntax and package.json exports
- Auth issues: Check provider-specific setup in docs/

### Debug Mode
Use `npm run debug` to start with Node.js inspector for debugging complex issues.