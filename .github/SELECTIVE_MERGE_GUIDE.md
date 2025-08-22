# Selective Merge Guide

This guide documents the process for selectively merging changes from upstream Google Gemini CLI releases into specific packages while maintaining our fork's stability.

## Overview

When Google releases new versions of the Gemini CLI, we may want to adopt certain improvements without taking all changes. This guide shows how to merge changes for specific packages only.

## Prerequisites

- Access to the upstream repository: `https://github.com/google-gemini/gemini-cli.git`
- The upstream remote should be configured as `gemini`
- Clean working directory before starting

## Setup Upstream Remote (One-time)

```bash
# Add the upstream remote if not already added
git remote add gemini https://github.com/google-gemini/gemini-cli.git

# Verify remotes
git remote -v
# Should show:
# gemini  https://github.com/google-gemini/gemini-cli.git (fetch)
# gemini  https://github.com/google-gemini/gemini-cli.git (push)
# origin  https://github.com/plusplusoneplusplus/ghccli.git (fetch)
# origin  https://github.com/plusplusoneplusplus/ghccli.git (push)
```

## Step-by-Step Selective Merge Process

### 1. Fetch Latest Changes and Tags

```bash
# Fetch all changes and tags from upstream
git fetch gemini --tags

# Verify the target release tag exists
git tag | grep v0.2.0-preview.0  # Replace with target version
```

### 2. Identify Package Changes

```bash
# Check what files changed in your target package
git diff HEAD..v0.2.0-preview.0 --name-only | grep "packages/YOUR_PACKAGE"

# Check the type of changes (Modified, Added, Deleted)
git diff HEAD..v0.2.0-preview.0 --name-status | grep "packages/YOUR_PACKAGE"
```

### 3. Analyze Dependencies

Before merging, check if the target package depends on changes in other packages:

```bash
# Look for imports from other packages in the changed files
git show v0.2.0-preview.0:packages/YOUR_PACKAGE/src/main-file.ts | grep "from '@google/gemini-cli"

# Check if any schemas or types are imported that might not exist in your version
```

### 4. Apply Changes

#### Method A: For Simple Files (like package.json)

```bash
# Extract specific files from the target release
git show v0.2.0-preview.0:packages/YOUR_PACKAGE/package.json > /tmp/new_package.json

# Compare with current version
diff packages/YOUR_PACKAGE/package.json /tmp/new_package.json

# Apply changes manually or copy the file
cp /tmp/new_package.json packages/YOUR_PACKAGE/package.json
```

#### Method B: For Source Files with Complex Changes

```bash
# Extract the new version of each changed file
git show v0.2.0-preview.0:packages/YOUR_PACKAGE/src/file.ts > /tmp/new_file.ts

# Copy to your working directory
cp /tmp/new_file.ts packages/YOUR_PACKAGE/src/file.ts
```

### 5. Handle New Files

```bash
# Create new files that were added in the release
git show v0.2.0-preview.0:packages/YOUR_PACKAGE/src/new-file.ts > packages/YOUR_PACKAGE/src/new-file.ts

# Create new directories if needed
mkdir -p packages/YOUR_PACKAGE/new-directory
```

### 6. Handle Deleted Files

```bash
# Remove files that were deleted in the release
rm packages/YOUR_PACKAGE/old-file.ts
```

### 7. Resolve Missing Dependencies

If build fails due to missing imports/types:

```bash
# Check what's missing
npm run build --workspace=packages/YOUR_PACKAGE

# Example: If missing schemas from core package
git show v0.2.0-preview.0:packages/core/src/ide/ideContext.ts > /tmp/new_ideContext.ts

# Compare and add only the missing exports
diff packages/core/src/ide/ideContext.ts /tmp/new_ideContext.ts

# Add the missing schemas/types to the core package
```

### 8. Verify Changes

```bash
# Build the specific package
npm run build --workspace=packages/YOUR_PACKAGE

# Run tests if available
npm run test --workspace=packages/YOUR_PACKAGE

# Build entire workspace to ensure no breaking changes
npm run build

# Check for linting issues
npm run lint --workspace=packages/YOUR_PACKAGE
```

