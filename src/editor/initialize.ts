import { ExtensionContext, commands, window, workspace } from 'vscode';
import { ExtensionApi } from '../backend';
import { Editor } from './editor';
import { NotificationType } from './notifications';

export class FolderInitializer {
    constructor(_ctx: ExtensionContext) {
        commands.registerCommand('codechecker.editor.showSetupDialog', this.showDialog, this);

        this.showDialogIfAvailable()
            .catch((err) => console.error(err));
    }

    async showDialogIfAvailable() {
        if (
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

        const choiceMessage = ExtensionApi.executorBridge.getCompileCommandsPath() === undefined
            ? 'Compilation database not found. How would you like to proceed?'
            : 'Would you like to update the compilation database?';

        const choice = await Editor.notificationHandler.showNotification(
            NotificationType.information,
            choiceMessage,
            { choices: [
                'Run CodeChecker log',
                'Locate',
                'Don\'t show again'
            ] }
        );

        switch (choice) {
        case 'Run CodeChecker log':
            return await Editor.executorAlerts.showLogInTerminal();
        case 'Locate':
            const filePath = await window.showOpenDialog({ canSelectFiles: true });
            if (!filePath || filePath.length === 0) {
                break;
            }

            workspace.getConfiguration('codechecker.backend').update('compilationDatabasePath', filePath[0].fsPath);
            return;
        case 'Don\'t show again':
            workspace.getConfiguration('codechecker.editor').update('showDatabaseDialog', false);
            return;
        default:
            // Show again next time this workspace is opened
            return;
        }

        // If initialization failed, show notification again
        if (
            ExtensionApi.executorBridge.getAnalyzeCmdArgs() === undefined &&
            workspace.getConfiguration('codechecker.editor').get('showDatabaseDialog') !== false
        ) {
            await this.showDialog();
        }
    }
}