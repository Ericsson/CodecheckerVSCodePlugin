import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Event, EventEmitter, ExtensionContext, Uri, window, workspace } from 'vscode';

export enum ProcessStatus {
    notRunning,
    running,
    killed,
    finished,
    errored,
}

export class ExecutorProcess {
    activeProcess?: child_process.ChildProcess;

    /** Every line should have a newline at the end */
    private _processStdout: EventEmitter<string> = new EventEmitter();
    /**
     * Standard output of the process.
     *
     * Also contains other metadata:
     * * ``> command`` for each executed command,
     * * ``>>> metadata`` for other information, eg. when a process is finished.
     */
    public get processStdout(): Event<string> {
        return this._processStdout.event;
    }

    /** Every line should have a newline at the end */
    private _processStderr: EventEmitter<string> = new EventEmitter();
    /** Standard error of the process. */
    public get processStderr(): Event<string> {
        return this._processStderr.event;
    }

    private _processStatus: ProcessStatus = ProcessStatus.notRunning;
    public get processStatus(): ProcessStatus {
        return this._processStatus;
    }

    private _processStatusChange: EventEmitter<ProcessStatus> = new EventEmitter();
    public get processStatusChange(): Event<ProcessStatus> {
        return this._processStatusChange.event;
    }

    constructor(_ctx: ExtensionContext) {
    }

    private updateStatus(status: ProcessStatus) {
        switch (status) {
        case ProcessStatus.running:
            if (this._processStatus !== ProcessStatus.running) {
                this._processStatus = ProcessStatus.running;
                this._processStatusChange.fire(ProcessStatus.running);
            }
            break;
        default:
            if (this._processStatus === ProcessStatus.running) {
                this.activeProcess = undefined;
                this._processStatus = ProcessStatus.notRunning;
                this._processStatusChange.fire(status);
            }
            break;
        }
    }

    public getCompileCommandsPath() {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

        const getConfigAndReplaceVariables = (category: string, name: string): string | undefined => {
            const configValue = workspace.getConfiguration(category).get<string>(name);
            return configValue
                ?.replace(/\${workspaceRoot}/g, workspaceFolder)
                .replace(/\${workspaceFolder}/g, workspaceFolder)
                .replace(/\${cwd}/g, process.cwd())
                .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => process.env[envName] ?? '');
        };

        const ccFolder = getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? path.join(workspaceFolder, '.codechecker');

        const compileCmdPaths = [
            getConfigAndReplaceVariables('codechecker.backend', 'databasePath'),
            path.join(ccFolder, 'compile_commands.json'),
            path.join(ccFolder, 'compile_cmd.json')
        ];

        for (const filePath of compileCmdPaths) {
            if (filePath && fs.existsSync(filePath)) {
                this._processStderr.fire(`>>> Database found at path: ${filePath}\n`);
                return filePath;
            }
        }

        this._processStderr.fire('>>> No database found in the following paths:\n');
        for (const filePath of compileCmdPaths) {
            if (filePath) {
                this._processStderr.fire(`>>>   ${filePath}\n`);
            } else {
                this._processStderr.fire('>>>   <no path set in settings>');
            }
        }

        return undefined;
    }

    public getProcessCmdLine(...files: Uri[]): string | undefined {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

        const getConfigAndReplaceVariables = (category: string, name: string): string | undefined => {
            const configValue = workspace.getConfiguration(category).get<string>(name);
            return configValue
                ?.replace(/\${workspaceRoot}/g, workspaceFolder)
                .replace(/\${workspaceFolder}/g, workspaceFolder)
                .replace(/\${cwd}/g, process.cwd())
                .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => process.env[envName] ?? '');
        };

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath')
            ?? 'CodeChecker';
        const ccFolder = getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? path.join(workspaceFolder, '.codechecker');
        const ccArguments = getConfigAndReplaceVariables('codechecker.executor', 'arguments') ?? '';
        const ccThreads = workspace.getConfiguration('codechecker.executor').get<string>('threadCount');

        const ccCompileCmd = this.getCompileCommandsPath();

        if (ccCompileCmd === undefined) {
            window.showWarningMessage('No compilation database found, CodeChecker not started - see logs for details');
            return undefined;
        }

        const filePaths = files.length
            ? `--file ${files.map((uri) => `"${uri.fsPath}"`).join(' ')}`
            : '';

        return [
            `${ccPath} analyze`,
            `"${ccCompileCmd}"`,
            `--output "${ccFolder}"`,
            `${ccThreads ? '-j ' + ccThreads : ''}`,
            `${ccArguments}`,
            `${filePaths}`,
        ].join(' ');
    }

    public getLogCmdLine(): string | undefined {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

        const getConfigAndReplaceVariables = (category: string, name: string): string | undefined => {
            const configValue = workspace.getConfiguration(category).get<string>(name);
            return configValue
                ?.replace(/\${workspaceRoot}/g, workspaceFolder)
                .replace(/\${workspaceFolder}/g, workspaceFolder)
                .replace(/\${cwd}/g, process.cwd())
                .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => process.env[envName] ?? '');
        };

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath')
            ?? 'CodeChecker';
        const ccFolder = getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? path.join(workspaceFolder, '.codechecker');

        // Use a predefined path here
        const ccCompileCmd = path.join(ccFolder, 'compile_commands.json');

        return [
            `${ccPath} log`,
            `--output "${ccCompileCmd}"`,
            '--build "make"'
        ].join(' ');
    }

    /**
     * If the arguments are empty, the entire project is analyzed
     */
    public startProcess(...files: Uri[]) {
        if (this.activeProcess !== undefined) {
            return;
        }

        if (!workspace.workspaceFolders?.length) {
            // Silently ignore the call - user will be warned via other modules
            return;
        }

        const commandLine = this.getProcessCmdLine(...files);

        if (commandLine === undefined) {
            return;
        }

        this._processStdout.fire(`> ${commandLine}\n`);
        this.activeProcess = child_process.spawn(commandLine, { shell: true });
        this.activeProcess.stdout!.on('data', (stdout: Buffer) => {
            const decoded = stdout.toString();
            this._processStdout.fire(decoded);
        });

        this.activeProcess.stderr!.on('data', (stderr) => {
            const decoded = stderr.toString();
            this._processStderr.fire(decoded);
        });

        this.activeProcess.on('error', (err) => {
            this._processStdout.fire(`>>> Process errored: ${err.message}\n`);
            this.updateStatus(ProcessStatus.errored);
        });
        this.activeProcess.on('exit', (code: number | null) => {
            this._processStdout.fire(`>>> Process exited with code ${code ?? 0}\n`);

            switch (code) {
            case null:
            case 0:
                this.updateStatus(ProcessStatus.finished);
                break;
            default:
                this.updateStatus(ProcessStatus.errored);
                break;
            }
        });

        this.updateStatus(ProcessStatus.running);
    }

    public killProcess() {
        if (this.activeProcess === undefined) {
            return;
        }

        this.activeProcess.kill('SIGINT');
        this._processStdout.fire('>>> Process killed\n');

        this.updateStatus(ProcessStatus.killed);
    }
}