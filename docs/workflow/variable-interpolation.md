# Variable Interpolation

The variable interpolation system enables dynamic workflow configuration by allowing you to reference variables, step outputs, environment variables, and call built-in functions within your workflow definitions.

## 📖 Table of Contents

- [Basic Syntax](#basic-syntax)
- [Variable Scoping](#variable-scoping)
- [Built-in Functions](#built-in-functions)
- [Advanced Features](#advanced-features)
- [Practical Examples](#practical-examples)
- [Error Handling](#error-handling)
- [Performance Considerations](#performance-considerations)

## 🔤 Basic Syntax

Variable interpolation uses double curly braces `{{}}` to wrap expressions:

```yaml
steps:
  - id: greet
    name: Greet User
    type: script
    config:
      command: echo
      args: ["Hello {{user.name}}!"]
```

### Nested Object Access

Access nested properties using dot notation:

```yaml
# Access nested configuration
command: {{config.database.host}}
port: {{config.database.port}}

# Access deeply nested data
value: {{response.data.results[0].name}}
```

### Array Indexing

Access array elements using square brackets:

```yaml
# First item
first_item: {{items[0]}}

# Nested array access
nested_value: {{data.results[2].tags[1]}}

# Mixed access patterns
complex_path: {{steps.fetch-data.response.users[0].profile.settings.theme}}
```

## 🎯 Variable Scoping

### Global Variables (`variables.*` or direct access)

Variables defined at the workflow level or passed during execution:

```yaml
# Direct access (shorthand)
greeting: "Hello {{name}}"

# Explicit access
greeting: "Hello {{variables.name}}"
```

### Step Outputs (`steps.*`)

Access outputs from previously executed steps:

```yaml
steps:
  - id: fetch-data
    name: Fetch API Data
    type: script
    config:
      command: curl
      args: ["{{api.endpoint}}"]

  - id: process-data
    name: Process Response
    type: script
    config:
      command: jq
      args: [".results", "{{steps.fetch-data.stdout}}"]
```

### Environment Variables (`env.*`)

Access system environment variables:

```yaml
config:
  database_url: "{{env.DATABASE_URL}}"
  api_key: "{{env.API_KEY}}"
  node_env: "{{env.NODE_ENV}}"
```

### Workflow Properties (`workflow.*`)

Access workflow metadata and runtime information:

```yaml
# Current workflow ID
log_file: "/tmp/{{workflow.id}}.log"

# Current step being executed
debug_info: "Executing step: {{workflow.currentStepId}}"

# Workflow start time
started_at: "{{workflow.startTime}}"

# Execution duration (milliseconds)
duration: "{{workflow.executionTime}}"
```

## 🛠️ Built-in Functions

The interpolation system includes 40+ built-in functions organized by category:

### Date and Time Functions

```yaml
# Current timestamp
timestamp: "{{now()}}"

# Formatted date
today: "{{date()}}"                    # 2024-01-15
custom_date: "{{date('DD/MM/YYYY')}}"  # 15/01/2024

# Time formatting
current_time: "{{time()}}"             # 14:30:25
custom_time: "{{time('HH:mm')}}"       # 14:30

# Date manipulation
tomorrow: "{{addDays(now(), 1)}}"
next_week: "{{addDays(date(), 7)}}"
deadline: "{{addHours(now(), 48)}}"

# Custom date formatting
formatted: "{{formatDate('2024-01-15', 'DD MMM YYYY')}}"  # 15 Jan 2024
```

### Environment Functions

```yaml
# Get environment variable
database_url: "{{env('DATABASE_URL')}}"

# Check if environment variable exists
has_debug: "{{hasEnv('DEBUG')}}"

# Environment variable with default
log_level: "{{envDefault('LOG_LEVEL', 'info')}}"
```

### File System Functions

```yaml
# Check if file exists
config_exists: "{{fileExists('/etc/config.json')}}"

# Read file contents
config_data: "{{readFile('/path/to/config.txt')}}"

# Parse JSON file
settings: "{{readJson('/path/to/settings.json')}}"

# File information
config_size: "{{fileSize('/etc/config.json')}}"
filename: "{{fileName('/path/to/file.txt')}}"     # file.txt
extension: "{{fileExt('/path/to/file.txt')}}"     # .txt
directory: "{{filePath('/path/to/file.txt')}}"    # /path/to

# Path operations
full_path: "{{joinPath(baseDir, 'logs', 'app.log')}}"
```

### String Manipulation Functions  

```yaml
# Case conversion
upper_name: "{{upper(user.name)}}"
lower_email: "{{lower(user.email)}}"

# String operations
trimmed: "{{trim('  hello world  ')}}"           # hello world
replaced: "{{replace(message, 'old', 'new')}}"
substring: "{{substring(text, 0, 10)}}"
length: "{{length(description)}}"

# String testing
starts: "{{startsWith(filename, 'config')}}"
ends: "{{endsWith(filename, '.json')}}"
contains: "{{contains(text, 'error')}}"

# String splitting and joining
parts: "{{split(csv_line, ',')}}"
joined: "{{join(array_items, '-')}}"
```

### Math Functions

```yaml
# Basic arithmetic
sum: "{{add(10, 32)}}"
difference: "{{subtract(100, 25)}}"
product: "{{multiply(6, 7)}}"
quotient: "{{divide(84, 12)}}"

# Rounding
rounded: "{{round(3.14159, 2)}}"      # 3.14
floored: "{{floor(3.7)}}"             # 3
ceiling: "{{ceil(3.2)}}"              # 4

# Random numbers
random_int: "{{random(1, 100)}}"      # Random integer 1-99
random_float: "{{random()}}"          # Random float 0-1
```

### Array Functions

```yaml
# Array access
first_item: "{{first(items)}}"
last_item: "{{last(items)}}"
third_item: "{{at(items, 2)}}"

# Array operations
subset: "{{slice(items, 1, 4)}}"      # Items 1-3
item_count: "{{length(items)}}"

# Array filtering (basic)
filtered: "{{filter(items, 'truthy')}}"
```

### Utility Functions

```yaml
# Default values
safe_value: "{{default(optional_var, 'fallback')}}"

# Type checking
is_empty: "{{empty(value)}}"
not_empty: "{{notEmpty(value)}}"

# Type conversion
as_number: "{{toNumber('42')}}"
as_string: "{{toString(42)}}"
as_boolean: "{{toBoolean('true')}}"

# JSON operations
json_string: "{{toJson(object)}}"
parsed_object: "{{fromJson(json_string)}}"
```

## 🚀 Advanced Features

### Recursive Interpolation

Variables can contain other interpolated expressions:

```yaml
# Variable contains interpolation
template: "Hello {{user.name}}!"
greeting: "{{template}}"              # Resolves to "Hello John!"

# Nested function calls
formatted_message: "{{upper(replace(template, 'Hello', 'Hi'))}}"
```

### Function Chaining

Combine multiple functions for complex transformations:

```yaml
# Chain string operations
processed: "{{upper(trim(replace(input, 'bad', 'good')))}}"

# Math with string conversion
calculated: "{{toString(add(multiply(base, factor), offset))}}"

# Date formatting chain
formatted_date: "{{formatDate(addDays(now(), 7), 'YYYY-MM-DD')}}"
```

### Complex Data Access

Handle complex nested data structures:

```yaml
# Deep object traversal
user_preference: "{{steps.user-fetch.response.data.user.preferences.theme}}"

# Array of objects
first_user_email: "{{steps.users-list.response.users[0].email}}"

# Mixed access patterns
notification: "{{steps.alerts.response.notifications[0].message.text}}"
```

### Custom Functions

Extend functionality with custom functions:

```yaml
# Custom functions can be registered programmatically
custom_format: "{{customFormatter(data, 'format-type')}}"
```

## 💡 Practical Examples

### Dynamic API Configuration

```yaml
name: Dynamic API Workflow
version: 1.0.0

env:
  API_BASE_URL: "https://api.example.com"
  API_VERSION: "v2"

steps:
  - id: fetch-user
    name: Fetch User Data
    type: script
    config:
      command: curl
      args:
        - "-H"
        - "Authorization: Bearer {{env.API_TOKEN}}"
        - "-H" 
        - "Content-Type: application/json"
        - "{{env.API_BASE_URL}}/{{env.API_VERSION}}/users/{{user.id}}"
      env:
        REQUEST_ID: "req-{{timestamp()}}"
        LOG_FILE: "{{joinPath(logDir, 'api-{{date()}}.log')}}"

  - id: process-response
    name: Process API Response
    type: script
    config:
      command: jq
      args:
        - ".data | select(.status == \"active\")"
        - "{{steps.fetch-user.stdout}}"
    dependsOn: ["fetch-user"]
```

### Conditional Workflow Execution

```yaml
name: Environment-Aware Deployment
version: 1.0.0

steps:
  - id: check-environment
    name: Validate Environment
    type: script
    config:
      command: "{{if(equals(env.NODE_ENV, 'production'), 'validate-prod', 'validate-dev')}}"
      workingDirectory: "{{joinPath(projectRoot, 'scripts')}}"

  - id: deploy
    name: Deploy Application
    type: script
    config:
      command: docker
      args:
        - "run"
        - "--env-file"
        - "{{joinPath(configDir, envDefault('ENV_FILE', '.env'))}}"
        - "--name"
        - "app-{{lower(env.NODE_ENV)}}-{{timestamp()}}"
        - "{{image.name}}:{{default(image.tag, 'latest')}}"
    dependsOn: ["check-environment"]
```

### Data Processing Pipeline

```yaml
name: Data Processing Pipeline
version: 1.0.0

steps:
  - id: download-data
    name: Download Dataset
    type: script
    config:
      command: wget
      args:
        - "-O"
        - "{{joinPath(dataDir, 'raw-{{date()}}.csv')}}"
        - "{{dataset.url}}"

  - id: validate-data
    name: Validate Dataset
    type: script
    config:
      command: python
      args:
        - "validate.py"
        - "--input"
        - "{{steps.download-data.outputs.filename}}"
        - "--min-rows"
        - "{{toString(config.validation.minRows)}}"
        - "--required-columns"
        - "{{join(config.validation.columns, ',')}}"
    dependsOn: ["download-data"]

  - id: process-data
    name: Process and Transform
    type: agent
    config:
      agent: data-processor
      prompt: "Process the validated dataset: {{steps.validate-data.outputs.summary}}"
      parameters:
        input_file: "{{steps.download-data.outputs.filename}}"
        output_format: "{{config.output.format}}"
        transformations: "{{toJson(config.transformations)}}"
    dependsOn: ["validate-data"]
```

### Multi-Environment Configuration

```yaml
name: Multi-Environment Build
version: 1.0.0

steps:
  - id: build-app
    name: Build Application
    type: script
    config:
      command: npm
      args: ["run", "build:{{env.NODE_ENV}}"]
      env:
        BUILD_VERSION: "{{version}}-{{date('YYYYMMDD')}}"
        OUTPUT_DIR: "{{joinPath('dist', env.NODE_ENV)}}"
        FEATURE_FLAGS: "{{toJson(features)}}"

  - id: run-tests
    name: Run Test Suite
    type: script
    config:
      command: npm
      args: 
        - "run"
        - "{{if(equals(env.NODE_ENV, 'production'), 'test:full', 'test:unit')}}"
      timeout: "{{multiply(baseTimeout, if(equals(env.NODE_ENV, 'production'), 3, 1))}}"
    dependsOn: ["build-app"]

  - id: deploy
    name: Deploy to Environment
    type: script
    config:
      command: "./deploy.sh"
      args:
        - "--environment={{env.NODE_ENV}}"
        - "--version={{steps.build-app.outputs.version}}"
        - "--config={{joinPath('config', env.NODE_ENV, 'deploy.json')}}"
        - "{{if(env.DRY_RUN, '--dry-run', '--execute')}}"
    dependsOn: ["run-tests"]
```

## ❌ Error Handling

### Strict vs Non-Strict Mode

```yaml
# Non-strict mode (default) - undefined variables become empty strings
message: "Hello {{missing_variable}}!"  # Becomes "Hello !"

# Strict mode - undefined variables cause errors
# Configure in interpolation options
```

### Error Messages

The interpolation system provides detailed error messages:

```
Failed to resolve expression "steps.missing-step.output": Step output not found
Function call failed: Function divide failed: Division by zero
Maximum interpolation depth (10) exceeded
```

### Handling Missing Values

Use the `default()` function to provide fallbacks:

```yaml
# Safe access with fallbacks
database_url: "{{default(env.DATABASE_URL, 'localhost:5432')}}"
timeout: "{{default(config.timeout, 30000)}}"
debug_mode: "{{default(env.DEBUG, false)}}"
```

### Graceful Degradation

```yaml
# Conditional execution based on variable availability
command: "{{if(hasEnv('DOCKER_HOST'), 'docker', 'podman')}}"
log_level: "{{envDefault('LOG_LEVEL', 'info')}}"
```

## ⚡ Performance Considerations

### Optimization Tips

1. **Minimize Recursive Depth**: Keep interpolation nesting reasonable
2. **Cache Complex Calculations**: Store results in variables for reuse
3. **Use Efficient Functions**: Prefer built-in functions over complex expressions
4. **Limit File Operations**: Cache file reads when possible

### Performance Features

- **Lazy Evaluation**: Expressions are only evaluated when needed
- **Efficient Parsing**: Optimized regex-based parsing
- **Depth Limiting**: Configurable recursion depth prevents infinite loops
- **Error Caching**: Failed expressions are cached to avoid repeated failures

### Best Practices

```yaml
# Good: Cache complex calculations
variables:
  timestamp: "{{now()}}"
  build_id: "build-{{timestamp}}"

steps:
  - id: step1
    config:
      tag: "{{build_id}}"
  - id: step2
    config:
      tag: "{{build_id}}"

# Avoid: Repeated expensive operations
steps:
  - id: step1
    config:
      tag: "build-{{now()}}"  # Called multiple times
  - id: step2
    config:
      tag: "build-{{now()}}"  # Different timestamp!
```

## 🔍 Debugging

### Debug Output

Enable debug logging to see interpolation details:

```bash
DEBUG=workflow:interpolation ghc workflow run my-workflow
```

### Common Issues

1. **Undefined Variables**: Use `default()` or check variable names
2. **Type Mismatches**: Use type conversion functions (`toString`, `toNumber`)
3. **Circular References**: Avoid variables that reference themselves
4. **Deep Nesting**: Keep interpolation depth reasonable

---

Variable interpolation transforms static workflow definitions into dynamic, data-driven automation pipelines. Combined with the workflow system's other features, it enables sophisticated automation scenarios with minimal configuration complexity.