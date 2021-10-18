import { ExtensionContext, OutputChannel, commands, window } from 'vscode';
import { ExtensionApi } from '../backend';

export class LoggerPanel {
    public window: OutputChannel;

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this.window = window.createOutputChannel('CodeChecker'));

        ctx.subscriptions.push(
            commands.registerCommand('codechecker.logging.showOutput', this.showOutputTab, this)
        );

        ExtensionApi.executorProcess.processStdout(this.window.append, this.window, ctx.subscriptions);
        ExtensionApi.executorProcess.processStderr(this.window.append, this.window, ctx.subscriptions);
    }

    showOutputTab() {
        this.window.hide();
        this.window.show(false);
    }
}