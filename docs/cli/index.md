# Gemini CLI

Within Gemini CLI, `packages/cli` is the frontend for users to send and receive prompts with the Gemini AI model and its associated tools. For a general overview of Gemini CLI, see the [main documentation page](../index.md).

## Navigating this section

- **[Authentication](./authentication.md):** A guide to setting up authentication with Google's AI services.
- **[Commands](./commands.md):** A reference for Gemini CLI commands (e.g., `/help`, `/tools`, `/theme`).
- **[Configuration](./configuration.md):** A guide to tailoring Gemini CLI behavior using configuration files.
- **[JSON Output](./json-output.md):** Complete reference for JSON output mode in non-interactive usage.
- **[Token Caching](./token-caching.md):** Optimize API costs through token caching.
- **[Themes](./themes.md)**: A guide to customizing the CLI's appearance with different themes.
- **[Tutorials](tutorials.md)**: A tutorial showing how to use Gemini CLI to automate a development task.

## Non-interactive mode

Gemini CLI can be run in a non-interactive mode, which is useful for scripting and automation. In this mode, you pipe input to the CLI, it executes the command, and then it exits.

The following example pipes a command to Gemini CLI from your terminal:

```bash
echo "What is fine tuning?" | gemini
```

Gemini CLI executes the command and prints the output to your terminal. Note that you can achieve the same behavior by using the `--prompt` or `-p` flag. For example:

```bash
gemini -p "What is fine tuning?"
```

### JSON Output Mode

For programmatic use cases, Gemini CLI supports JSON output format in non-interactive mode. This is particularly useful for automation, CI/CD pipelines, and when integrating with other tools.

#### Basic Usage

Use the `--output-format json` flag to enable JSON output:

```bash
# Basic JSON output
gemini --output-format json --prompt "What is 2+2?"

# Compact JSON output (single line, no indentation)
gemini --output-format json --no-pretty-print --prompt "List files in current directory"

# Using with pipes and jq
echo "Analyze this code" | gemini --output-format json | jq '.content'
```

#### JSON Output Schema

The JSON output follows a structured schema with the following fields:

```json
{
  "status": "success|error|partial",
  "message": "Human-readable status message",
  "content": "Main response content from the AI model",
  "toolCalls": [
    {
      "id": "unique-tool-call-id",
      "name": "tool-name",
      "arguments": {...},
      "result": "tool-execution-result",
      "status": "success|error",
      "timestamp": "2025-01-15T10:30:00.000Z",
      "duration": 150
    }
  ],
  "metadata": {
    "sessionId": "session-identifier",
    "promptId": "prompt-identifier", 
    "model": "gemini-2.5-pro",
    "turnCount": 1,
    "timestamp": "2025-01-15T10:30:00.000Z"
  },
  "error": {
    "type": "ErrorType",
    "message": "Error description",
    "details": {...}
  },
  "schemaVersion": 1
}
```

#### Examples

**Simple text query:**
```bash
$ gemini --output-format json --prompt "Hello world"
{
  "status": "success",
  "message": "Response generated successfully",
  "content": "Hello! How can I help you today?",
  "toolCalls": [],
  "metadata": {
    "sessionId": "session-abc123",
    "promptId": "prompt-def456",
    "model": "gemini-2.5-pro",
    "turnCount": 1,
    "timestamp": "2025-01-15T10:30:00.000Z"
  },
  "schemaVersion": 1
}
```

**Query with tool execution:**
```bash
$ gemini --output-format json --prompt "List the files in the current directory"
{
  "status": "success", 
  "message": "Command executed successfully",
  "content": "Here are the files in the current directory:\n...",
  "toolCalls": [
    {
      "id": "shell-001",
      "name": "run_shell_command",
      "arguments": {"command": "ls -la"},
      "result": "total 48\ndrwxr-xr-x  12 user staff   384 Jan 15 10:30 .\n...",
      "status": "success",
      "timestamp": "2025-01-15T10:30:01.000Z",
      "duration": 45
    }
  ],
  "metadata": {
    "sessionId": "session-abc123",
    "promptId": "prompt-ghi789", 
    "model": "gemini-2.5-pro",
    "turnCount": 1,
    "timestamp": "2025-01-15T10:30:00.000Z"
  },
  "schemaVersion": 1
}
```

**Error scenario:**
```bash
$ gemini --output-format json --prompt "Read /nonexistent/file"
{
  "status": "error",
  "message": "Tool execution failed",
  "content": "",
  "toolCalls": [
    {
      "id": "read-001",
      "name": "read_file",
      "arguments": {"file_path": "/nonexistent/file"},
      "result": "File not found: /nonexistent/file",
      "status": "error",
      "timestamp": "2025-01-15T10:30:02.000Z",
      "duration": 5
    }
  ],
  "error": {
    "type": "ToolExecutionError",
    "message": "Failed to read file",
    "details": {
      "file_path": "/nonexistent/file",
      "error_code": "ENOENT"
    }
  },
  "metadata": {
    "sessionId": "session-abc123",
    "promptId": "prompt-jkl012",
    "model": "gemini-2.5-pro", 
    "turnCount": 1,
    "timestamp": "2025-01-15T10:30:00.000Z"
  },
  "schemaVersion": 1
}
```

#### Command-line Options

- `--output-format json`: Enable JSON output mode
- `--pretty-print` (default): Format JSON with indentation for readability
- `--no-pretty-print`: Output compact JSON on a single line

For complete JSON schema reference, tool integration examples, and best practices, see the [JSON Output documentation](./json-output.md).
