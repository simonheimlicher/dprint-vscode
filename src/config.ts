import * as vscode from "vscode";
import { shellExpand } from "./utils";

export interface DprintExtensionConfigPathInfo {
  path: string;
  isFromWorkspace: boolean;
}

export interface DprintExtensionConfig {
  pathInfo: DprintExtensionConfigPathInfo | undefined;
  verbose: boolean;
  experimentalLsp: boolean;
  configPath: string | undefined;
  checkUserLevelConfig: boolean;
}

export function getCombinedDprintConfig(folders: readonly vscode.WorkspaceFolder[]) {
  const combinedConfig: DprintExtensionConfig = {
    pathInfo: undefined,
    verbose: false,
    experimentalLsp: false,
    configPath: undefined,
    checkUserLevelConfig: true,
  };

  for (const folder of folders) {
    const config = getDprintConfig(folder.uri);
    if (config.verbose) {
      combinedConfig.verbose = true;
    }
    if (config.experimentalLsp) {
      combinedConfig.experimentalLsp = true;
    }
    if (config.pathInfo != null && combinedConfig.pathInfo == null) {
      combinedConfig.pathInfo = config.pathInfo;
    }
    if (config.configPath != null && combinedConfig.configPath == null) {
      combinedConfig.configPath = config.configPath;
    }
    if (!config.checkUserLevelConfig) {
      combinedConfig.checkUserLevelConfig = false;
    }
  }

  return combinedConfig;
}

export function getDprintConfig(scope: vscode.Uri): DprintExtensionConfig {
  const config = vscode.workspace.getConfiguration("dprint", scope);
  const pathInfo = getPathInfo();
  return {
    pathInfo,
    verbose: getBool("verbose"),
    experimentalLsp: getBool("experimentalLsp"),
    configPath: getPath("configPath"),
    checkUserLevelConfig: getBoolWithDefault("checkUserLevelConfig", true),
  };

  function getPathInfo(): DprintExtensionConfigPathInfo | undefined {
    const inspection = config.inspect<string>("path");

    const rawPath = config.get("path");
    if (typeof rawPath === "string" && rawPath.trim().length > 0) {
      // check if path is set in workspace or folder settings (not global/user)
      const workspaceValue = inspection?.workspaceValue;
      const folderValue = inspection?.workspaceFolderValue;
      const isFromWorkspace = (typeof workspaceValue === "string" && workspaceValue.trim().length > 0)
        || (typeof folderValue === "string" && folderValue.trim().length > 0);
      return {
        path: shellExpand(rawPath.trim()),
        isFromWorkspace,
      };
    } else {
      return undefined;
    }
  }

  function getPath(name: string) {
    const path = config.get(name);
    if (typeof path === "string" && path.trim().length > 0) {
      return shellExpand(path.trim());
    }
    return undefined;
  }

  function getBool(name: string) {
    const value = config.get(name);
    return value === true;
  }

  function getBoolWithDefault(name: string, defaultValue: boolean) {
    const value = config.get(name);
    return value === null || value === undefined ? defaultValue : value === true;
  }
}
