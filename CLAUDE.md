# Claude Instructions for GitHub Issue Workflow

This file contains instructions for Claude to efficiently work on GitHub issues by reading, planning, implementing, and closing them.

## GitHub Issue Workflow

When asked to work on a GitHub issue, follow these steps:

### 1. Read and Analyze the Issue
- Use `gh issue view <issue_number>` to read the full issue details
- Extract key requirements, acceptance criteria, and any linked resources
- Identify the issue type (bug fix, feature request, enhancement, etc.)

### 2. Plan the Work
- Use the TodoWrite tool to create a structured plan with specific tasks
- Break down complex requirements into smaller, manageable steps
- Include tasks for testing, linting, and verification

### 3. Investigate the Codebase
- Search for relevant files and code patterns using Grep and Glob tools
- Understand existing implementations and conventions
- Identify files that need modification or creation

### 4. Implement the Changes
- Follow existing code conventions and patterns
- Make targeted, focused changes that address the issue requirements
- Ensure code quality and maintainability

### 5. Verify the Implementation
- Run tests using `npm test` if available
- Run type checking with `npm run typecheck`
- Test the changes manually if applicable

### 6. Commit and Push Changes
- Stage relevant files with `git add`
- Create a descriptive commit message that references the issue
- Push changes to the current branch or create a new branch if needed

### 7. Close the Issue
- Use `gh issue close <issue_number>` with an appropriate comment
- Ensure the closing comment summarizes what was implemented

## Project-Specific Commands

For this project, always run these verification commands after making changes:
- `npm run typecheck` - TypeScript type checking
- `npm test` - Run test suite

## Branch Strategy
- Work on feature branches when appropriate
- Use descriptive branch names like `fix/issue-123` or `feature/workflow-command`
- Push to origin before closing issues

## Commit Message Format
Use conventional commit format:
- `fix: description` for bug fixes
- `feat: description` for new features
- `docs: description` for documentation
- `refactor: description` for refactoring
- `test: description` for tests

Always include the issue number in commit messages: `fixes #123`

## Error Handling
- If tests fail, fix them before closing the issue
- If unable to complete the issue, leave detailed comments about blockers

## Document Guidance
- Include at most one example in documentation; omit examples for trivial cases.
- Do not generate examples or documentation when making code changes unless explicitly requested.