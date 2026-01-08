import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { getCombinedDprintConfig } from "./config";
import { DPRINT_CONFIG_FILE_NAMES, DPRINT_CONFIG_FILEPATH_GLOB } from "./constants";
import { Logger } from "./logger";
import { delay, getUserConfigDirectory, waitWorkspaceInitialized } from "./utils";

export async function discoverWorkspaceConfigFiles(opts: { maxResults?: number; logger: Logger }) {
  const logger = opts.logger;

  logger.logInfo("🔍 Config discovery started...");

  // Check if there's a custom config path specified
  const folders = vscode.workspace.workspaceFolders ?? [];
  const config = getCombinedDprintConfig(folders);

  logger.logInfo(`Workspace folders: ${folders.length}`);
  logger.logInfo(`Custom config path: ${config.configPath || "none"}`);

  if (config.configPath) {
    logger.logDebug(`Using custom config path: ${config.configPath}`);
    const configUri = vscode.Uri.file(config.configPath);
    try {
      const stat = await vscode.workspace.fs.stat(configUri);
      if (stat.type === vscode.FileType.File) {
        return [configUri];
      } else {
        logger.logWarn(`Custom config path is not a file: ${config.configPath}`);
      }
    } catch (err) {
      logger.logWarn(`Custom config path does not exist: ${config.configPath}`);
    }
  }

  // See https://github.com/dprint/dprint-vscode/issues/105 -- for some reason findFiles would
  // return no results on very large projects when called too early on startup
  await waitWorkspaceInitialized();
  // just in case, mitigate more by waiting a little bit of time
  await delay(250);

  logger.logInfo("Searching for dprint configs in workspace folders...");
  // now try to find the files
  const workspaceConfigs = await attemptFindFiles();

  if (workspaceConfigs.length > 0) {
    logger.logInfo(`✓ Found ${workspaceConfigs.length} workspace config(s)`);
  } else {
    logger.logInfo("No workspace configs found");
  }

  // If no workspace configs found and user-level config check is enabled, check user directories
  if (workspaceConfigs.length === 0 && config.checkUserLevelConfig) {
    logger.logInfo("No workspace config found, checking user-level config directories...");
    const userLevelConfig = await findUserLevelConfig(logger);
    if (userLevelConfig) {
      return [userLevelConfig];
    } else {
      logger.logInfo("No user-level config found either.");
    }
  } else if (workspaceConfigs.length === 0 && !config.checkUserLevelConfig) {
    logger.logInfo("No workspace config found. User-level config checking is disabled.");
  }

  return workspaceConfigs;

  async function attemptFindFiles() {
    const foundFiles = await vscodeFindFiles();
    if (foundFiles.length === 0) {
      return await attemptFindViaFallback();
    } else {
      return foundFiles;
    }
  }

  async function attemptFindViaFallback() {
    // retry trying to find a config file a few times if there's one found in the root directory
    const rootConfigFile = await getWorkspaceConfigFileInRoot();
    if (rootConfigFile == null) {
      return [];
    }
    if (opts.maxResults === 1) {
      // only searching for one config file, so exit fast
      return [rootConfigFile];
    }
    let retryCount = 0;
    while (retryCount++ < 4) {
      logger.logDebug("Found config file in root with fs API. Waiting a bit then retrying...");
      await delay(1_000);
      const foundFiles = await vscodeFindFiles();
      if (foundFiles.length > 0) {
        logger.logDebug("Found config file after retrying.");
        return foundFiles;
      }
    }

    // we don't glob for files because it's potentially incredibly slow in very large
    // projects
    logger.logWarn(
      "Gave up trying to find config file. Using only root discovered via file system API. "
        + "Maybe you have the dprint config file excluded from vscode? "
        + "Don't do that because then vscode hides the file from the extension and the "
        + "extension otherwise doesn't use the file system APIs to find config files.",
    );
    return [rootConfigFile];
  }

  function vscodeFindFiles() {
    return vscode.workspace.findFiles(
      /* include */ DPRINT_CONFIG_FILEPATH_GLOB,
      /* exclude */ "**/node_modules/**",
      opts?.maxResults,
    );
  }

  async function getWorkspaceConfigFileInRoot() {
    const dprintConfigFileNames = ["dprint.json", "dprint.jsonc", ".dprint.json", ".dprint.jsonc"];
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return undefined;
    }
    for (const folder of folders) {
      for (const fileName of dprintConfigFileNames) {
        const uri = vscode.Uri.joinPath(folder.uri, fileName);
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type === vscode.FileType.File) {
            return uri;
          }
        } catch {
          // does not exist
        }
      }
    }
    return undefined;
  }
}

export function ancestorDirsContainConfigFile(dirUri: vscode.Uri): boolean {
  for (const ancestorDirectoryPath of enumerateAncestorDirectories(dirUri.fsPath)) {
    if (directoryContainsConfigurationFile(ancestorDirectoryPath)) {
      return true;
    }
  }
  return false;

  function* enumerateAncestorDirectories(path: string): Iterable<string> {
    let currentPath = path;
    while (true) {
      const ancestorDirectoryPath = dirname(currentPath);
      if (ancestorDirectoryPath === currentPath) {
        break;
      }
      yield ancestorDirectoryPath;
      currentPath = ancestorDirectoryPath;
    }
  }

  function directoryContainsConfigurationFile(path: string): boolean {
    for (const configFileName of DPRINT_CONFIG_FILE_NAMES) {
      const configFilePath = join(path, configFileName);
      try {
        if (existsSync(configFilePath)) {
          return true;
        }
      } catch {
        // Continue to next path.
      }
    }
    return false;
  }
}

/**
 * Searches for dprint config files in user-level config directories.
 * Checks platform-specific locations:
 * - Linux/macOS: ~/.config/dprint.{json,jsonc} and ~/.config/dprint/dprint.{json,jsonc}
 * - Windows: %APPDATA%\dprint.{json,jsonc} and %APPDATA%\dprint\dprint.{json,jsonc}
 */
async function findUserLevelConfig(logger: Logger): Promise<vscode.Uri | undefined> {
  const userConfigDir = getUserConfigDirectory();
  const parentConfigDir = dirname(userConfigDir);

  logger.logInfo(`Searching for user-level configs in:`);
  logger.logInfo(`  - ${parentConfigDir}`);
  logger.logInfo(`  - ${userConfigDir}`);

  // First check for config files directly in parent directory (e.g., ~/.config/dprint.json)
  for (const configFileName of DPRINT_CONFIG_FILE_NAMES) {
    const configFilePath = join(parentConfigDir, configFileName);
    try {
      if (existsSync(configFilePath)) {
        logger.logInfo(`✓ Found user-level config: ${configFilePath}`);
        return vscode.Uri.file(configFilePath);
      }
    } catch (err) {
      logger.logDebug(`Error checking ${configFilePath}: ${err}`);
      // Continue to next file
    }
  }

  // Then check inside the dprint subdirectory (e.g., ~/.config/dprint/dprint.json)
  for (const configFileName of DPRINT_CONFIG_FILE_NAMES) {
    const configFilePath = join(userConfigDir, configFileName);
    try {
      if (existsSync(configFilePath)) {
        logger.logInfo(`✓ Found user-level config: ${configFilePath}`);
        return vscode.Uri.file(configFilePath);
      }
    } catch (err) {
      logger.logDebug(`Error checking ${configFilePath}: ${err}`);
      // Continue to next file
    }
  }

  return undefined;
}
