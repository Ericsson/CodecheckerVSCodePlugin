import * as vscode from 'vscode';
import { ExtensionApi } from './backend';
import { Editor } from './editor';
import { SidebarContainer } from './sidebar';

export interface CodeCheckerExtension {
    extensionApi: typeof ExtensionApi,
    sidebarContainer: typeof SidebarContainer,
    editor: typeof Editor
}

export function activate(context: vscode.ExtensionContext): CodeCheckerExtension {
    // Backend must be initialized before the frontend
    ExtensionApi.init(context);
    Editor.init(context);
    SidebarContainer.init(context);

    console.log('Extension "codechecker" activated');

    return {
        extensionApi: ExtensionApi,
        sidebarContainer: SidebarContainer,
        editor: Editor
    };
}

export function deactivate() {}
