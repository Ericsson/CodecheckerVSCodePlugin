import { parse } from 'shell-quote';
import { workspace } from 'vscode';

export function getConfigAndReplaceVariables(category: string, name: string): string | undefined {
    const configValue = workspace.getConfiguration(category).get<string>(name);

    return replaceVariables(configValue);
}

export function parseShellArgsAndReplaceVariables(shellArgs?: string): string[] {
    if (!workspace.workspaceFolders) {
        return [];
    }

    const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

    const env: { [key: string]: string } = {
        workspaceFolder,
        workspaceRoot: workspaceFolder,
        cwd: process.cwd()
    };
    for (const [key, val] of Object.entries(process.env)) {
        if (val !== undefined) {
            env[`env:${key}`] = val;
        }
    }

    return [ ...parse(shellArgs ?? '', env) ]
        .filter((entry) => typeof entry === 'string' && entry.length > 0)
        .map((entry) => replaceVariables(entry as string)!);
}

export function replaceVariables(pathLike?: string): string | undefined {
    if (!workspace.workspaceFolders) {
        return;
    }

    const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

    return pathLike
        ?.replace(/\${workspaceRoot}/g, workspaceFolder)
        .replace(/\${workspaceFolder}/g, workspaceFolder)
        .replace(/\${cwd}/g, process.cwd())
        .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => process.env[envName] ?? '');
}
