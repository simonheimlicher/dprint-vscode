# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A VSCode extension that integrates [dprint](https://dprint.dev/) code formatting into Visual Studio Code. The extension manages communication with the dprint CLI through either a legacy editor-service protocol or an experimental LSP (Language Server Protocol) mode.

## Development Commands

**Build and compile:**

```bash
npm run compile  # Compile TypeScript and bundle with esbuild
npm run watch    # Watch mode for development
```

**Testing:**

```bash
npm run pretest  # Compile TypeScript for tests
npm test         # Run test suite
```

**Local development:**

```bash
npm install
# Then use "Run and Debug" in VSCode → select "Run Extension"
```

**Package for distribution:**

```bash
npm run package  # Creates .vsix file
```

## Architecture

### Dual Backend System

The extension supports two operational modes, determined by the `dprint.experimentalLsp` configuration:

1. **Legacy Mode** ([src/legacy/](src/legacy/)): Default mode using dprint's editor-service protocol
   - Manages long-running `dprint editor-service` processes
   - Binary protocol communication (schema versions 4 and 5)
   - One process per workspace folder/config file combination

2. **LSP Mode** ([src/lsp.ts](src/lsp.ts)): Experimental mode using dprint's language server
   - Requires dprint 0.45+
   - Uses vscode-languageclient to communicate with `dprint lsp` command
   - Simpler implementation but currently only handles first workspace folder

### Core Components

**Extension Lifecycle** ([src/extension.ts](src/extension.ts)):

- Entry point that initializes the appropriate backend
- Watches for config file changes and workspace folder changes
- Handles `dprint.restart` command
- Requires window reload when switching between legacy/LSP modes

**Config Discovery** ([src/configFile.ts](src/configFile.ts)):

- Searches for `dprint.json`, `dprint.jsonc`, `.dprint.json`, `.dprint.jsonc`
- Discovers configs in workspace folders and ancestor directories
- Implements retry logic for large projects where VSCode's `findFiles` API may return empty results initially
- Excludes `node_modules` directories from search

**Workspace Management** ([src/legacy/WorkspaceService.ts](src/legacy/WorkspaceService.ts)):

- Creates `FolderService` instances for each config file found
- Supports multiple workspace folders with sub-configs
- Routes format requests to the appropriate folder service based on file URI

**Folder Service** ([src/legacy/FolderService.ts](src/legacy/FolderService.ts)):

- Represents a single dprint instance for a workspace folder
- Manages EditorService lifecycle
- Implements `DocumentFormattingEditProvider` interface
- Checks if dprint is installed and retrieves plugin information via `dprint editor-info`

**DprintExecutable** ([src/executable/DprintExecutable.ts](src/executable/DprintExecutable.ts)):

- Abstracts dprint CLI invocation
- Resolves dprint path from config, npm node_modules, or system PATH
- Spawns editor-service processes with proper parent PID tracking
- Handles config file path arguments

**Plugin Registry** ([src/legacy/pluginRegistry.ts](src/legacy/pluginRegistry.ts)):

- Maps dprint plugin `configKey` values to VSCode language identifiers
- Enables proper formatter registration so VSCode UI recognizes supported file types
- Hardcoded mappings for 15+ official dprint plugins (TypeScript, JSON, Markdown, etc.)
- Unknown/custom plugins are logged but not registered
- Registry is extensible for future plugin support

**Editor Service Protocol** ([src/legacy/editor-service/](src/legacy/editor-service/)):

- `EditorService4` and `EditorService5` implement version-specific binary protocols
- Communicates via stdin/stdout with `dprint editor-service` process
- Messages include: CanFormat, FormatFile, CancelFormat, Active (health check), ShutDownProcess
- Uses 32-bit big-endian integers for message framing
- `EditorProcess` class manages process lifecycle and I/O buffering

### Process Management

**Long-running processes:**

- Each folder service spawns a `dprint editor-service` process
- Process includes parent PID to auto-terminate if VSCode exits unexpectedly
- Graceful shutdown with 1-second timeout before force-kill
- Process restarts on errors with 500ms backoff

**NPM executable resolution** ([src/executable/npm.ts](src/executable/npm.ts)):

- Attempts to find dprint in ancestor `node_modules/.bin` directories
- Falls back to system PATH if not found in npm

### Configuration Schema

**ConfigJsonSchemaProvider** ([src/legacy/ConfigJsonSchemaProvider.ts](src/legacy/ConfigJsonSchemaProvider.ts)):

- Provides JSON schema for dprint config files via custom `dprint://` URI scheme
- Downloads schemas from dprint CLI's `configSchemaUrl` and plugin URLs
- Enables IntelliSense in VSCode for dprint.json files

## Key Behaviors

**Multi-workspace support:**

