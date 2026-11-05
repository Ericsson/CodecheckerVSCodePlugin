import * as vscode from 'vscode';
import { ExtensionApi } from './backend';
import { Editor } from './editor';
import { SidebarContainer } from './sidebar';
import { checkWorkspace } from './utils/files';

export interface CodeCheckerExtension {
    extensionApi: typeof ExtensionApi,
    sidebarContainer: typeof SidebarContainer,
    editor: typeof Editor
}

export async function activate(context: vscode.ExtensionContext): Promise<CodeCheckerExtension | undefined> {
    // Backend must be initialized before the frontend
    const hasWorkspace = !!vscode.workspace.workspaceFolders;
    vscode.commands.executeCommand(
        'setContext',
        'codechecker.hasWorkspace',
        hasWorkspace
    );

    if (vscode.workspace.name === undefined) {
        return;
    }
    if (await checkWorkspace()) {
        ExtensionApi.init(context);
        Editor.init(context);
    }
    SidebarContainer.init(context);

    console.log('Extension "codechecker" activated');

    return {
        extensionApi: ExtensionApi,
        sidebarContainer: SidebarContainer,
        editor: Editor
    };
}

export function deactivate() {}
