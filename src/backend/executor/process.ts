import * as child_process from 'child_process';
import * as os from 'os';
import { quote } from 'shell-quote';
import { Disposable, Event, EventEmitter, ExtensionContext, workspace } from 'vscode';

export enum ProcessStatus {
    notRunning,
    running,
    killed,
    finished,
    errored,
    // When overwritten in the queue with 'replace', or cleared
    removed,
}

export enum ProcessType {
    analyze = 'CodeChecker analyze',
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

    private activeProcess?: child_process.ChildProcess;

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

    private _processStatus: ProcessStatus = ProcessStatus.notRunning;
    public get processStatus(): ProcessStatus {
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
        const forwardDefaults: string[] = [ ProcessType.parse ];

        if (this.processParameters.forwardStdoutToLogs === undefined) {
            this.processParameters.forwardStdoutToLogs = !forwardDefaults.includes(processType);
        }
    }

    dispose() {
        if (this.activeProcess) {
            this.activeProcess.kill();
        }

        this._processStatusChange.fire(ProcessStatus.removed);

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
        this.activeProcess = child_process.spawn(this.executable, this.commandArgs);

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
            this.updateStatus(ProcessStatus.errored);
        });
        // Guaranteed to fire after all datastreams are closed
        this.activeProcess.on('close', (code: number | null) => {
            this._processStderr.fire(`>>> Process '${commonName}' exited with code ${code ?? 0}\n`);

            switch (code) {
            case null:
            case 0:
            case 2:
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
        this._processStderr.fire('>>> Process killed\n');

        this.updateStatus(ProcessStatus.killed);
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
}

export class ExecutorManager implements Disposable {
    public activeProcess?: ScheduledProcess;

    private executionPriority = [
        ProcessType.version,
        ProcessType.parse,
        ProcessType.analyze
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

    private _processStatus: ProcessStatus = ProcessStatus.notRunning;
    public get processStatus(): ProcessStatus {
        return this._processStatus;
    }

    private _processStatusChange: EventEmitter<ProcessStatus> = new EventEmitter();
    public get processStatusChange(): Event<ProcessStatus> {
        return this._processStatusChange.event;
    }

    /** Automatically adds itself to ctx.subscriptions. */
    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this);
    }

    dispose() {
        this.clearQueue();
    }

    private updateStatus(status: ProcessStatus) {
        switch (status) {
        case ProcessStatus.removed:
            this._processStatusChange.fire(status);
            break;
        case ProcessStatus.running:
            this._processStatusChange.fire(ProcessStatus.running);
            break;
        default:
            this._processStatusChange.fire(status);
            this.activeProcess?.dispose();
            this.activeProcess = undefined;
            this.startNextProcess();
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
        // and kill the currently active process
        if (this.activeProcess?.commandLine === process.commandLine) {
            this.killProcess();
        }

        // The exact same task with the exact same commandline won't be added twice
        if (namedQueue.some((queueItem) => queueItem.commandLine === process.commandLine)) {
            // In Prepend mode, this means removing and re-adding to move the task to the front of the queue
            if (method === 'prepend') {
                namedQueue = namedQueue.filter((queueItem) => queueItem.commandLine !== process.commandLine);
            } else {
                // Otherwise, keep the process in the queue as is, to preserve its position
                this.startNextProcess();
                return;
            }
        }

        switch (method) {
        case 'replace':
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

        this.queue.set(name, namedQueue);

        this.startNextProcess();
    }

    /** Clears the entire queue, or just one name. */
    public clearQueue(name?: string) {
        if (name) {
            this.queue.set(name, []);
        } else {
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
                this.queue.set(name, namedQueue.slice(1));
                break;
            }
        }

        if (!nextExecution) {
            for (const [name, namedQueue] of this.queue.entries()) {
                if (namedQueue.length !== 0) {
                    nextExecution = namedQueue[0];
                    this.queue.set(name, namedQueue.slice(1));
                    break;
                }
            }
        }

        if (nextExecution === null) {
            return;
        }

        this.activeProcess = nextExecution;
        const { forwardStdoutToLogs } = this.activeProcess.processParameters;

        // All of these listeners will be disposed when activeProcess is disposed.
        if (forwardStdoutToLogs) {
            this.activeProcess.processStdout(this._processStdout.fire, this._processStdout);
        }

        this.activeProcess.processStderr(this._processStderr.fire, this._processStderr);
        this.activeProcess.processStatusChange(this.updateStatus, this);

        this.activeProcess.startProcess();
    }

    public killProcess() {
        this.activeProcess?.killProcess();
    }
}