- Extension discovers ALL config files in workspace (not just root)
- Creates separate dprint instances for subdirectories with their own configs
- Ancestor directory configs are supported (workspace folder can be a subdirectory of a dprint project)

**Formatter registration (Legacy mode):**

- VSCode expects language-based registration (e.g., `{ language: "typescript" }`), not pattern-based
- Extension collects language IDs from all detected plugins across workspace folders via plugin registry
- Registers formatter once with combined language ID list during initialization
- Registration is disposed and recreated on reinitialization to prevent duplicates
- Legacy mode only; LSP mode handles registration through language server protocol

**Format request routing:**

- Two-phase approach: registration tells VSCode which languages are supported, runtime validation determines if specific files can be formatted
- When a file is formatted, `WorkspaceService` finds the most specific (deepest) folder service
- `FolderService` calls `EditorService.canFormat()` to verify dprint can format this specific file (respects config includes/excludes)
- Returns `undefined` if file can't be formatted (lets other formatters handle it)

**Re-initialization triggers:**

- Config file changes (create/modify/delete)
- Workspace folder changes
- VSCode configuration changes (`dprint.*` settings)
- Manual restart command

**Error handling:**

- Errors during initialization don't crash the extension
- Failed folder services are excluded from formatting
- Process crashes trigger automatic restart
- User sees errors in "dprint" output channel

## Testing

**Test structure:**

- Tests in [src/test/](src/test/)
- Uses `@vscode/test-electron` for running extension tests
- `runTest.ts` downloads VSCode and runs test suite

**User-Level Config Tests:**

- Unit tests in [src/test/suite/utils.test.ts](src/test/suite/utils.test.ts)
  - Platform-specific path resolution (Windows/Linux/macOS)
  - Environment variable handling (APPDATA, XDG_CONFIG_HOME)
  - 8 tests covering all platform scenarios
- Integration tests in [src/test/suite/extension.test.ts](src/test/suite/extension.test.ts)
  - User-level config discovery and formatting
  - Config priority testing (custom > workspace > user-level)
  - Multiple config filename variants (dprint.json, dprint.jsonc)
  - 6 tests covering core user-level config scenarios

**CI/CD:**

- GitHub Actions workflow [.github/workflows/test.yml](.github/workflows/test.yml)
- Runs on Ubuntu, Windows, and macOS
- Installs dprint automatically on all platforms
- Tests run on every push and pull request

## TypeScript Configuration

- Target: ES6
- Module: CommonJS
- Strict mode enabled
- Output directory: `out/`
- Bundled with esbuild to single file for distribution

## Extension Packaging

**Bundling:**

- esbuild bundles all code to [out/extension.js](out/extension.js)
- External: `vscode` module (provided by VSCode runtime)
- Format: CommonJS
- Platform: Node.js

**Activation:**

- `onStartupFinished` - activates after VSCode startup completes
- `onFileSystem:dprint` - activates when dprint virtual filesystem scheme is used

## Important Implementation Details

**Binary protocol details (Schema v5):**

- Message structure: `[messageId: u32][kind: u32][bodyLength: u32][body][successBytes: 0xFF 0xFF 0xFF 0xFF]`
- Body parts are length-prefixed: `[length: u32][data]`
- Async request/response with message ID matching
- `Active` messages from CLI are health checks - must respond with `SuccessResponse`

**Process spawning quirks:**

- Uses `shell: true` on all platforms to resolve paths correctly (Windows compatibility)
- Command arguments are quoted to handle spaces
- Working directory is always the workspace folder (not subdirectory) to avoid resource locks

**Config file discovery gotchas:**

- VSCode's `findFiles` can return empty results on very large projects if called too early
- Extension waits for workspace initialization + 250ms before searching
- Implements retry with fallback to Node.js `fs` API if root config found
- Users should not exclude dprint config from VSCode's file search

**Config file priority:**

1. Custom config path via `dprint.configPath` setting (highest priority)
2. Workspace folder config files and ancestor directories
3. User-level config directories (if `dprint.checkUserLevelConfig` is enabled and no workspace config found):
   - Linux/macOS: `~/.config/dprint/`
   - Windows: `%APPDATA%\dprint\`

**Path resolution:**

- `dprint.path` setting supports `~/` expansion
- `dprint.configPath` setting supports `~/` expansion
- Relative paths (`./`, `../`) resolved relative to workspace folder
- npm executable preferred over system PATH for reproducibility


## Always use `AskUserQuestion` Tool

**Always use the `AskUserQuestion` tool to obtain guidance from the user, such as: discover context, obtain rationale, as well as to support the user in makking the right call by asking critical questions before blindly following the user's requests**

**NEVER ask the user any questions without using the `AskUserQuestion` tool**
