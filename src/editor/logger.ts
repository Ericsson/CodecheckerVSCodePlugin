import { ExtensionContext, OutputChannel, commands, window } from 'vscode';
import { ExtensionApi } from '../backend';

export class LoggerPanel {
    public window: OutputChannel;

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this.window = window.createOutputChannel('CodeChecker'));

        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.showOutput', this.showOutputTab, this)
        );

        ExtensionApi.executorBridge.bridgeMessages(this.window.append, this.window, ctx.subscriptions);
        ExtensionApi.executorManager.processStdout(this.window.append, this.window, ctx.subscriptions);
        ExtensionApi.executorManager.processStderr(this.window.append, this.window, ctx.subscriptions);
    }

    showOutputTab() {
        // Hiding and re-showing the window resets the auto-scroll state.
        this.window.hide();

        // setTimeout is needed to make sure Theia will show the correct output channel.
        setTimeout(() => this.window.show(false), 0);
    }
}