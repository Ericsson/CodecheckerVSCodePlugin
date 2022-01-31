import {
    ExtensionContext,
    StatusBarAlignment,
    StatusBarItem,
    commands,
    window
} from 'vscode';
import { Editor } from '.';
import { ExtensionApi } from '../backend';
import { ProcessStatus } from '../backend/executor/process';

export class ExecutorAlerts {
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
        if (ExtensionApi.executorManager.activeProcess === undefined) {
            return;
        }

        if (status === ProcessStatus.running) {
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

        this.statusBarItem.show();
    }
}