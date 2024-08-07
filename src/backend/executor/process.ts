import * as childProcess from 'child_process';
import * as os from 'os';
import { quote } from 'shell-quote';
import { Disposable, Event, EventEmitter, ExtensionContext, workspace } from 'vscode';

export enum ProcessStatusType {
    notRunning,
    running,
    // When added to the execution queue
    queued,
    killed,
    finished,
    warning,
    errored,
    // When overwritten in the queue with 'replace', or cleared
    removed,
}

export interface ProcessStatus {
    type: ProcessStatusType,
    reason?: string
}

export enum ProcessType {
    analyze = 'CodeChecker analyze',
    checkers = 'CodeChecker checkers',
    log = 'CodeChecker log',
    parse = 'CodeChecker parse',
    version = 'CodeChecker analyzer-version',
    other = 'Other process',
}

const homeDir = os.homedir();

// Expand an initial '~' component in the given path if there is any, otherwise returns the file path without changes.
function expandUser(filePath: string) {
    return homeDir ? filePath.replace(/^~(?=$|\/|\\)/, homeDir) : filePath;
}

export interface ProcessParameters {
    /** Default: true, false when type is parse */
    forwardStdoutToLogs?: boolean,

    /**
     * Name of the process, preferred to be one of ProcessType.
     * Default: other
     */
    processType?: string
}

export class ScheduledProcess implements Disposable {
    /** Command line of the executed process.
     * Note: In the executed command line, each argument is passed separately, so no need to escape individual args.
     */
    public get commandLine() {
        return quote([
            this.executable,
            ...this.commandArgs
        ]);
    };

    public readonly executable: string;
    public readonly commandArgs: string[];

    private activeProcess?: childProcess.ChildProcess;
    private lastLogMessage?: string;

    /** Contains parameters for the executor. All members are defined. */
    public readonly processParameters: ProcessParameters;

    /** Every line should have a newline at the end */
    private _processStdout: EventEmitter<string> = new EventEmitter();
    /**
     * Standard output of the process.
     *
     * Does not contain any metadata.
     */
    public get processStdout(): Event<string> {
        return this._processStdout.event;
    }

    /** Every line should have a newline at the end */
    private _processStderr: EventEmitter<string> = new EventEmitter();
    /**
     * Standard error of the process.
     *
     * Also contains other metadata:
     * ``> command`` for the executed command,
     * ``>>> metadata`` for other information, eg. when the process is finished.
     */
    public get processStderr(): Event<string> {
        return this._processStderr.event;
    }

    private _processStatus: ProcessStatusType = ProcessStatusType.notRunning;
    public get processStatus(): ProcessStatusType {
        return this._processStatus;
    }

    private _processStatusChange: EventEmitter<ProcessStatus> = new EventEmitter();
    public get processStatusChange(): Event<ProcessStatus> {
        return this._processStatusChange.event;
    }

    constructor(executable: string, commandArgs?: string[], parameters?: ProcessParameters) {
        this.executable = expandUser(executable);
        this.commandArgs = commandArgs ?? [];
        this.processParameters = parameters ?? {};

        const processType = parameters?.processType ?? '';
        const forwardDefaults: string[] = [ ProcessType.checkers, ProcessType.parse ];

        if (this.processParameters.forwardStdoutToLogs === undefined) {
            this.processParameters.forwardStdoutToLogs = !forwardDefaults.includes(processType);
        }

        const parseLogMessage = (stdout: string) => {
            // Do not store json output or meta messages as last error
            const lines = stdout.split('\n')
                .filter((line) => !line.startsWith('{') && !line.startsWith('>') && line !== '');

            if (lines.length > 0) {
                this.lastLogMessage = lines[lines.length - 1];
            }
        };

        this.processStdout(parseLogMessage, this);
        this.processStderr(parseLogMessage, this);
    }

    dispose() {
        if (this.activeProcess) {
            this.killProcess();
        }

        this._processStatusChange.fire({ type: ProcessStatusType.removed });

        this._processStatusChange.dispose();
        this._processStdout.dispose();
        this._processStderr.dispose();
    }

