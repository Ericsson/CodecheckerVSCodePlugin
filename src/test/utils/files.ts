import { commands, extensions, window, workspace } from 'vscode';
import { CodeCheckerExtension } from '../../extension';
import { waitForEvent } from './events';

// Show the text document after opening it, otherwise it won't become active
export async function openDocument(path: string): Promise<void> {
    const doc = await workspace.openTextDocument(path);
    await window.showTextDocument(doc);
};

// Can run for up to 1.5 seconds.
export async function closeAllTabs(): Promise<void> {
    const extension: CodeCheckerExtension = await extensions.getExtension('codechecker.codechecker')!.activate();
    const diagnosticsApi = extension.extensionApi.diagnostics;

    await commands.executeCommand('workbench.action.closeAllEditors');

    // waits for a diagnostics reload event, with a timeout
    await Promise.race([
        waitForEvent(diagnosticsApi.diagnosticsUpdated),
        new Promise((res) => setTimeout(res, 1000))
    ]);

    // ...and then waits for all other events to be done
    new Promise((res) => setTimeout(res, 200));
}