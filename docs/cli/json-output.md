# JSON Output Reference

This document provides detailed reference documentation for Gemini CLI's JSON output format, which is available in non-interactive mode.

## Overview

JSON output mode enables structured, machine-readable responses from Gemini CLI, making it ideal for:
- **Automation and scripting**: Parse responses programmatically
- **CI/CD pipelines**: Integrate with build and deployment workflows
- **Tool integration**: Process outputs with jq, Python scripts, or other tools
- **API-like usage**: Use Gemini CLI as a structured API endpoint

## Schema Reference

### JsonOutput (Root Object)

The main JSON response structure returned by Gemini CLI in non-interactive mode.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `"success" \| "error" \| "partial"` | ✅ | Overall execution status |
| `message` | `string` | ✅ | Human-readable status message |
| `content` | `string` | ✅ | Main response content from the AI model |
| `toolCalls` | `ToolCallResult[]` | ✅ | Array of tool executions (empty if no tools used) |
| `metadata` | `JsonOutputMetadata` | ✅ | Session and request metadata |
| `error` | `JsonOutputError \| undefined` | ❌ | Error details (only present when status is "error") |
| `schemaVersion` | `number` | ✅ | JSON schema version (currently 1) |

### JsonOutputMetadata

Metadata about the CLI session and request.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | `string` | ✅ | Unique identifier for this CLI session |
| `promptId` | `string` | ✅ | Unique identifier for this specific prompt |
| `model` | `string` | ✅ | AI model used (e.g., "gemini-2.5-pro") |
| `turnCount` | `number` | ✅ | Turn number within the session |
| `timestamp` | `string` | ✅ | ISO 8601 timestamp of when the request started |

### ToolCallResult

Details about a tool execution that occurred during processing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | ✅ | Unique identifier for this tool call |
| `name` | `string` | ✅ | Name of the tool that was executed |
| `arguments` | `object` | ✅ | Arguments passed to the tool |
| `result` | `string` | ✅ | Result returned by the tool |
| `status` | `"success" \| "error"` | ✅ | Tool execution status |
| `timestamp` | `string` | ✅ | ISO 8601 timestamp of tool execution |
| `duration` | `number \| undefined` | ❌ | Tool execution time in milliseconds |

### JsonOutputError

Error information when the overall status is "error".

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | ✅ | Error type/category |
| `message` | `string` | ✅ | Human-readable error message |
| `details` | `object \| undefined` | ❌ | Additional error context and details |

## Status Values

### success
- The request completed successfully
- The AI model generated a response
- All tool calls (if any) completed successfully
- `error` field will be undefined

### error  
- The request encountered an error that prevented completion
- Could be due to tool failures, network issues, or model errors
- `error` field will contain details about what went wrong
- `content` may be empty or contain partial results

### partial
- The request completed with mixed results
- Some tools succeeded while others failed
- The AI model provided a response despite tool failures
- Check individual tool call statuses for details

## Common Tool Names

When `toolCalls` contains executions, you may see these common tool names:

| Tool Name | Description |
|-----------|-------------|
| `run_shell_command` | Executed a shell command |
| `read_file` | Read contents of a file |
| `write_file` | Wrote content to a file |
| `read_many_files` | Read multiple files (used by @ commands) |
| `list_directory` | Listed directory contents |
| `web_search` | Performed a web search |
| `web_fetch` | Fetched content from a URL |

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--output-format json` | Enable JSON output mode | text |
| `--pretty-print` | Format JSON with indentation | `true` |
| `--no-pretty-print` | Output compact JSON on single line | `false` |

## Integration Examples

### Using with jq

Extract specific fields from JSON responses:

```bash
# Get just the AI's response content
gemini --output-format json --prompt "Hello" | jq -r '.content'

# Check if the request was successful
gemini --output-format json --prompt "Hello" | jq -r '.status'

# Get all tool execution results
gemini --output-format json --prompt "List files" | jq '.toolCalls[].result'

# Extract error information if present
gemini --output-format json --prompt "Bad command" | jq -r '.error // empty'
```

### Python Integration

```python
import subprocess
import json

def query_gemini(prompt):
    result = subprocess.run([
        'gemini', '--output-format', 'json', '--prompt', prompt
    ], capture_output=True, text=True)
    
    if result.returncode != 0:
        raise Exception(f"CLI error: {result.stderr}")
    
    return json.loads(result.stdout)

# Usage
response = query_gemini("What is 2+2?")
print(f"Status: {response['status']}")
print(f"Content: {response['content']}")

if response['toolCalls']:
    print(f"Tools used: {[tool['name'] for tool in response['toolCalls']]}")
```

### Shell Script Integration

```bash
#!/bin/bash

# Query Gemini and check for success
response=$(gemini --output-format json --prompt "Check system status" 2>/dev/null)

if [ $? -eq 0 ]; then
    status=$(echo "$response" | jq -r '.status')
    
    if [ "$status" = "success" ]; then
        echo "Success: $(echo "$response" | jq -r '.content')"
    else
        echo "Error: $(echo "$response" | jq -r '.error.message // "Unknown error"')"
    fi
else
    echo "Failed to execute command"
    exit 1
fi
```

## Schema Evolution

The JSON schema is versioned through the `schemaVersion` field to ensure backward compatibility:

- **Version 1** (current): Initial schema with all fields documented above
- Future versions will increment the version number and document changes here
- Always check `schemaVersion` when parsing JSON output programmatically

## Best Practices

1. **Always check `status`**: Verify the status before processing the response
2. **Handle errors gracefully**: Check for the `error` field when status is "error"
3. **Parse `toolCalls` individually**: Each tool call has its own status
4. **Use compact format for pipelines**: Use `--no-pretty-print` when piping to other tools
5. **Validate schema version**: Check `schemaVersion` for compatibility in automated scripts