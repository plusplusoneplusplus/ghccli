# Startup Loading Process

This document describes the files and locations that the Gemini CLI attempts to load during startup.

## Configuration Files

The CLI loads settings from multiple sources in the following order of precedence (workspace settings override user settings, which override system settings):

### Settings Files
1. **Workspace settings**: `{workspace}/.gemini/settings.json`
2. **User settings**: `~/.gemini/settings.json`  
3. **System settings** (platform-dependent):
   - macOS: `/Library/Application Support/GeminiCli/settings.json`
   - Windows: `C:\ProgramData\gemini-cli\settings.json`
   - Linux: `/etc/gemini-cli/settings.json`

## Environment Files

The CLI searches for `.env` files in the following order and loads the first one found:

1. `{workspace}/.gemini/.env` (walks up parent directories)
2. `~/.gemini/.env` (fallback in home directory)

**Note**: Standard `.env` files in workspace directories and home directory are not loaded for security reasons.

## Extension System

### Extension Directories
Extensions are loaded from both workspace and user directories:
- **Workspace extensions**: `{workspace}/.gemini/extensions/`
- **User extensions**: `~/.gemini/extensions/`

Workspace extensions take precedence over user extensions with the same name.

### Extension Files
For each extension subdirectory, the CLI looks for:
- `gemini-extension.json` - Extension configuration file (required)
- `GEMINI.md` - Default context file (optional, or custom files specified in config)

## Memory/Context Files

### GEMINI.md Files
The CLI automatically discovers and loads `GEMINI.md` files from:
- Workspace directory and its subdirectories
- Extension directories
- Custom context files specified in extension configurations

### Global Memory File
- `~/.gemini/GEMINI.md` - Global user memory file

## Authentication Files

### Token Storage
- `~/.gemini/.github_token` - Stored GitHub token for Copilot authentication

## Startup Sequence

1. **Environment Loading**: Load `.env` files using the search order above
2. **Settings Loading**: Load configuration from settings files (workspace → user → system)
3. **Extension Discovery**: Scan extension directories and load configurations
4. **Memory Discovery**: Find and index `GEMINI.md` files
5. **Authentication Setup**: Initialize authentication based on settings and environment variables
6. **Sandbox Initialization**: Start sandbox if configured
7. **UI Rendering**: Launch interactive interface or run non-interactive mode

## Security Considerations

- Standard `.env` files (not in `.gemini` directories) are ignored to prevent accidental loading of sensitive environment variables
- Settings files are validated and errors are reported during startup
- Extension configurations are parsed safely with error handling
- Authentication tokens are stored securely in the `.gemini` directory

## Adding Persisted Configuration Settings

To add a new configuration setting that persists across sessions, you need to modify several files:

### 1. Settings Interface (`packages/cli/src/config/settings.ts`)
Add the new setting to the `Settings` interface:
```typescript
export interface Settings {
  // ... existing settings
  yourNewSetting?: string; // or appropriate type
}
```

### 2. CLI Option (`packages/cli/src/config/config.ts`)
If the setting should be controllable via command line, add it to the yargs configuration in `parseArguments()`:
```typescript
.option('your-new-setting', {
  type: 'string',
  description: 'Description of your setting',
  // Note: Don't add default here if you want settings file fallback
})
```

And add it to the `CliArgs` interface:
```typescript
export interface CliArgs {
  // ... existing args
  yourNewSetting: string | undefined;
}
```

### 3. Config Loading (`packages/cli/src/config/config.ts`)
Update `loadCliConfig()` to use the setting with proper fallback order:
```typescript
return new Config({
  // ... other config
  yourNewSetting: argv.yourNewSetting || settings.yourNewSetting || 'default-value',
});
```

### 4. Core Config (`packages/core/src/config/config.ts`)
Add the setting to the core `ConfigParameters` interface and `Config` class:
```typescript
export interface ConfigParameters {
  // ... existing parameters
  yourNewSetting?: string;
}

export class Config {
  private yourNewSetting: string;

  constructor(params: ConfigParameters) {
    // ... existing constructor
    this.yourNewSetting = params.yourNewSetting || 'default-value';
  }

  getYourNewSetting(): string {
    return this.yourNewSetting;
  }
}
```

### 5. Persistence Logic
If the setting should be updatable at runtime (like `selectedAgent`), add persistence logic where the setting is changed:
```typescript
// In a command or UI component
settings.setValue(SettingScope.User, 'yourNewSetting', newValue);
```

### Example: selectedAgent Implementation
The `selectedAgent` setting follows this pattern:

1. **Settings interface**: `selectedAgent?: string` in `Settings`
2. **CLI option**: `--agent` option without default value
3. **Config loading**: `agent: argv.agent || settings.selectedAgent || 'default'`
4. **Core config**: Stored as `agent` property in `Config` class
5. **Persistence**: `/agent` command calls `settings.setValue()` to save changes

This ensures the setting:
- Can be set via CLI flag (highest priority)
- Persists in settings.json (middle priority)
- Has a reasonable default (lowest priority)
- Is available throughout the application via the Config object

## Debugging Startup Issues

To debug startup issues:
1. Check for error messages related to settings file parsing
2. Verify `.env` file location and format
3. Ensure extension directories have valid `gemini-extension.json` files
4. Check file permissions on configuration directories
5. Use debug mode to see detailed startup information