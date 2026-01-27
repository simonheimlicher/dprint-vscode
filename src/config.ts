import * as vscode from "vscode";
import { shellExpand } from "./utils";

export interface DprintExtensionConfig {
  path: string | undefined;
  verbose: boolean;
  experimentalLsp: boolean;
  configPath: string | undefined;
  checkUserLevelConfig: boolean;
}

export function getCombinedDprintConfig(folders: readonly vscode.WorkspaceFolder[]) {
  const combinedConfig: DprintExtensionConfig = {
    path: undefined,
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
    if (config.path != null && combinedConfig.path == null) {
      combinedConfig.path = config.path;
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
  return {
    path: getPath("path"),
    verbose: getBool("verbose"),
    experimentalLsp: getBool("experimentalLsp"),
    configPath: getPath("configPath"),
    checkUserLevelConfig: getBoolWithDefault("checkUserLevelConfig", true),
  };

  function getPath(name: string) {
    const path = getRawPath(name);
    return path == null ? undefined : shellExpand(path);

    function getRawPath(name: string) {
      const path = config.get(name);
      return typeof path === "string" && path.trim().length > 0 ? path.trim() : undefined;
    }
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
