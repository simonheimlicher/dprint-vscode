import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
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
      return this.sleep(500);
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
      const extension = vscode.extensions.getExtension("dprint.dprint");
      const pid = extension?.exports?.getEditorServicePid?.();

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
  }).timeout(4_000);

  test("process isolation - verify PID-based killing", async () => {
    context.reset();
    context.createDprintJson();
    await context.configureWorkspace();
    await context.waitInitialize();

    const extension = vscode.extensions.getExtension("dprint.dprint");
    const pidBeforeKill = extension?.exports?.getEditorServicePid?.();

    assert.ok(
      pidBeforeKill,
      "Should have a dprint process running after initialization",
    );
    assert.strictEqual(typeof pidBeforeKill, "number", "PID should be a number");

    let processExists = true;
    try {
      process.kill(pidBeforeKill, 0);
    } catch {
      processExists = false;
    }
    assert.ok(processExists, "Process should exist before kill");

    context.killAllDprintProcesses();
    await context.sleep(100);

    let processGone = false;
    try {
      process.kill(pidBeforeKill, 0);
    } catch {
      processGone = true;
    }
    assert.ok(
      processGone,
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

    const pidAfterRestart = extension?.exports?.getEditorServicePid?.();
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
});
