import * as vscode from "vscode";
import { getDprintConfig } from "../config";
import { ancestorDirsContainConfigFile, discoverWorkspaceConfigFiles, resolveConfigPath } from "../configFile";
import type { EditorInfo } from "../executable/DprintExecutable";
import { Logger } from "../logger";
import { isUserLevelConfig, ObjectDisposedError } from "../utils";
import { FolderService } from "./FolderService";

export type FolderInfos = ReadonlyArray<Readonly<FolderInfo>>;

export interface FolderInfo {
  uri: vscode.Uri;
  editorInfo: EditorInfo;
}

export interface WorkspaceServiceOptions {
  logger: Logger;
}

/** Handles creating dprint instances for each workspace folder. */
export class WorkspaceService implements vscode.DocumentFormattingEditProvider {
  readonly #logger: Logger;
  readonly #folders: FolderService[] = [];

  #disposed = false;

  constructor(opts: WorkspaceServiceOptions) {
    this.#logger = opts.logger;
  }

  dispose() {
    this.#clearFolders();
    this.#disposed = true;
  }

  #assertNotDisposed() {
    if (this.#disposed) {
      throw new ObjectDisposedError();
    }
  }

  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ) {
    const folder = this.#getFolderForUri(document.uri);
    return folder?.provideDocumentFormattingEdits(document, options, token);
  }

  #getFolderForUri(uri: vscode.Uri) {
    let bestMatch: FolderService | undefined;
    for (const folder of this.#folders) {
      if (uri.fsPath.startsWith(folder.uri.fsPath)) {
        if (bestMatch == null || folder.uri.fsPath.startsWith(bestMatch.uri.fsPath)) {
          bestMatch = folder;
        }
      }
    }
    return bestMatch;
  }

  #clearFolders() {
    for (const folder of this.#folders) {
      folder.dispose();
    }
    this.#folders.length = 0; // clear
  }

  async initializeFolders(): Promise<FolderInfos> {
    this.#assertNotDisposed();

    this.#clearFolders();
    if (vscode.workspace.workspaceFolders == null) {
      return [];
    }

    // Resolve per-folder configPath settings in parallel
    // configPath is a per-folder setting, not global, so each folder may have its own
    const folderConfigPaths = await Promise.all(
      vscode.workspace.workspaceFolders.map(async folder => {
        const folderConfig = getDprintConfig(folder.uri);
        if (folderConfig.configPath) {
          const resolved = await resolveConfigPath(folderConfig.configPath, this.#logger);
          return { folder, configUri: resolved };
        }
        return { folder, configUri: undefined as vscode.Uri | undefined };
      }),
    );

    // Build a map of folder URI to resolved configPath
    const folderConfigPathMap = new Map<string, vscode.Uri | undefined>();
    for (const { folder, configUri } of folderConfigPaths) {
      folderConfigPathMap.set(folder.uri.toString(), configUri);
    }

    // Discover workspace configs (for folders without explicit configPath)
    const configFiles = await discoverWorkspaceConfigFiles({
      logger: this.#logger,
    });

    // User-level configs are configs outside ALL workspace folders (not just the current one)
    // This prevents configs from other workspace folders being treated as user-level
    const allWorkspaceFolderUris = vscode.workspace.workspaceFolders.map(f => f.uri.toString());
    const userLevelConfigs = configFiles.filter(c => isUserLevelConfig(c.toString(), allWorkspaceFolderUris));

    // Initialize the workspace folders with each sub configuration that's found.
    for (const folder of vscode.workspace.workspaceFolders) {
      const stringFolderUri = folder.uri.toString();

      // Check if this folder has an explicit configPath setting
      const explicitConfigPath = folderConfigPathMap.get(stringFolderUri);
      if (explicitConfigPath) {
        // Use the explicit configPath for this folder
        this.#folders.push(
          new FolderService({
            workspaceFolder: folder,
            configUri: explicitConfigPath,
            logger: this.#logger,
          }),
        );
        continue; // Skip discovery-based config matching for this folder
      }

      // No explicit configPath - use discovered configs
      const subConfigUris = configFiles.filter(c => c.toString().startsWith(stringFolderUri));

      // Add folder services for workspace-relative configs
      for (const subConfigUri of subConfigUris) {
        this.#folders.push(
          new FolderService({
            workspaceFolder: folder,
            configUri: subConfigUri,
            logger: this.#logger,
          }),
        );
      }

      // If no workspace config for this folder, use user-level config if available
      if (userLevelConfigs.length > 0 && !this.#folders.some(f => areDirectoryUrisEqual(f.uri, folder.uri))) {
        // Use the first user-level config for this workspace folder
        this.#folders.push(
          new FolderService({
            workspaceFolder: folder,
            configUri: userLevelConfigs[0],
            logger: this.#logger,
          }),
        );
      } else if (
        // if the current workspace folder hasn't been added, then ensure
        // it's added to the list of folders in order to allow someone
        // formatting when the current open workspace is in a sub directory
        // of a workspace
        !this.#folders.some(f => areDirectoryUrisEqual(f.uri, folder.uri))
        && ancestorDirsContainConfigFile(folder.uri)
      ) {
        this.#folders.push(
          new FolderService({
            workspaceFolder: folder,
            configUri: undefined,
            logger: this.#logger,
          }),
        );
      }
    }

    // now initialize in parallel
    const initializedFolders = await Promise.all(this.#folders.map(async f => {
      if (await f.initialize()) {
        return f;
      } else {
        return undefined;
      }
    }));

    this.#assertNotDisposed();

    const allEditorInfos: FolderInfo[] = [];
    for (const folder of initializedFolders) {
      if (folder != null) {
        const editorInfo = folder.getEditorInfo();
        if (editorInfo != null) {
          allEditorInfos.push({ uri: folder.uri, editorInfo: editorInfo });
        }
      }
    }
    return allEditorInfos;
  }

  getEditorServicePid(): number | undefined {
    // Return PID from first folder that has an editor service running
    for (const folder of this.#folders) {
      const pid = folder.getEditorServicePid();
      if (pid != null) {
        return pid;
      }
    }
    return undefined;
  }
}

function areDirectoryUrisEqual(a: vscode.Uri, b: vscode.Uri) {
  function standarizeUri(uri: vscode.Uri) {
    const text = uri.toString();
    if (text.endsWith("/")) {
      return text;
    } else {
      // for some reason, vscode workspace directory uris don't have a trailing slash
      return `${text}/`;
    }
  }

  return standarizeUri(a) === standarizeUri(b);
}