    /** This should only be called by the executor. */
    startProcess() {
        if (this.activeProcess !== undefined) {
            return;
        }

        if (!workspace.workspaceFolders?.length) {
            // Silently ignore the call - user will be warned via other modules
            return;
        }

        const commonName = this.processParameters.processType ?? 'Other';

        this._processStderr.fire(`>>> Starting process '${commonName}'\n`);
        this._processStderr.fire(`> ${this.commandLine}\n`);
        this.activeProcess = childProcess.spawn(
            this.executable,
            this.commandArgs,
            { cwd: workspace.workspaceFolders[0].uri.fsPath }
        );

        this.activeProcess.stdout!.on('data', (stdout: Buffer) => {
            const decoded = stdout.toString();
            this._processStdout.fire(decoded);
        });

        this.activeProcess.stderr!.on('data', (stderr) => {
            const decoded = stderr.toString();
            this._processStderr.fire(decoded);
        });

        this.activeProcess.on('error', (err) => {
            this._processStderr.fire(`>>> Process '${commonName}' errored: ${err.message}\n`);
            this.updateStatus(ProcessStatusType.errored);
        });
        // Guaranteed to fire after all datastreams are closed
        this.activeProcess.on('close', (code: number | null) => {
            this._processStderr.fire(`>>> Process '${commonName}' exited with code ${code ?? 0}\n`);

            switch (code) {
            case null:
            case 0:
            case 2:
                this.updateStatus(ProcessStatusType.finished);
                break;
            default:
                this.updateStatus(ProcessStatusType.errored);
                break;
            }
        });

        this.updateStatus(ProcessStatusType.running);
    }

    public killProcess() {
        if (this.activeProcess === undefined) {
            return;
        }

        this.activeProcess.kill('SIGINT');
        this._processStderr.fire('>>> Process killed\n');

        this.updateStatus(ProcessStatusType.killed);
    }

    private updateStatus(type: ProcessStatusType) {
        switch (type) {
        case ProcessStatusType.running:
            if (this._processStatus !== ProcessStatusType.running) {
                this._processStatus = ProcessStatusType.running;
                this._processStatusChange.fire({ type: ProcessStatusType.running });
            }
            return;
        case ProcessStatusType.removed:
            // dispose() calls killProcess before dispatching this event.
            this._processStatusChange.fire({ type: ProcessStatusType.removed });
            return;
        }

        if (this._processStatus === ProcessStatusType.running) {
            this.activeProcess = undefined;
            this._processStatus = ProcessStatusType.notRunning;

            const lastLogMessage = this.lastLogMessage?.replace(/^\[.+\]/, '');
            const lastLogSeverity = this.lastLogMessage?.match(/^\[(\w+)/)?.[1];

            if (type === ProcessStatusType.errored) {
                this._processStatusChange.fire({ type, reason: lastLogMessage });
                return;
            } else if (type !== ProcessStatusType.finished) {
                this._processStatusChange.fire({ type });
                return;
            }

            // Refine the finished process status based on the last log message
            switch (lastLogSeverity) {
            case 'CRITICAL':
            case 'ERROR':
                this._processStatusChange.fire({ type: ProcessStatusType.errored, reason: lastLogMessage });
                break;
            case 'WARNING':
                this._processStatusChange.fire({ type: ProcessStatusType.warning, reason: lastLogMessage });
                break;
            case 'DEBUG':
                this._processStatusChange.fire({ type: ProcessStatusType.finished });
                break;
            default:
                this._processStatusChange.fire({ type: ProcessStatusType.finished, reason: lastLogMessage });
                break;
            }
        }
    }
}

export class ExecutorManager implements Disposable {
    public activeProcess?: ScheduledProcess;

    private executionPriority = [
        ProcessType.version,
        ProcessType.checkers,
        ProcessType.parse,
        ProcessType.log,
        ProcessType.analyze,
    ];

    /** Map of scheduled processes, indexed by its commonName.
     *
     * Priority of execution:
     * 1. version
     * 2. parse
     * 3. analyze
     * 4. all other ones
     */
    private queue: Map<string, ScheduledProcess[]> = new Map();

    /** Every line should have a newline at the end */
    private _processStdout: EventEmitter<string> = new EventEmitter();
    /**
     * Standard output of the process.
     *
     * Note that not all process output is routed through this event.
     */
    public get processStdout(): Event<string> {
        return this._processStdout.event;
    }

    /** Every line should have a newline at the end */
    private _processStderr: EventEmitter<string> = new EventEmitter();
    /**
     * Standard error of the process.
     *
     * Also contains other metadata:
     * ``> command`` for each executed command,
     * ``>>> metadata`` for other information, eg. when a process is finished.
     */
    public get processStderr(): Event<string> {
        return this._processStderr.event;
    }

    private _processStatus: ProcessStatusType = ProcessStatusType.notRunning;
    public get processStatus(): ProcessStatusType {
        return this._processStatus;
    }

    private _processStatusChange: EventEmitter<[ProcessStatus, ScheduledProcess]> = new EventEmitter();
    public get processStatusChange(): Event<[ProcessStatus, ScheduledProcess]> {
        return this._processStatusChange.event;
    }

