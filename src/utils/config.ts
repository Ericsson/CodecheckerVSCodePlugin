import { workspace } from 'vscode';

export function getConfigAndReplaceVariables(category: string, name: string): string | undefined {
    const configValue = workspace.getConfiguration(category).get<string>(name);

    return replaceVariables(configValue);
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
