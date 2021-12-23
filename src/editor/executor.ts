import {
    CancellationTokenSource,
    ExtensionContext,
    ProgressLocation,
    StatusBarAlignment,
    StatusBarItem,
    commands,
    window
} from 'vscode';
import { Editor } from '.';
import { ExtensionApi } from '../backend';
import { ProcessStatus } from '../backend/executor/process';

export class ExecutorAlerts {
    private activeToken?: CancellationTokenSource;
    private statusBarItem: StatusBarItem;
    private enableProgress = true;

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left));
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.showCommandLine', this.printCmdLine, this)
        );

        ExtensionApi.executorManager.processStatusChange(this.onStatusChange, this, ctx.subscriptions);

        this.init();
    }

    init() {
        this.statusBarItem.text = 'CodeChecker: not running';
        this.statusBarItem.command = { title: '', command: 'codechecker.logging.showOutput' };
        this.statusBarItem.show();
    }

    printCmdLine() {
        const commandLine = ExtensionApi.executorBridge.getAnalyzeCmdLine();
        Editor.loggerPanel.window.appendLine('>>> Full command line:');
        Editor.loggerPanel.window.appendLine(`>>> ${commandLine}`);

        Editor.loggerPanel.showOutputTab();
    }

    onStatusChange(status: ProcessStatus) {
        // Do not update when a non-progressbar process was finished
        if (ExtensionApi.executorManager.activeProcess !== undefined) {
            this.enableProgress = ExtensionApi.executorManager.activeProcess.processParameters.showProgressBar!;
        }

        if (!this.enableProgress) {
            return;
        }

        if (status === ProcessStatus.running) {
            this.showProgressbar('CodeChecker: analysis in progress...');
            this.statusBarItem.text = 'CodeChecker: analysis in progress...';
            this.statusBarItem.show();
            return;
        }

        switch (status) {
        case ProcessStatus.finished:
            this.statusBarItem.text = 'CodeChecker: analysis finished';
            break;
        case ProcessStatus.killed:
            this.statusBarItem.text = 'CodeChecker: analysis killed';
            break;
        case ProcessStatus.notRunning:
            this.statusBarItem.text = 'CodeChecker: ready';
            break;
        case ProcessStatus.errored:
            this.statusBarItem.text = 'CodeChecker: analysis errored';
            window.showErrorMessage('CodeChecker finished with error - see logs for details');
            break;
        default:
            break;
        }

        this.hideProgressbar();
        this.statusBarItem.show();
    }

    showProgressbar(message: string) {
        // Clear previous alert, and then create the new progress
        if (this.activeToken !== undefined) {
            this.activeToken.cancel();
        }

        this.activeToken = new CancellationTokenSource();

        window.withProgress(
            { cancellable: true, location: ProgressLocation.Notification, title: message },
            async (_progress, cancelButton) => new Promise((res, _rej) => {
                this.activeToken?.token.onCancellationRequested(() => {
                    res(null);
                });

                cancelButton.onCancellationRequested(() => {
                    // On Cancel button, kill the process
                    ExtensionApi.executorBridge.stopAnalysis();
                    res(null);
                });
            })
        );
    }

    hideProgressbar() {
        if (this.activeToken !== undefined) {
            this.activeToken.cancel();
            this.activeToken = undefined;
        }
    }
}