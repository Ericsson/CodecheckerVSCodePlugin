import { quote } from 'shell-quote';
import {
    ExtensionContext,
    StatusBarAlignment,
    StatusBarItem,
    Terminal,
    Uri,
    commands,
    window,
    workspace,
} from 'vscode';
import { Editor } from '.';
import { ExtensionApi } from '../backend';
import { ProcessStatus, ProcessStatusType, ScheduledProcess } from '../backend/executor/process';
import { getConfigAndReplaceVariables } from '../utils/config';
import { NotificationType } from './notifications';

export class ExecutorAlerts {
    private statusBarItem: StatusBarItem;
    private enableProgress = true;
    private codeCheckerTerminal?: Terminal;

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left));
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.showCommandLine', this.printCmdLine, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.previewLogInTerminal', this.showLogInTerminal, this)
        );

        ExtensionApi.executorManager.processStatusChange(this.onStatusChange, this, ctx.subscriptions);

        this.init();
    }

    init() {
        this.statusBarItem.text = 'CodeChecker: not running';
        this.statusBarItem.command = { title: '', command: 'codechecker.executor.showOutput' };
        this.statusBarItem.show();
    }

    printCmdLine() {
        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') || 'CodeChecker';
        const commandLine = quote([
            ccPath,
            ...ExtensionApi.executorBridge.getAnalyzeCmdArgs() ?? []
        ]);

        Editor.loggerPanel.window.appendLine('>>> Full command line:');
        Editor.loggerPanel.window.appendLine(`>>> ${commandLine}`);

        Editor.loggerPanel.showOutputTab();
    }

    async showLogInTerminal() {
        const workspaceFolder = workspace.workspaceFolders?.length && workspace.workspaceFolders[0].uri;

        if (!workspaceFolder) {
            return;
        }

        const codeCheckerFolder = Uri.file(
            getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? Uri.joinPath(workspaceFolder, '.codechecker').fsPath
        );

        // Create the CodeChecker folder, otherwise running log will fail
        await workspace.fs.createDirectory(codeCheckerFolder);

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') || 'CodeChecker';
        const commandLine = quote([
            ccPath,
            ...ExtensionApi.executorBridge.getLogCmdArgs()!
        ]);

        if (this.codeCheckerTerminal === undefined) {
            this.codeCheckerTerminal = window.createTerminal('CodeChecker');
        }

        this.codeCheckerTerminal!.show(false);

        // Wait some time until the terminal is initialized properly. For now there is no elegant solution to solve
        // this problem than using setTimeout.
        setTimeout(() => {
            this.codeCheckerTerminal!.sendText(commandLine, false);
        }, 1000);
    }

    onStatusChange([status, _]: [ProcessStatus, ScheduledProcess]) {
        // Do not update when a non-progressbar process was finished
        if (ExtensionApi.executorManager.activeProcess === undefined) {
            return;
        }

        if (status.type === ProcessStatusType.running) {
            this.statusBarItem.text = '$(loading) CodeChecker: analysis in progress...';
            this.statusBarItem.show();
            return;
        }

        switch (status.type) {
        case ProcessStatusType.finished:
            this.statusBarItem.text = '$(testing-passed-icon) CodeChecker: analysis finished';
            break;
        case ProcessStatusType.killed:
            this.statusBarItem.text = '$(testing-failed-icon) CodeChecker: analysis killed';
            break;
        case ProcessStatusType.notRunning:
            this.statusBarItem.text = '$(info) CodeChecker: ready';
            break;
        case ProcessStatusType.errored:
            this.statusBarItem.text = '$(testing-error-icon) CodeChecker: analysis errored';

            const logLocation = status.reason ? 'sidebar' : 'output log';

            Editor.notificationHandler.showNotification(
                NotificationType.error,
                `CodeChecker finished with error - see the ${logLocation} for details`
            );
            break;
        default:
            break;
        }

        this.statusBarItem.show();
    }
}