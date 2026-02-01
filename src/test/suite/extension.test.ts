import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import * as vscode from "vscode";

// Use function() instead of arrow to access Mocha's `this` for timeout configuration
suite("Extension Test Suite", function() {
  // Use longer timeouts in CI where plugin downloads and cold starts are slower
  const isCI = process.env.CI != null;
  this.timeout(isCI ? 30_000 : 5_000);

  vscode.window.showInformationMessage("Start all tests.");
  let tempNumber = 0;

  // Tests require a workspace folder to be open (via runTest.ts or launch.json)
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error("Tests require a workspace folder to be open");
  }

  // Create test files in a subdirectory within the opened workspace
  // Don't use the workspace root directly to avoid deletion issues
  let tempFolder = path.join(workspaceRoot, "test");
  fs.mkdirSync(tempFolder, { recursive: true });

  const context = {
    get tempFolderUri() {
      return vscode.Uri.file(tempFolder);
    },
    createFile(name: string, text: string) {
      fs.writeFileSync(path.join(tempFolder, name), text, "utf8");
    },
    createWorkspaceFile(name: string, text: string) {
      fs.writeFileSync(path.join(workspaceRoot, name), text, "utf8");
    },
    reset() {
      fs.rmSync(tempFolder, { recursive: true, force: true });
      fs.mkdirSync(tempFolder, { recursive: true });
    },
    async withTempFolder(action: () => Promise<void>) {
      tempFolder = path.join(workspaceRoot, `temp${++tempNumber}`);
      fs.rmSync(tempFolder, { recursive: true, force: true });
      fs.mkdirSync(tempFolder, { recursive: true });
      await action();
    },
    createDprintJson() {
      this.createWorkspaceFile(
        "dprint.json",
        `{
        "includes": [
          "**/*.json"
        ],
        "plugins": [
          "https://plugins.dprint.dev/json-0.15.3.wasm"
        ]
      }`,
      );
    },
    async configureWorkspace() {
      // Workspace is already open via launchArgs (runTest.ts) or launch.json
      await vscode.workspace.getConfiguration("files").update("eol", "\n");
      await vscode.workspace.getConfiguration("editor").update("defaultFormatter", "dprint.dprint");
      // Disable local history to prevent race conditions during test cleanup.
      // VSCode's local history asynchronously copies files when they're saved,
      // which can fail with ENOENT if test cleanup deletes the file first.
      await vscode.workspace.getConfiguration("workbench").update("localHistory.enabled", false);
    },
    async configureFormatOnSave() {
      await vscode.workspace.getConfiguration("editor").update("formatOnSave", true);
    },
    getUri(name: string) {
      return vscode.Uri.joinPath(this.tempFolderUri, name);
    },
    waitInitialize() {
      // Wait for extension to discover config, download plugins, and start dprint
      // Longer wait in CI where cold starts and downloads are slower
      return this.sleep(isCI ? 2000 : 500);
    },
    async sleep(ms: number) {
      await new Promise(resolve => setTimeout(resolve, ms));
    },
    async openAndShowDocument(name: string) {
      const doc = await vscode.workspace.openTextDocument(this.getUri(name));
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
      return doc;
    },
    async formatCommand(name: string | vscode.Uri) {
      await vscode.commands.executeCommand(
        "editor.action.formatDocument",
        name instanceof vscode.Uri ? name : this.getUri(name),
      );
    },
    killAllDprintProcesses() {
      // Use extension API to get the PID of dprint process spawned by this test
      const extension = vscode.extensions.getExtension<{ getEditorServicePid: () => number | undefined }>(
        "dprint.dprint",
      );
      const pid = extension?.exports.getEditorServicePid();

      if (pid != null) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Process already dead or no permissions - that's fine
        }
      }
    },
  };

  test("format on save", async () => {
    context.reset();
    context.createDprintJson();
    context.createFile("test.json", "");
    await context.configureWorkspace();
    await context.configureFormatOnSave();
    await context.waitInitialize();

    // create a json file and open it
    const doc = await context.openAndShowDocument("test.json");
    await applyTextChanges(doc, [{
      newText: `{
             "test":     5
      }`,
      range: getRange([0, 0], [0, 0]),
    }]);
    await doc.save();

    // should be formatted
    assert.equal(doc.getText(), `{\n  "test": 5\n}\n`);
  });

  test("format command", async () => {
    context.reset();
    context.createDprintJson();
    context.createFile(
      "test.json",
      `{
          "test":               5
    }`,
    );
    await context.configureWorkspace();
    await context.waitInitialize();

    // open the test.json and format it with the format command
    const doc = await context.openAndShowDocument("test.json");
    await context.formatCommand(doc.uri);

    // should be formatted
    assert.equal(doc.getText(), `{\n  "test": 5\n}\n`);
  });

  test("format after dprint process kill", async () => {
    context.reset();
    context.createDprintJson();
    context.createFile("test.json", "");
    await context.configureWorkspace();
    await context.waitInitialize();

    // create a json file and open it
    const doc = await context.openAndShowDocument("test.json");
    await applyTextChanges(doc, [{
      range: getRange([0, 0], [0, 0]),
      newText: `{
              "   test":     5
        }`,
    }]);
    await context.formatCommand(doc.uri);

    context.killAllDprintProcesses();
    await context.sleep(100);

    // now try editing and saving again
    await applyTextChanges(doc, [
      vscode.TextEdit.delete(getRange([0, 0], [5, 0])),
      {
        range: getRange([0, 0], [0, 0]),
        newText: `{
              "test":     5
        }`,
      },
    ]);
    await context.formatCommand(doc.uri);

    // should be formatted
    assert.equal(doc.getText(), `{\n  "test": 5\n}\n`);
  });

  test("process isolation - verify PID-based killing", async () => {
    context.reset();
    context.createDprintJson();
    await context.configureWorkspace();
    await context.waitInitialize();

    const extension = vscode.extensions.getExtension<{ getEditorServicePid: () => number | undefined }>(
      "dprint.dprint",
    );
    const pidBeforeKill = extension?.exports.getEditorServicePid();

    assert.ok(
      pidBeforeKill,
      "Should have a dprint process running after initialization",
    );
    assert.strictEqual(typeof pidBeforeKill, "number", "PID should be a number");

    assert.doesNotThrow(
      () => process.kill(pidBeforeKill, 0),
      "Process should exist before kill",
    );

    context.killAllDprintProcesses();
    await context.sleep(100);

    assert.throws(
      () => process.kill(pidBeforeKill, 0),
      "Process should be terminated after killAllDprintProcesses()",
    );

    context.createFile("test.json", `{"test": 5}`);
    const doc = await context.openAndShowDocument("test.json");
    await context.formatCommand(doc.uri);
    assert.equal(
      doc.getText(),
      `{\n  "test": 5\n}\n`,
      "Extension should restart dprint and format successfully",
    );

    const pidAfterRestart = extension?.exports.getEditorServicePid();
    assert.ok(pidAfterRestart, "Should have a new dprint process after restart");
    assert.notStrictEqual(
      pidAfterRestart,
      pidBeforeKill,
      "New process should have different PID",
    );
  });

  async function applyTextChanges(doc: vscode.TextDocument, edits: vscode.TextEdit[]) {
    const edit = new vscode.WorkspaceEdit();
    edit.set(doc.uri, edits);
    await vscode.workspace.applyEdit(edit);
  }

  function getRange(from: [number, number], to: [number, number]) {
    return new vscode.Range(new vscode.Position(from[0], from[1]), new vscode.Position(to[0], to[1]));
  }

  /**
   * Helper to create a temporary config directory for user-level dprint config.
   * Sets platform-appropriate environment variable:
   * - Linux/macOS: XDG_CONFIG_HOME
   * - Windows: APPDATA
   * (Note: process.env.HOME doesn't affect os.homedir() in Node.js)
   * Returns a cleanup function that must be called in finally block.
   */
  function setupTempConfigDir(): { tempConfigDir: string; dprintConfigDir: string; cleanup: () => void } {
    const tempConfigDir = path.join(
      process.env.TMPDIR || process.env.TEMP || "/tmp",
      `dprint-test-config-${Date.now()}`,
    );
    const dprintConfigDir = path.join(tempConfigDir, "dprint");
    fs.mkdirSync(dprintConfigDir, { recursive: true });

    const isWindows = process.platform === "win32";
    const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    const originalAppData = process.env.APPDATA;

    // Set platform-appropriate env var for getUserConfigDirectory()
    if (isWindows) {
      process.env.APPDATA = tempConfigDir;
    } else {
      process.env.XDG_CONFIG_HOME = tempConfigDir;
    }

    return {
      tempConfigDir,
      dprintConfigDir,
      cleanup: () => {
        if (isWindows) {
          process.env.APPDATA = originalAppData;
        } else {
          process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
        }
        try {
          fs.rmSync(tempConfigDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  }

  /**
   * Helper to remove workspace dprint.json if it exists
   */
  function removeWorkspaceConfig() {
    const configPath = path.join(workspaceRoot!, "dprint.json");
    try {
      fs.unlinkSync(configPath);
    } catch {
      // File doesn't exist, that's fine
    }
  }

  // User-Level Config Integration Tests
  suite("User-Level Config", function() {
    // These tests require longer timeouts for extension restart and plugin downloads
    this.timeout(isCI ? 90_000 : 60_000);

    // Wait longer after restart since extension needs to reinitialize and potentially download plugins
    const waitAfterRestart = () => context.sleep(isCI ? 5000 : 3000);

    test("user-level config discovered when no workspace config", async () => {
      const { dprintConfigDir, cleanup } = setupTempConfigDir();

      try {
        // Remove any existing workspace config
        removeWorkspaceConfig();

        // Create user-level config
        fs.writeFileSync(
          path.join(dprintConfigDir, "dprint.json"),
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.19.4.wasm"],
          }),
        );

        // Restart extension to pick up new XDG_CONFIG_HOME
        await vscode.commands.executeCommand("dprint.restart");
        await waitAfterRestart();

        // Create and format a test file (use unique name to avoid VSCode doc caching)
        context.reset();
        context.createFile("user_config_test.json", "{\"user_config\":    5}");
        const doc = await context.openAndShowDocument("user_config_test.json");
        await context.formatCommand(doc.uri);

        // dprint JSON plugin formats small objects on a single line
        assert.equal(doc.getText(), "{ \"user_config\": 5 }\n", "Should format using user-level config");
      } finally {
        cleanup();
        // Restart to restore normal state
        await vscode.commands.executeCommand("dprint.restart");
      }
    });

    test("workspace config takes priority over user-level", async () => {
      const { dprintConfigDir, cleanup } = setupTempConfigDir();

      try {
        // Create user-level config with different plugin version to differentiate
        fs.writeFileSync(
          path.join(dprintConfigDir, "dprint.json"),
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.19.4.wasm"],
          }),
        );

        // Create workspace config
        context.createWorkspaceFile(
          "dprint.json",
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.19.4.wasm"],
          }),
        );

        // Restart extension
        await vscode.commands.executeCommand("dprint.restart");
        await waitAfterRestart();

        // Format a test file - should work with workspace config
        context.reset();
        context.createFile("workspace_priority_test.json", "{\"workspace_priority\":    5}");
        const doc = await context.openAndShowDocument("workspace_priority_test.json");
        await context.formatCommand(doc.uri);

        // dprint JSON plugin formats small objects on a single line
        assert.equal(doc.getText(), "{ \"workspace_priority\": 5 }\n", "Should format using workspace config");
      } finally {
        cleanup();
        removeWorkspaceConfig();
        await vscode.commands.executeCommand("dprint.restart");
      }
    });

    test("checkUserLevelConfig setting disables user-level lookup", async () => {
      // Set XDG_CONFIG_HOME to empty temp dir (no config there)
      // This isolates us from the developer's real ~/.config/dprint/
      const { cleanup } = setupTempConfigDir();

      try {
        // Remove workspace config
        removeWorkspaceConfig();

        // NOTE: We intentionally do NOT create a user-level config here.
        // The stopper config (in test wrapper parent) has empty includes.
        // With checkUserLevelConfig: false, the extension won't look in XDG_CONFIG_HOME,
        // and dprint CLI will find the stopper config which formats nothing.

        // Disable user-level config lookup
        await vscode.workspace.getConfiguration("dprint").update("checkUserLevelConfig", false);

        // Restart extension
        await vscode.commands.executeCommand("dprint.restart");
        await waitAfterRestart();

        // Create a test file (use unique name)
        context.reset();
        context.createFile("disabled_test.json", "{\"disabled\":    5}");
        const doc = await context.openAndShowDocument("disabled_test.json");
        const originalText = doc.getText();

        // Try to format - should NOT change since stopper config has empty includes
        await context.formatCommand(doc.uri);

        assert.equal(doc.getText(), originalText, "Should NOT format when checkUserLevelConfig is false");
      } finally {
        await vscode.workspace.getConfiguration("dprint").update("checkUserLevelConfig", undefined);
        cleanup();
        await vscode.commands.executeCommand("dprint.restart");
      }
    });

    test("custom configPath takes priority over workspace and user-level", async () => {
      const { tempConfigDir, cleanup } = setupTempConfigDir();

      try {
        // Create custom config in a separate location
        const customConfigDir = path.join(tempConfigDir, "custom-configs");
        fs.mkdirSync(customConfigDir, { recursive: true });
        const customConfigPath = path.join(customConfigDir, "my-dprint.json");
        fs.writeFileSync(
          customConfigPath,
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.19.4.wasm"],
          }),
        );

        // Also create workspace config (should be ignored)
        context.createWorkspaceFile(
          "dprint.json",
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.19.4.wasm"],
          }),
        );

        // Set custom config path
        await vscode.workspace.getConfiguration("dprint").update("configPath", customConfigPath);

        // Restart extension
        await vscode.commands.executeCommand("dprint.restart");
        await waitAfterRestart();

        // Format a test file (use unique name)
        context.reset();
        context.createFile("custom_path_test.json", "{\"custom_path\":    5}");
        const doc = await context.openAndShowDocument("custom_path_test.json");
        await context.formatCommand(doc.uri);

        // dprint JSON plugin formats small objects on a single line
        assert.equal(doc.getText(), "{ \"custom_path\": 5 }\n", "Should format using custom config path");
      } finally {
        await vscode.workspace.getConfiguration("dprint").update("configPath", undefined);
        cleanup();
        removeWorkspaceConfig();
        await vscode.commands.executeCommand("dprint.restart");
      }
    });

    test("JSONC config file with comments is supported", async () => {
      const { dprintConfigDir, cleanup } = setupTempConfigDir();

      try {
        // Remove workspace config
        removeWorkspaceConfig();

        // Create user-level config as JSONC with comments
        fs.writeFileSync(
          path.join(dprintConfigDir, "dprint.jsonc"),
          `{
  // This is a single-line comment
  "includes": ["**/*.json"],
  /* Multi-line
     comment */
  "plugins": [
    "https://plugins.dprint.dev/json-0.19.4.wasm"
  ]
}`,
        );

        // Restart extension
        await vscode.commands.executeCommand("dprint.restart");
        await waitAfterRestart();

        // Format a test file (use unique name)
        context.reset();
        context.createFile("jsonc_config_test.json", "{\"jsonc_config\":    5}");
        const doc = await context.openAndShowDocument("jsonc_config_test.json");
        await context.formatCommand(doc.uri);

        // dprint JSON plugin formats small objects on a single line
        assert.equal(doc.getText(), "{ \"jsonc_config\": 5 }\n", "Should format using JSONC config with comments");
      } finally {
        cleanup();
        await vscode.commands.executeCommand("dprint.restart");
      }
    });

    test("file outside workspace is formatted with user-level config", async () => {
      const { dprintConfigDir, cleanup } = setupTempConfigDir();

      try {
        // Remove workspace config
        removeWorkspaceConfig();

        // Create user-level config in the dprint/ subdirectory
        // Add explicit json settings to verify this config is being used
        fs.writeFileSync(
          path.join(dprintConfigDir, "dprint.json"),
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.19.4.wasm"],
            json: {
              "array.preferSingleLine": true,
              "object.preferSingleLine": true,
            },
          }),
        );

        // Restart extension to pick up user-level config
        await vscode.commands.executeCommand("dprint.restart");
        await waitAfterRestart();
        // Extra wait for stability
        await context.sleep(1000);

        // Create a test file OUTSIDE the workspace but in same directory as config
        // This should definitely match **/*.json relative to config location
        const outsideFilePath = path.join(dprintConfigDir, "outside_test.json");
        fs.writeFileSync(outsideFilePath, "{\"outside\":    5}");

        // Open and format the file outside the workspace
        const outsideUri = vscode.Uri.file(outsideFilePath);
        const doc = await vscode.workspace.openTextDocument(outsideUri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);

        // Wait then explicitly request formatting
        await context.sleep(500);
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
          "vscode.executeFormatDocumentProvider",
          doc.uri,
          { tabSize: 2, insertSpaces: true },
        );

        // Apply edits if any
        if (edits && edits.length > 0) {
          const edit = new vscode.WorkspaceEdit();
          edit.set(doc.uri, edits);
          await vscode.workspace.applyEdit(edit);
        }

        // The file should be formatted. Check that it changed from original.
        const formattedText = doc.getText();
        assert.notEqual(
          formattedText,
          "{\"outside\":    5}",
          "File should have been formatted",
        );

        // Check expected format - should match user-level config with preferSingleLine: true
        // If this fails with multi-line output, the globalFolder is using wrong config
        assert.equal(
          formattedText,
          "{ \"outside\": 5 }\n",
          `Expected single-line format from user-level config. Got: ${JSON.stringify(formattedText)}. `
            + "If multi-line, the globalFolder may be using stopper config instead of user-level config.",
        );
      } finally {
        cleanup();
        await vscode.commands.executeCommand("dprint.restart");
      }
    });

    test("per-folder configPath setting is respected in multi-root simulation", async () => {
      const { tempConfigDir, cleanup } = setupTempConfigDir();

      try {
        // Create a custom config in a separate location
        const customConfigDir = path.join(tempConfigDir, "custom-configs");
        fs.mkdirSync(customConfigDir, { recursive: true });
        const customConfigPath = path.join(customConfigDir, "custom-dprint.json");
        fs.writeFileSync(
          customConfigPath,
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.19.4.wasm"],
          }),
        );

        // Also create a workspace config (to verify configPath takes priority)
        context.createWorkspaceFile(
          "dprint.json",
          JSON.stringify({
            includes: ["**/*.json"],
            plugins: ["https://plugins.dprint.dev/json-0.19.4.wasm"],
          }),
        );

        // Set configPath for this workspace folder
        await vscode.workspace.getConfiguration("dprint").update("configPath", customConfigPath);

        // Restart extension
        await vscode.commands.executeCommand("dprint.restart");
        await waitAfterRestart();

        // Format a test file
        context.reset();
        context.createFile("per_folder_test.json", "{\"per_folder\":    5}");
        const doc = await context.openAndShowDocument("per_folder_test.json");
        await context.formatCommand(doc.uri);

        // Should format using the custom configPath, not the workspace config
        assert.equal(doc.getText(), "{ \"per_folder\": 5 }\n", "Should format using per-folder configPath");
      } finally {
        await vscode.workspace.getConfiguration("dprint").update("configPath", undefined);
        cleanup();
        removeWorkspaceConfig();
        await vscode.commands.executeCommand("dprint.restart");
      }
    });
  });
});