    /** Automatically adds itself to ctx.subscriptions. */
    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this);
    }

    dispose() {
        this.clearQueue();
    }

    private updateStatus([status, process]: [ProcessStatus, ScheduledProcess]) {
        switch (status.type) {
        case ProcessStatusType.removed:
            this._processStatusChange.fire([status, process]);
            break;
        case ProcessStatusType.running:
        case ProcessStatusType.queued:
            this._processStatusChange.fire([status, process]);
            break;
        default:
            this._processStatusChange.fire([status, process]);
            process.dispose();

            if (process === this.activeProcess) {
                this.activeProcess = undefined;
                this.startNextProcess();
            } else {
                this.activeProcess?.startProcess();
            }

            break;
        }
    }

    /** Add scheduled process to the queue, based on processName.
     * 'append' (default) moves to the end, 'replace' replaces the entire queue, 'prepend' moves to the front.
     */
    public addToQueue(process: ScheduledProcess, method?: 'append' | 'replace' | 'prepend') {
        const name = process.processParameters.processType!;
        let namedQueue = this.queue.get(name) ?? [];

        // When adding the same process as the currently running one, assume that its underlying data was changed,
        // and kill the currently active process. Does not apply to the version check, as it reads no persistent data.
        if (
            this.activeProcess?.commandLine === process.commandLine &&
            this.activeProcess?.processParameters.processType !== ProcessType.version
        ) {
            this.killProcess();
        }

        // The exact same task with the exact same commandline won't be added twice
        // In Prepend mode, this means removing and re-adding to move the task to the front of the queue
        if (method === 'prepend') {
            this.removeFromQueue(process);

            // Refresh the queue, as it could have been replaced by removeFromQueue
            namedQueue = this.queue.get(name) ?? [];

        // Otherwise, keep the process in the queue as is, to preserve its position
        } else if (namedQueue.some((queueItem) => queueItem.commandLine === process.commandLine)) {
            process.dispose();
            this.startNextProcess();
            return;
        }

        switch (method) {
        case 'replace':
            for (const entry of namedQueue) {
                this.updateStatus([{ type: ProcessStatusType.removed }, entry]);
                entry.dispose();
            }

            namedQueue = [process];
            break;
        case 'prepend':
            namedQueue.unshift(process);
            break;
        case 'append':
        default:
            namedQueue.push(process);
            break;
        }

        this.updateStatus([{ type: ProcessStatusType.queued }, process]);
        this.queue.set(name, namedQueue);

        this.startNextProcess();
    }

    public removeFromQueue(process: ScheduledProcess, silent: boolean = false) {
        const name = process.processParameters.processType!;
        const namedQueue = this.queue.get(name) ?? [];

        // Tasks with the exact same commandline will be removed from queue
        if (namedQueue.some((queueItem) => queueItem.commandLine === process.commandLine)) {
            if (!silent) {
                for (const entry of namedQueue.filter((queueItem) => queueItem.commandLine === process.commandLine)) {
                    this.updateStatus([{ type: ProcessStatusType.removed }, entry]);
                    entry.dispose();
                }
            }

            this.queue.set(
                name,
                namedQueue.filter((queueItem) => queueItem.commandLine !== process.commandLine)
            );
        }
    }

    /** Clears the entire queue, or just one name. */
    public clearQueue(name?: string) {
        if (name) {
            for (const entry of this.queue.get(name) ?? []) {
                this.updateStatus([{ type: ProcessStatusType.removed }, entry]);
                entry.dispose();
            }

            this.queue.set(name, []);
        } else {
            for (const [, queue] of this.queue.entries()) {
                for (const entry of queue) {
                    this.updateStatus([{ type: ProcessStatusType.removed }, entry]);
                    entry.dispose();
                }
            }

            this.queue.clear();
        }
    }

    /**
     * Starts the next executor in the queue, according to its priority.
     */
    public startNextProcess() {
        if (this.activeProcess) {
            return;
        }

        let nextExecution: ScheduledProcess | null = null;

        // Priority running
        for (const name of this.executionPriority) {
            const namedQueue = this.queue.get(name) ?? [];

            if (namedQueue.length !== 0) {
                nextExecution = namedQueue[0];
                break;
            }
        }

        if (!nextExecution) {
            for (const [, namedQueue] of this.queue.entries()) {
                if (namedQueue.length !== 0) {
                    nextExecution = namedQueue[0];
                    break;
                }
            }
        }

        if (nextExecution === null) {
            return;
        }

        this.forceRunProcess(nextExecution);
    }

    public forceRunProcess(process: ScheduledProcess) {
        this.removeFromQueue(process, true);

        const oldProcess = this.activeProcess;

        this.activeProcess = process;
        const { forwardStdoutToLogs } = this.activeProcess.processParameters;

        // All of these listeners will be disposed when activeProcess is disposed.
        if (forwardStdoutToLogs) {
            this.activeProcess.processStdout(this._processStdout.fire, this._processStdout);
        }

        this.activeProcess.processStderr(this._processStderr.fire, this._processStderr);
        this.activeProcess.processStatusChange( (event) => this.updateStatus([event, this.activeProcess!]) );

        if (oldProcess) {
            oldProcess.killProcess();
        } else {
            this.activeProcess.startProcess();
        }
    }

    public killProcess() {
        this.activeProcess?.killProcess();
    }
}