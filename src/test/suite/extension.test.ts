import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import * as vscode from "vscode";

suite("Extension Test Suite", function () {
  // Use longer timeouts in CI where plugin downloads and cold starts are slower
  const isCI = process.env.CI != null;
  this.timeout(isCI ? 30_000 : 5_000);

  vscode.window.showInformationMessage("Start all tests.");
  // Create test files in a subdirectory within the opened workspace
  // Don't use the workspace root directly to avoid deletion issues
  let tempNumber = 0;
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  let tempFolder = path.join(workspaceRoot, "test");

  const context = {
    get tempFolderUri() {
      return vscode.Uri.file(tempFolder);
    },
    createFile(name: string, text: string) {
      fs.writeFileSync(path.join(tempFolder, name), text, "utf8");
    },
    reset() {
      fs.rmSync(tempFolder, { recursive: true, force: true });
      fs.mkdirSync(tempFolder, { recursive: true });
    },
    async withTempFolder(action: () => Promise<void>) {
      tempFolder = path.join(workspaceRoot, `test${++tempNumber}`);
      fs.rmSync(tempFolder, { recursive: true, force: true });
      fs.mkdirSync(tempFolder, { recursive: true });
      await action();
    },
    createDprintJson() {
      // Create dprint.json in workspace root, not in test subdirectory
      fs.writeFileSync(
        path.join(workspaceRoot, "dprint.json"),
        `{
        "includes": [
          "**/*.json"
        ],
        "plugins": [
          "https://plugins.dprint.dev/json-0.15.3.wasm"
        ]
      }`,
        "utf8"
      );
    },
    async openWorkspace() {
      // Workspace is already open from runTest.ts
      // Just configure the settings
      await vscode.workspace.getConfiguration("files").update("eol", "\n");
      await vscode.workspace
        .getConfiguration("editor")
        .update("defaultFormatter", "dprint.dprint");
    },
    async configureFormatOnSave() {
      await vscode.workspace
        .getConfiguration("editor")
        .update("formatOnSave", true);
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
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    async openAndShowDocument(name: string) {
      const doc = await vscode.workspace.openTextDocument(this.getUri(name));
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
      return doc;
    },
    async formatCommand(name: string | vscode.Uri) {
      await vscode.commands.executeCommand(
        "editor.action.formatDocument",
        name instanceof vscode.Uri ? name : this.getUri(name)
      );
    },
    async killAllDprintProcesses() {
      // Use extension API to get the PID of dprint process spawned by this test
      const extension = vscode.extensions.getExtension("dprint.dprint");
      const pid = extension?.exports?.getEditorServicePid?.();

      if (pid != null) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (err) {
          // Process already dead or no permissions - that's fine
        }
      }
    },
  };

  test("format on save", async () => {
    context.reset();
    context.createDprintJson();
    context.createFile("test.json", "");
    await context.openWorkspace();
    await context.configureFormatOnSave();
    await context.waitInitialize();

    // create a json file and open it
    const doc = await context.openAndShowDocument("test.json");
    await applyTextChanges(doc, [
      {
        newText: `{
             "test":     5
      }`,
        range: getRange([0, 0], [0, 0]),
      },
    ]);
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
    }`
    );
    await context.openWorkspace();
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
    await context.openWorkspace();
    await context.waitInitialize();

    // create a json file and open it
    const doc = await context.openAndShowDocument("test.json");
    await applyTextChanges(doc, [
      {
        range: getRange([0, 0], [0, 0]),
        newText: `{
              "   test":     5
        }`,
      },
    ]);
    await context.formatCommand(doc.uri);

    await context.killAllDprintProcesses();

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
    await context.openWorkspace();
    await context.waitInitialize();

    // Get the PID of the dprint process spawned by this test
    const extension = vscode.extensions.getExtension("dprint.dprint");
    const pidBeforeKill = extension?.exports?.getEditorServicePid?.();

    assert.ok(pidBeforeKill, "Should have a dprint process running after initialization");
    assert.strictEqual(typeof pidBeforeKill, "number", "PID should be a number");

    // Verify process exists using signal 0 (check existence without killing)
    let processExists = true;
    try {
      process.kill(pidBeforeKill, 0);
    } catch {
      processExists = false;
    }
    assert.ok(processExists, "Process should exist before kill");

    // Kill the process using our API
    await context.killAllDprintProcesses();

    // Wait a bit for the process to actually terminate
    await context.sleep(100);

    // Verify the process is actually dead
    let processGone = false;
    try {
      process.kill(pidBeforeKill, 0);
    } catch {
      processGone = true;
    }
    assert.ok(processGone, "Process should be terminated after killAllDprintProcesses()");

    // Verify the extension can restart the process and format successfully
    context.createFile("test.json", `{"test": 5}`);
    const doc = await context.openAndShowDocument("test.json");
    await context.formatCommand(doc.uri);

    // If formatting succeeds, the extension successfully restarted dprint
    assert.equal(doc.getText(), `{\n  "test": 5\n}\n`, "Extension should restart dprint and format successfully");

    // Verify we have a new PID (not the old one)
    const pidAfterRestart = extension?.exports?.getEditorServicePid?.();
    assert.ok(pidAfterRestart, "Should have a new dprint process after restart");
    assert.notStrictEqual(pidAfterRestart, pidBeforeKill, "New process should have different PID");
  });

  async function applyTextChanges(
    doc: vscode.TextDocument,
    edits: vscode.TextEdit[]
  ) {
    const edit = new vscode.WorkspaceEdit();
    edit.set(doc.uri, edits);
    await vscode.workspace.applyEdit(edit);
  }

  function getRange(from: [number, number], to: [number, number]) {
    return new vscode.Range(
      new vscode.Position(from[0], from[1]),
      new vscode.Position(to[0], to[1])
    );
  }
});
