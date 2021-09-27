import { ExtensionContext, OutputChannel, window } from 'vscode';
import { ExtensionApi } from '../backend';

export class LoggerPanel {
    public window: OutputChannel;

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this.window = window.createOutputChannel('CodeChecker'));
        ExtensionApi.executorProcess.processStdout(this.window.append, this.window, ctx.subscriptions);
        ExtensionApi.executorProcess.processStderr(this.window.append, this.window, ctx.subscriptions);
    }
}