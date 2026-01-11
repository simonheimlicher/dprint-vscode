import * as assert from "node:assert";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as process from "node:process";
import * as vscode from "vscode";
// import * as myExtension from '../../extension';

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
    killAllDprintProcesses() {
      return new Promise<void>((resolve) => {
        const command =
          os.platform() === "win32"
            ? "taskkill /im dprint.exe /f"
            : "pkill dprint";
        cp.exec(command, () => {
          // Always resolve - if no processes exist, that's fine
          resolve();
        });
      });
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
