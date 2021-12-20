import { workspace } from 'vscode';

export function getConfigAndReplaceVariables(category: string, name: string): string | undefined {
    if (!workspace.workspaceFolders) {
        return;
    }

    const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

    const configValue = workspace.getConfiguration(category).get<string>(name);
    return configValue
        ?.replace(/\${workspaceRoot}/g, workspaceFolder)
        .replace(/\${workspaceFolder}/g, workspaceFolder)
        .replace(/\${cwd}/g, process.cwd())
        .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => process.env[envName] ?? '');
}
