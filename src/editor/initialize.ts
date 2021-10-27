import { ExtensionContext, Uri, commands, window, workspace } from 'vscode';
import { ExtensionApi } from '../backend';

export class FolderInitializer {
    constructor(_ctx: ExtensionContext) {
        commands.registerCommand('codechecker.editor.showSetupDialog', this.showDialog, this);

        this.showDialogIfAvailable()
            .catch((err) => console.error(err));
    }

    async showDialogIfAvailable() {
        if (
            ExtensionApi.executorProcess.getCompileCommandsPath() === undefined &&
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

        const choice = await window.showInformationMessage(
            'compile_commands.json was not found in the CodeChecker folder. How would you like to proceed?',
            'Run CodeChecker log',
            'Locate',
            'Don\'t show again'
        );

        const getConfigAndReplaceVariables = (category: string, name: string): string | undefined => {
            const configValue = workspace.getConfiguration(category).get<string>(name);
            return configValue
                ?.replace(/\${workspaceRoot}/g, workspaceFolder.fsPath)
                .replace(/\${workspaceFolder}/g, workspaceFolder.fsPath)
                .replace(/\${cwd}/g, process.cwd())
                .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => process.env[envName] ?? '');
        };

        const codeCheckerFolder = Uri.file(
            getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? Uri.joinPath(workspaceFolder, '.codechecker').fsPath
        );

        switch (choice) {
        case 'Run CodeChecker log':
            await workspace.fs.createDirectory(codeCheckerFolder);

            const terminal = window.createTerminal('CodeChecker');
            terminal.sendText(ExtensionApi.executorProcess.getLogCmdLine()!, false);
            terminal.show(false);

            return;
        case 'Locate':
            const filePath = await window.showOpenDialog({ canSelectFiles: true });
            if (!filePath || filePath.length === 0) {
                break;
            }

            workspace.getConfiguration('codechecker.backend').update('databasePath', filePath[0].fsPath);
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
            ExtensionApi.executorProcess.getProcessCmdLine() === undefined &&
            workspace.getConfiguration('codechecker.editor').get('showDatabaseDialog') !== false
        ) {
            await this.showDialog();
        }
    }
}