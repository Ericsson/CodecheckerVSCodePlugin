import { ExtensionContext, Uri, commands, window, workspace } from 'vscode';
import { quote } from 'shell-quote';
import { ExtensionApi } from '../backend';

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

        const choice = await window.showInformationMessage(
            choiceMessage,
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

            const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') ?? 'CodeChecker';
            const commandLine = quote([
                ccPath,
                ...ExtensionApi.executorBridge.getLogCmdArgs()!
            ]);

            const terminal = window.createTerminal('CodeChecker');
            terminal.show(false);

            // Wait some time until the terminal is initialized properly. For now there is no elegant solution to solve
            // this problem than using setTimeout.
            setTimeout(() => {
                terminal.sendText(commandLine, false);
            }, 1000);

            return;
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