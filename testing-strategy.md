# Testing Strategy for dprint-vscode

This document outlines the comprehensive testing strategy for the dprint VSCode extension, based on Microsoft's official testing methodology and best practices from similar extensions like prettier-vscode.

## Research Summary

### Microsoft's Official Testing Methodology

Based on the [official VSCode extension testing documentation](https://code.visualstudio.com/api/working-with-extensions/testing-extension), Microsoft recommends:

1. **@vscode/test-electron** and **@vscode/test-cli** for running integration tests
2. **Test fixtures** using workspace folders with real file systems
3. **Mocha** as the test runner with proper timeout configurations
4. **CI/CD integration** using the test-electron API for automated testing
5. **Downloading VSCode** automatically for test environments

For external CLI dependencies, the official approach is to **use real CLI tools during integration tests** rather than mocking them, ensuring tests match production behavior.

### Prettier VSCode Extension Testing Strategy

The [prettier-vscode repository](https://github.com/prettier/prettier-vscode) demonstrates several best practices:

1. **Test Fixtures Organization**: Extensive test-fixtures directory with:
   - Configuration-specific fixtures (ESM, JSON, different Prettier versions)
   - Dependency scenarios (no-dep, module-dep, plugin dependencies)
   - Plugin testing fixtures (Tailwind CSS, PNPM, monorepo structures)
   - Version-specific fixtures (v2-compat, v3, v3-plugin-override)

2. **Programmatic CLI Usage**: Instead of invoking prettier CLI, they:
   - Import prettier as a library: `import * as prettier from "prettier"`
   - Compare extension output against `prettier.format()` programmatically
   - This ensures consistency without shell execution overhead

3. **Test Utilities**: Comprehensive test utilities including:
   - `formatTestUtils.ts` - standardized formatting comparison helpers
   - `testUtils.ts` - extension activation and setup utilities
   - Idempotency tests - ensuring multiple format passes produce identical results

4. **Pre-test Setup**: `install-fixtures.sh` script that runs before tests to:
   - Install dependencies in each fixture directory
   - Prepare plugin environments
   - Set up different package manager scenarios (npm, pnpm)

5. **Modern Testing Infrastructure**:
   - `.vscode-test.mjs` configuration file
   - Separate test suites for web and electron environments
   - Playwright for browser-based testing
   - 19 focused test files covering specific scenarios

### Current dprint-vscode Test Setup

The extension currently has:

- ✅ Basic integration tests using @vscode/test-electron
- ✅ Temp folder creation for test workspaces
- ✅ Real dprint CLI usage (requires dprint to be installed)
- ✅ Format-on-save and format command tests
- ❌ No test fixtures directory structure
- ❌ No systematic test organization for different scenarios
- ❌ Limited test coverage (only 3 tests)
- ❌ No CI/CD configuration visible
- ❌ No user home directory config testing
- ❌ No LSP mode testing
- ❌ No multi-workspace testing

---

## Comprehensive Testing Plan

### Phase 1: Test Infrastructure Setup

#### 1.1 Create Test Fixtures Structure

```
test-fixtures/
├── basic/                      # Basic formatting scenarios
│   ├── dprint.json
│   ├── test.json
│   ├── test.ts
│   └── package.json (with dprint as devDep)
├── multi-plugin/              # Multiple plugins
│   ├── dprint.json
│   ├── test.ts
│   ├── test.json
│   └── test.md
├── custom-config-path/        # Testing dprint.configPath setting
│   ├── configs/
│   │   └── custom-dprint.json
│   └── test.json
├── no-config/                 # No config file scenario
│   └── test.json
├── ancestor-config/           # Config in parent directory
│   ├── dprint.json
│   └── subfolder/
│       └── test.json
├── multi-workspace/           # Multiple workspace folders
│   ├── workspace.code-workspace
│   ├── project-a/
│   │   ├── dprint.json
│   │   └── test.json
│   └── project-b/
│       ├── dprint.json
│       └── test.ts
├── lsp-mode/                  # LSP mode testing
│   ├── dprint.json
│   └── test.json
├── user-level-config/         # User-level config testing
│   └── test.json              # (will use mocked home dir config)
└── npm-dprint/                # dprint in node_modules
    ├── package.json
    ├── node_modules/
    │   └── .bin/dprint
    └── test.json
```

#### 1.2 Update package.json Scripts

```json
{
  "scripts": {
    "pretest": "tsc -p ./ && npm run install-fixtures",
    "install-fixtures": "node scripts/install-fixtures.js",
    "test": "node ./out/test/runTest.js",
    "test:watch": "tsc -p ./ --watch",
    "test:integration": "npm test"
  }
}
```

#### 1.3 Create Fixture Installation Script

Create `scripts/install-fixtures.js` to:

- Install dprint in fixture directories that need it
- Set up node_modules structure for npm-dprint fixture
- Prepare any mock dprint executables for testing path resolution

### Phase 2: Enhanced Test Utilities

#### 2.1 Create src/test/suite/testUtils.ts

Utilities for:

- `ensureExtensionActivated()` - wait for extension ready
- `setupFixture(name: string)` - copy fixture to temp workspace
- `createUserLevelConfigDir()` - mock `~/.config/dprint/` or `%APPDATA%\dprint\`
- `cleanupUserLevelConfigDir()` - cleanup after tests
- `withWorkspace(fixtureName, testFn)` - workspace lifecycle helper
- `compareWithDprintCli(file, options)` - programmatic dprint invocation

#### 2.2 Create src/test/suite/formatTestUtils.ts

Formatting-specific utilities:

- `formatDocument(uri)` - trigger format via VSCode API
- `formatSameAsDprintCli(file)` - compare extension vs CLI output
- `assertIdempotent(file)` - ensure multiple formats are identical
- `assertNoFormatting(file)` - ensure file not formatted when it shouldn't be

### Phase 3: Comprehensive Test Coverage

#### 3.1 Basic Formatting Tests (src/test/suite/format.test.ts)

- Format on save
- Format command
- Format with multiple plugins
- Format range (if supported)
- Idempotency tests

#### 3.2 Configuration Discovery Tests (src/test/suite/config.test.ts)

- Workspace config file discovery
- Ancestor directory config discovery
- Custom config path (dprint.configPath setting)
- User-level config directory (when checkUserLevelConfig=true)
- Config priority testing (custom > workspace > ancestor > user-level)
- Config file watching (changes trigger reload)

#### 3.3 Multi-Workspace Tests (src/test/suite/multi-workspace.test.ts)

- Multiple workspace folders with separate configs
- Sub-folder configs within workspace
- Correct routing of format requests to appropriate service

#### 3.4 LSP Mode Tests (src/test/suite/lsp.test.ts)

- Basic LSP mode formatting
- LSP initialization and communication
- Switching between legacy and LSP modes

#### 3.5 Executable Resolution Tests (src/test/suite/executable.test.ts)

- dprint in node_modules/.bin
- Custom dprint.path setting
- System PATH resolution
- Path expansion (~/ for home directory)
- npm executable resolution

#### 3.6 Process Management Tests (src/test/suite/process.test.ts)

- Process crash recovery (already partially covered)
- Graceful shutdown
- Parent PID tracking
- Multiple processes for multiple configs

#### 3.7 User Home Directory Tests (src/test/suite/user-config.test.ts)

- User-level config discovery on Linux/macOS (~/.config/dprint/)
- User-level config discovery on Windows (%APPDATA%\dprint\)
- checkUserLevelConfig setting behavior
- Fallback to user-level when no workspace config exists

#### 3.8 Error Handling Tests (src/test/suite/error-handling.test.ts)

- Missing dprint executable
- Invalid config file
- Unsupported file type
- Process communication errors

### Phase 4: CI/CD Integration

#### 4.1 Create GitHub Actions Workflow (.github/workflows/test.yml)

```yaml
name: Test
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - name: Install dprint
        run: |
          curl -fsSL https://dprint.dev/install.sh | sh
          echo "$HOME/.dprint/bin" >> $GITHUB_PATH
        shell: bash
      - run: npm test
```

#### 4.2 Add Pre-commit Hooks (Optional)

- Run tests before commits
- Lint test files

### Phase 5: Documentation

#### 5.1 Create TESTING.md

Document:

- How to run tests locally
- Test structure and organization
- How to add new test fixtures
- How to debug failing tests
- CI/CD pipeline explanation

#### 5.2 Update CONTRIBUTING.md

- Testing requirements for PRs
- How to write new tests
- Test coverage expectations

### Phase 6: Advanced Testing (Future Enhancements)

#### 6.1 Mock dprint CLI for Unit Tests

- Create mock dprint executable for isolated testing
- Test extension behavior without requiring real dprint installation
- Faster test execution

#### 6.2 Web Extension Testing

- Use @vscode/test-web for browser-based testing
- Test extension in vscode.dev environment

#### 6.3 Performance Testing

- Format large files
- Multiple concurrent format requests
- Memory usage monitoring

---

## Key Decisions & Recommendations

### 1. Use Real dprint CLI for Integration Tests ✅

- **Rationale**: Matches Prettier's approach and Microsoft's recommendations
- **Benefit**: Tests reflect production behavior accurately
- **Trade-off**: Requires dprint installed in CI environment
- **Mitigation**: Document installation requirement; install in CI script

### 2. Create Comprehensive Test Fixtures ✅

- **Rationale**: Prettier has 15+ fixture directories; we should have similar coverage
- **Benefit**: Systematic testing of all configuration scenarios
- **Implementation**: Start with 8-10 key fixtures, expand over time

### 3. Programmatic dprint Invocation for Comparison ⚠️

- **Challenge**: dprint doesn't have a Node.js API like prettier
- **Alternative**: Spawn `dprint fmt --stdin` and capture stdout for comparison
- **Implementation**: Create utility function that invokes dprint CLI programmatically

### 4. Mock User Home Directory Configs ✅

- **Rationale**: Can't modify real user home directory during tests
- **Implementation**:
  - Use environment variables to override config paths (if dprint supports)
  - Or create temp directories and mock the path resolution logic
  - Test both Unix (~/.config/dprint/) and Windows (%APPDATA%\dprint\) paths

### 5. Test Both Legacy and LSP Modes ✅

- **Rationale**: Extension supports both modes
- **Implementation**: Separate test suite for LSP mode with dprint 0.45+ check

### 6. CI/CD on Multiple Platforms ✅

- **Rationale**: VSCode extensions run on Windows, macOS, Linux
- **Implementation**: GitHub Actions matrix with all three platforms

---

## Implementation Priority

### High Priority (For Initial PR)

1. ✅ Test fixtures structure (8-10 key scenarios)
2. ✅ Enhanced test utilities (testUtils.ts, formatTestUtils.ts)
3. ✅ Configuration discovery tests (most important for recent user-level config feature)
4. ✅ User home directory config tests (validate new feature)
5. ✅ Basic formatting tests expansion
6. ✅ CI/CD GitHub Actions workflow

### Medium Priority (Follow-up PRs)

1. Multi-workspace tests
2. Executable resolution tests
3. Process management tests
4. Error handling tests
5. LSP mode tests
6. TESTING.md documentation

### Low Priority (Future)

1. Mock dprint CLI for unit tests
2. Web extension testing
3. Performance testing

---

## References

- [Testing Extensions | Visual Studio Code Extension API](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [GitHub - microsoft/vscode-test: Testing utility for VS Code extensions](https://github.com/microsoft/vscode-test)
- [GitHub - prettier/prettier-vscode](https://github.com/prettier/prettier-vscode)
- [Prettier VSCode Test Fixtures](https://github.com/prettier/prettier-vscode/tree/main/test-fixtures)
- [Prettier VSCode Test Suite](https://github.com/prettier/prettier-vscode/tree/main/src/test/suite)

---

## Implementation Status

### ✅ Completed (Minimal Viable Testing)

**Phase 1: Refactoring for Testability**

- [x] Made `getUserConfigDirectory()` testable with optional parameters
  - Added dependency injection for `homedir`, `platform`, and `env`
  - Maintains backward compatibility with default parameters

**Phase 2: Unit Tests**

- [x] Created `src/test/suite/utils.test.ts` with 8 platform-specific tests
  - Linux/macOS default path
  - Linux with XDG_CONFIG_HOME set
  - Windows default path with APPDATA
  - Windows fallback without APPDATA
  - macOS (darwin) platform
  - Edge cases with empty environment variables

**Phase 3: Integration Tests**

- [x] Added 6 user-level config integration tests to `extension.test.ts`
  - User-level config discovered when no workspace config exists
  - Workspace config takes priority over user-level
  - User-level config disabled by setting
  - Custom configPath takes priority over everything
  - User-level config in parent directory
  - JSONC config file with comments

**Phase 4: CI/CD**

- [x] GitHub Actions workflow testing on Linux, Windows, macOS
- [x] Automated dprint installation for all platforms
- [x] Tests run on every push and pull request

**Phase 5: Documentation**

- [x] Updated CLAUDE.md with testing documentation
- [x] Updated testing-strategy.md with implementation status

### 📋 Remaining Work (Future Enhancements)

The following items from the original strategy are deferred for future implementation:

- [ ] Comprehensive test fixtures (test-fixtures/ directory)
- [ ] Enhanced test utilities (testUtils.ts, formatTestUtils.ts)
- [ ] Multi-workspace testing (multiple workspace folders with separate configs)
- [ ] LSP mode testing
- [ ] Executable resolution tests (npm, custom path, system PATH)
- [ ] Process management tests (beyond existing crash recovery test)
- [ ] Error handling test suite (invalid configs, missing executables)
- [ ] Performance testing (large files, concurrent requests)
- [ ] Web extension testing (@vscode/test-web)

## Next Steps

The minimal viable testing is complete. The PR is ready for submission with:

- ✅ Multi-platform CI/CD verification (Linux, Windows, macOS)
- ✅ Unit tests for platform-specific logic
- ✅ Integration tests for user-level config discovery
- ✅ Documentation updates

Future work should focus on gradually expanding test coverage following the priority outlined in the original strategy above.
