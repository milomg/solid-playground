import type { IEditorOverrideServices } from '@codingame/monaco-vscode-api';
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override';
import getNotificationServiceOverride from '@codingame/monaco-vscode-notifications-service-override';
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override';
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override';
import getExtensionServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override';
import getOutputServiceOverride from '@codingame/monaco-vscode-output-service-override';
import getMarkersServiceOverride from '@codingame/monaco-vscode-markers-service-override';
import getQuickAccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override';
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override';
import getViewStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override';
import getViewTitleBarServiceOverride from '@codingame/monaco-vscode-view-title-bar-service-override';
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override';
import getBulkEditServiceOverride from '@codingame/monaco-vscode-bulk-edit-service-override';

// Each service-override package brings in its own slice of upstream vscode source. Anything we
// don't surface is a free saving. Dropped (we don't use the underlying feature in the playground):
//   view-banner    — never call setBanner()
//   preferences    — no settings UI; we configure via initServices' configurationDefaults
//   secret-storage — no vscode.SecretStorage usage; tokens live in localStorage instead

const corePackages = {
  ...getLogServiceOverride(),
  ...getExtensionServiceOverride({ enableWorkerExtensionHost: true }),
  ...getModelServiceOverride(),
  ...getNotificationServiceOverride(),
  ...getDialogsServiceOverride(),
  ...getConfigurationServiceOverride(),
  ...getKeybindingsServiceOverride(),
  ...getTextmateServiceOverride(),
  ...getThemeServiceOverride(),
  ...getLanguagesServiceOverride(),
  ...getStorageServiceOverride(),
  ...getEnvironmentServiceOverride(),
  ...getLifecycleServiceOverride(),
  ...getOutputServiceOverride(),
  ...getMarkersServiceOverride(),
  ...getWorkingCopyServiceOverride(),
  ...getBulkEditServiceOverride(),
};

export function buildFullServices(): IEditorOverrideServices {
  return {
    ...corePackages,
    ...getExplorerServiceOverride(),
    ...getViewStatusBarServiceOverride(),
    ...getViewTitleBarServiceOverride(),
    ...getQuickAccessServiceOverride({
      isKeybindingConfigurationVisible: () => true,
      shouldUseGlobalPicker: () => true,
    }),
  };
}

export function buildEmbedServices(): IEditorOverrideServices {
  return {
    ...corePackages,
    ...getQuickAccessServiceOverride({
      isKeybindingConfigurationVisible: () => false,
      shouldUseGlobalPicker: () => false,
    }),
  };
}
