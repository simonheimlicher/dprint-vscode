# ADR-001: Test Process Management via Extension API

**Status**: Proposed

**Date**: 2026-01-12

**Context**: dprint-vscode CI testing infrastructure

---

## Context

### Problem Statement

The dprint-vscode extension spawns long-running `dprint editor-service` processes to handle formatting requests. During integration testing, one test case ("format after dprint process kill") verifies that the extension can recover after the dprint process unexpectedly terminates.

The current implementation uses `pkill dprint` (Unix) or `taskkill /im dprint.exe /f` (Windows) to terminate dprint processes. This approach has a critical flaw:

**It kills ALL dprint processes system-wide, including those from unrelated VSCode windows.**

On a development machine with multiple VSCode instances running the dprint extension, this causes:
1. Unrelated VSCode windows to lose their dprint formatting capability
2. Mach port issues on macOS when killing processes from other VSCode instances
3. Crashpad crashes due to inter-process communication disruption
4. Local test failures while CI tests pass (CI has isolated VSCode instance)

### Current Architecture

The extension spawns dprint processes with parent tracking:

```typescript
// src/executable/DprintExecutable.ts:118-131
spawnEditorService() {
  const currentProcessId = process.pid;
  const args = ["editor-service", "--parent-pid", currentProcessId.toString(), ...];
  return spawn(quoteCommandArg(this.#cmdPath), args.map(quoteCommandArg), {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: this.#cwd.fsPath,
    shell: true,
  });
}
```

The spawned child process has a `.pid` property, but this is not currently exposed outside the extension's internal `EditorProcess` class.

### Testing Context

- Tests run via `@vscode/test-electron` which launches an isolated VSCode instance
- Tests execute inside the extension host (same process context as extension activation)
- `process.pid` in test code === `process.pid` used for `--parent-pid` argument
- Test needs to kill only the dprint process spawned by the test's VSCode instance

## Decision

**Expose spawned dprint process PIDs through the extension's public API for test cleanup.**

### Implementation Strategy

1. **Extension API Export**
   - Export a `getEditorServicePid(): number | undefined` function from `extension.ts`
   - Function returns the PID of the currently running dprint editor-service process
   - Returns `undefined` if no process is running or in LSP mode

2. **Internal Changes**
   - `EditorProcess` class already has access to the spawned process (line 11: `_process`)
   - Add public `getPid(): number | undefined` method to `EditorProcess`
   - Chain access: `extension.ts` → `backend` → `editorService` → `editorProcess.getPid()`

3. **Test Consumption**
   ```typescript
   async killAllDprintProcesses() {
     const extension = vscode.extensions.getExtension("dprint.dprint");
     const pid = extension?.exports?.getEditorServicePid?.();
     if (pid) {
       process.kill(pid, "SIGKILL");
     }
   }
   ```

### Alternatives Considered

#### Alternative 1: Parse `ps` output with `--parent-pid` filtering

```typescript
// Parse ps output, match --parent-pid against process.pid
const psCmd = os.platform() === "darwin"
  ? "ps axww -o pid=,command="
  : "ps -eo pid=,args= -ww";
// ... regex matching, PID extraction, kill()
```

**Rejected because:**
- Complex shell parsing with platform-specific commands
- Risk of command-line truncation (ps limits)
- Fragile regex matching
- Requires large maxBuffer for ps output
- Still risk of false positives in edge cases

#### Alternative 2: Walk process tree from each dprint process

```bash
pgrep -f "dprint.*editor-service" | while read DPID; do
  # Walk up tree to check if DPID descends from process.pid
done
```

**Rejected because:**
- Requires complex shell scripting
- Platform-specific process tree parsing
- Slower than direct PID access
- Unnecessary complexity when extension already knows the PID

#### Alternative 3: Use `pkill -P` with parent PID

```bash
pkill -9 -P ${process.pid} -f "dprint"
```

**Rejected because:**
- Only kills direct children, not deeper descendants
- Spawn chain may have intermediary shell processes
- Not portable across all Unix systems

## Consequences

### Benefits

1. **Precision**: Only kills the specific process spawned by the test
2. **Simplicity**: Direct PID access, no parsing or shell commands
3. **Cross-platform**: Node's `process.kill()` works uniformly on Windows, macOS, Linux
4. **Reliability**: No regex matching, no command truncation issues
5. **Performance**: O(1) operation instead of parsing entire process table
6. **Type Safety**: TypeScript signatures ensure correct usage
7. **Debugging**: PID exposure aids manual debugging of process issues

### Trade-offs

1. **API Surface**: Adds test-only API to extension exports
   - *Mitigation*: Document as testing-only API
   - *Justification*: Already exporting APIs for LSP mode; test support is reasonable

2. **Coupling**: Test code depends on extension internals
   - *Mitigation*: Stable public API contract, not implementation details
   - *Justification*: Tests already depend on extension behavior; PID is stable identifier

3. **LSP Mode Consideration**: PID not available when using LSP mode
   - *Mitigation*: Return `undefined`, test handles gracefully
   - *Current State*: Tests don't run in LSP mode, not a blocker

