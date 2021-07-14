import * as vscode from 'vscode';
import { ExtensionApi } from './backend/api';
import { SidebarContainer } from './sidebar';

export function activate(context: vscode.ExtensionContext) {
    // Backend must be initialized before the frontend
    ExtensionApi.init(context);
    SidebarContainer.init(context);

    console.log('Extension "codechecker" activated');
}

export function deactivate() {}
