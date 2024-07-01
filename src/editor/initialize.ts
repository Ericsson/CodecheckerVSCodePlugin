import { ExtensionContext, Uri, commands, window, workspace } from 'vscode';
import { ExtensionApi } from '../backend';
import { Editor } from './editor';
import { NotificationType } from './notifications';

export class FolderInitializer {
    constructor(_ctx: ExtensionContext) {
        commands.registerCommand('codechecker.editor.showSetupDialog', this.showDialog, this);

        commands.registerCommand('codechecker.internal.locateCompilationDatabase', this.locateDatabase, this);
        commands.registerCommand('codechecker.internal.disableDatabaseDialog', this.disableDialog, this);

        this.showDialogIfAvailable()
            .catch((err) => console.error(err));
    }

    async showDialogIfAvailable() {
        if (
            // TODO: Don't show setup dialog for multi-root workspaces
            ExtensionApi.executorBridge.getCompileCommandsPath() === undefined &&
            workspace.getConfiguration('codechecker.editor').get('showDatabaseDialog') !== false
        ) {
            await this.showDialog();
        }
    }

    async showDialog() {
        const workspaceFolder = workspace.workspaceFolders?.length && workspace.workspaceFolders[0].uri;

        if (!workspaceFolder) {
            return;
        }

        const notificationText = ExtensionApi.executorBridge.getCompileCommandsPath() === undefined
            ? 'Compilation database not found. How would you like to proceed?'
            : 'Would you like to update the compilation database?';
        const choices = [
            {
                title: 'Run CodeChecker log',
                command: 'codechecker.executor.previewLogInTerminal'
            },
            {
                title: 'Locate',
                command: 'codechecker.internal.locateCompilationDatabase'
            },
            {
                title: 'More info',
                command: 'vscode.open',
                arguments: [ Uri.parse(
                    'https://github.com/Ericsson/CodeCheckerVSCodePlugin#setting-up-your-build-environment'
                ) ]
            }
        ];
        const disableDialogChoice = {
            title: 'Don\'t show again',
            command: 'codechecker.internal.disableDatabaseDialog'
        };

        // Only send the notification once to the sidebar
        void Editor.notificationHandler.showNotification(
            NotificationType.information,
            notificationText,
            { choices, showOnTray: false }
        );

        let shouldShowDialog = true;

        // but keep open until closed on the tray
        while (shouldShowDialog) {
            const choice = await Editor.notificationHandler.showNotification(
                NotificationType.warning,
                notificationText,
                {
                    choices: [...choices, disableDialogChoice],
                    showOnSidebar: false
                }
            );

            // Show again next time this workspace is opened (if the user did not disable it)
            if (choice === undefined || choice === disableDialogChoice.title) {
                return;
            }

            // If initialization failed, show notification again
            shouldShowDialog = ExtensionApi.executorBridge.getCompileCommandsPath() === undefined &&
                workspace.getConfiguration('codechecker.editor').get('showDatabaseDialog') !== false;
        }
    }

    async locateDatabase() {
        const filePath = await window.showOpenDialog({ canSelectFiles: true });
        if (!filePath || filePath.length === 0) {
            return;
        }

        workspace.getConfiguration('codechecker.backend').update('compilationDatabasePath', filePath[0].fsPath);
    }

    disableDialog() {
        workspace.getConfiguration('codechecker.editor').update('showDatabaseDialog', false);
    }
}