import { Uri, workspace } from 'vscode';
import { state } from './state';

const EXTENSIONS = [
    '.c',
    '.cc',
    '.cpp',
    '.cxx'
];

export function isSupportedFile(uri: Uri | undefined): boolean {
    if (uri === undefined) {
        return false;
    }

    return EXTENSIONS.find(ext => uri.path.endsWith(ext)) !== undefined;
}

export async function isSupportedWorkspace() {
    const supported = await workspace.findFiles(
        `**/*.{${EXTENSIONS.join(',')}}`,
        '**/{node_modules,.git}/**',
        1
    );

    return supported.length > 1;
}

export async function checkWorkspace() {
    if (workspace.name === undefined) {
        state.workspaceSupported = false;
        console.log('No open workspace.');
        return;
    }
    const supported = await isSupportedWorkspace();
    if (supported) {
        state.workspaceSupported = true;
    } else {
        state.workspaceSupported = false;
        console.log(`workspace ${workspace.name} does not contain supported files.`);
    }
}