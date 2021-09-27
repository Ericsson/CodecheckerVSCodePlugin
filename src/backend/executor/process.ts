import * as child_process from 'child_process';
import * as path from 'path';
import { Event, EventEmitter, ExtensionContext, Uri, workspace } from 'vscode';

export enum ProcessStatus {
    notRunning,
    running,
    killed,
    finished,
    errored,
}

export class ExecutorProcess {
    activeProcess?: child_process.ChildProcess;

    private _processStdout: EventEmitter<string> = new EventEmitter();
    public get processStdout(): Event<string> {
        return this._processStdout.event;
    }

    private _processStderr: EventEmitter<string> = new EventEmitter();
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

    public getProcessCmdLine(...files: Uri[]): string {
        if (this.activeProcess !== undefined) {
            // TODO: Better error handling
            return '';
        }

        if (!workspace.workspaceFolders?.length) {
            return '';
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
        const ccCompileCmd = path.join(ccFolder, 'compile_cmd.json');
        const ccArguments = getConfigAndReplaceVariables('codechecker.executor', 'arguments') ?? '';
        const ccThreads = workspace.getConfiguration('codechecker.executor').get<string>('threadCount');

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
        this.activeProcess.on('exit', () => {
            // FIXME: Errored process checking
            this._processStdout.fire('>>> Process exited\n');
            this.updateStatus(ProcessStatus.finished);
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