### 9. Commit Changes

```bash
# Stage all changes
git add .

# Commit with descriptive message
git commit -m "feat: merge v0.2.0-preview.0 changes for YOUR_PACKAGE

- Brief description of main changes
- Version updates
- New features added
- Dependencies resolved

🚀 Key improvements:
- List major improvements
- New functionality

🔧 Technical changes:
- Schema updates
- Build configuration changes

✅ Verification:
- Builds pass
- Tests pass
- No breaking changes"
```

## Example: Merging vscode-ide-companion

Here's a real example of merging the vscode-ide-companion package:

```bash
# 1. Fetch upstream
git fetch gemini --tags

# 2. Check changes
git diff HEAD..v0.2.0-preview.0 --name-status | grep "packages/vscode-ide-companion"

# 3. Extract and apply files
git show v0.2.0-preview.0:packages/vscode-ide-companion/package.json > /tmp/new_package.json
cp /tmp/new_package.json packages/vscode-ide-companion/package.json

git show v0.2.0-preview.0:packages/vscode-ide-companion/src/extension.ts > packages/vscode-ide-companion/src/extension.ts

# 4. Add new test files
git show v0.2.0-preview.0:packages/vscode-ide-companion/src/extension.test.ts > packages/vscode-ide-companion/src/extension.test.ts

# 5. Resolve missing schemas in core package
# (Add missing IdeDiffAcceptedNotificationSchema, etc. to packages/core/src/ide/ideContext.ts)

# 6. Verify
npm run build --workspace=packages/vscode-ide-companion
npm run test --workspace=packages/vscode-ide-companion
npm run build

# 7. Commit changes
git add .
git commit -m "feat: merge v0.2.0-preview.0 changes for vscode-ide-companion"
```

## Common Issues and Solutions

### Build Failures Due to Missing Imports

**Problem:** Package tries to import types/schemas that don't exist in your version of core packages.

**Solution:** 
1. Check what's being imported: `git show v0.2.0-preview.0:packages/core/src/target-file.ts`
2. Add only the necessary exports to your core package
3. Rebuild and test

### Version Inconsistencies

**Problem:** Different packages end up with mismatched versions.

**Solution:**
- Update package versions consistently across related packages
- Use semantic versioning that matches the upstream release

### Test Failures

**Problem:** New tests fail due to missing dependencies or changed APIs.

**Solution:**
1. Check if tests require additional setup
2. Verify mock configurations are up to date
3. Update test utilities if needed

## Best Practices

1. **Start Small:** Begin with packages that have minimal dependencies
2. **Check Dependencies:** Always verify what other packages your target depends on
3. **Test Thoroughly:** Build and test after each package merge
4. **Document Changes:** Use clear commit messages that explain what was merged and why
5. **Version Consistency:** Keep related packages at the same version when possible
6. **Backup First:** Consider creating a branch before starting complex merges

## Package Merge Order Recommendations

Based on dependencies, merge packages in this order:

1. `packages/test-utils` (minimal dependencies)
2. `packages/core` (foundational package)
3. `packages/vscode-ide-companion` (depends on core)
4. `packages/cli` (depends on core, most complex)

## Useful Commands Reference

```bash
# View changes in a specific release
git show v0.2.0-preview.0 --name-only

# Compare specific files between versions
git diff HEAD..v0.2.0-preview.0 -- packages/YOUR_PACKAGE/file.ts

# Extract a file from a specific commit/tag
git show v0.2.0-preview.0:path/to/file > /tmp/new_file

# Check what remotes are configured
git remote -v

# Fetch all tags from upstream
git fetch gemini --tags

# List available tags
git tag | grep v0.2

# See commits between versions
git log --oneline HEAD..v0.2.0-preview.0 -- packages/YOUR_PACKAGE/
```

---

*This guide was created based on the successful merge of vscode-ide-companion and test-utils packages from v0.2.0-preview.0 release.*