### Non-functional Impact

- **Maintainability**: Reduced complexity (no shell parsing)
- **Testability**: Self-testing (see Testing Strategy below)
- **Security**: No new attack surface (PID already visible via `ps`)
- **Performance**: Negligible (simple property access)

## Compliance

### Verification Criteria

An implementation complies with this ADR if:

1. **API Contract**
   - [ ] Extension exports `getEditorServicePid(): number | undefined`
   - [ ] Function returns valid PID when editor-service is running
   - [ ] Function returns `undefined` when no process running or in LSP mode

2. **Test Usage**
   - [ ] `killAllDprintProcesses()` uses extension API, not `pkill`
   - [ ] Test verifies PID before attempting kill
   - [ ] Test handles `undefined` PID gracefully

3. **Process Isolation**
   - [ ] Test kills only the specific PID returned by API
   - [ ] Other VSCode instances' dprint processes remain unaffected
   - [ ] Local test execution no longer causes crashpad crashes

### Review Checklist

- [ ] PID exposure limited to test API surface (not user-facing)
- [ ] Cross-platform compatibility verified (Windows, macOS, Linux)
- [ ] LSP mode behavior documented and handled
- [ ] No shell commands or process parsing in test code

## Testing Strategy

### Level Assignments

| Component | Level | Justification |
|-----------|-------|---------------|
| `EditorProcess.getPid()` | 1 (Unit) | Pure accessor method, no external dependencies. Mock `ChildProcess` with known PID, verify return value. |
| Extension API `getEditorServicePid()` | 1 (Unit) | Chains internal calls, no external processes. Inject mock backend/service, verify PID propagation. |
| Test process killing | 2 (Integration) | Requires spawning real dprint process via extension, then killing it. Uses @vscode/test-electron infrastructure. |
| Process isolation verification | 2 (Integration) | Spawns multiple VSCode instances with dprint, verifies only target instance's process is killed. |

### Escalation Rationale

- **Level 1 → 2**: Unit tests verify API correctness but cannot prove process isolation. Integration tests required to:
  - Spawn actual dprint editor-service processes
  - Verify kill() affects only the target PID
  - Confirm other processes remain running
  - Validate cross-platform behavior (CI matrix: Ubuntu, macOS, Windows)

- **No Level 2 → 3**: E2E tests not needed because:
  - No network dependencies
  - No external services beyond VSCode test infrastructure
  - Integration tests provide sufficient confidence for process management

### Testing Principles

- **NO MOCKING in Integration Tests**: Use real `@vscode/test-electron` to spawn VSCode instances with dprint extension. Use actual `process.spawn()` and `process.kill()` APIs.

- **Behavior Only**: Test that:
  - Calling `getEditorServicePid()` returns a valid, killable PID
  - Killing that PID terminates only the target process
  - Other dprint processes remain unaffected
  - *Do NOT test*: Internal implementation of process spawning, exact kill signal used

- **Minimum Level**: Unit tests for API contract (fast feedback), integration tests for process behavior (CI validation across platforms)

### Test Cases

**Unit Tests (Level 1)**
1. `getPid()` returns undefined when no process spawned
2. `getPid()` returns valid number after spawn
3. `getEditorServicePid()` returns undefined in LSP mode
4. `getEditorServicePid()` chains to EditorProcess.getPid()

**Integration Tests (Level 2)**
1. Test spawns dprint, retrieves PID, kills it, verifies process terminated
2. Multiple VSCode instances: kill one, verify others unaffected
3. Cross-platform matrix: Ubuntu, macOS, Windows (existing CI)

## Implementation Notes

### Minimal Changes Required

1. **src/legacy/editor-service/common/EditorProcess.ts**
   ```typescript
   getPid(): number | undefined {
     return this._process?.pid;
   }
   ```

2. **src/extension.ts** (activation function)
   ```typescript
   return {
     getEditorServicePid: () => backend?.getEditorServicePid?.()
   };
   ```

3. **Backend interfaces** (propagate through backend → service → process)

4. **src/test/suite/extension.test.ts**
   ```typescript
   async killAllDprintProcesses() {
     const ext = vscode.extensions.getExtension("dprint.dprint");
     const pid = ext?.exports?.getEditorServicePid?.();
     if (pid) {
       process.kill(pid, "SIGKILL");
     }
   }
   ```

### Migration Path

1. Add `getPid()` methods to internal classes
2. Export `getEditorServicePid()` from extension
3. Update test to use new API
4. Remove old `pkill`/`taskkill` implementation
5. Verify local tests pass (macOS with multiple VSCode windows)
6. Verify CI tests still pass (existing matrix)

## References

- **VSCode Extension API**: https://code.visualstudio.com/api/references/vscode-api#Extension
- **Node.js process.kill()**: https://nodejs.org/api/process.html#processkillpid-signal
- **@vscode/test-electron**: https://github.com/microsoft/vscode-test

## Related Decisions

- None (first ADR for this codebase)

## Supersedes

- None

## Superseded By

- None (current)
