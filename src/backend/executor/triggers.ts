import {
    CancellationToken,
    CustomExecution,
    Disposable,
    Event,
    EventEmitter,
    ExtensionContext,
    ProviderResult,
    Pseudoterminal,
    Task,
    TaskDefinition,
    TaskProvider,
    TerminalDimensions,
    Uri,
    commands,
    tasks,
    window,
    workspace
} from 'vscode';
import { ExtensionApi } from '../api';
import { ProcessStatus } from './process';

enum ExecutorTaskType {
    project = 'project',
    currentFile = 'currentFile',
    selectedFiles = 'selectedFiles'
}

class ExecutorTaskTerminal implements Pseudoterminal {
    private _onDidWrite = new EventEmitter<string>();
    onDidWrite: Event<string> = this._onDidWrite.event;

    private _onDidClose = new EventEmitter<void>();
    onDidClose?: Event<void> = this._onDidClose.event;

    open(_initialDimensions?: TerminalDimensions): void {
        this._onDidWrite.fire('Piping the console log is work-in-progress');
    }

    close(): void {
        throw new Error('Method not implemented.');
    }
}

class ExecutorTaskProvider implements TaskProvider<Task> {
    taskID = 'CodeChecker';

    constructor(private manager: ExecutorManager) {}

    provideTasks(token: CancellationToken): ProviderResult<Task[]> {
        if (workspace.workspaceFolders === undefined) {
            return [];
        }

        const tasks = [
            this.resolveTask(new Task(
                { type: this.taskID, taskType: ExecutorTaskType.project as string },
                workspace.workspaceFolders[0],
                'Analyze project',
                this.taskID
            ), token)!,
            this.resolveTask(new Task(
                { type: this.taskID, taskType: ExecutorTaskType.currentFile as string },
                workspace.workspaceFolders[0],
                'Analyze current file',
                this.taskID
            ), token)!,
            this.resolveTask(new Task(
                { type: this.taskID, taskType: ExecutorTaskType.selectedFiles as string },
                workspace.workspaceFolders[0],
                'Analyze selected files...',
                this.taskID
            ), token)!,
        ].filter(x => x !== undefined);

        return tasks;
    }

    resolveTask(task: Task, _token: CancellationToken): Task | undefined {
        const taskType: ExecutorTaskType = task.definition.taskType;

        let callback: (() => void) | undefined;

        switch (taskType) {
        case ExecutorTaskType.project:
            callback = () => this.manager.analyzeProject();
            break;
        case ExecutorTaskType.currentFile:
            callback = () => this.manager.analyzeCurrentFile();
            break;
        case ExecutorTaskType.selectedFiles:
            callback = () => this.manager.selectAndAnalyzeFile(task.definition.selectedFiles);
            break;
        default:
            break;
        }

        if (callback === undefined) {
            return undefined;
        }

        const executionBody = async (_definition: TaskDefinition) => {
            const terminal = new ExecutorTaskTerminal();
            callback!();
            return terminal;
        };

        return new Task(
            task.definition,
            task.scope ?? workspace.workspaceFolders![0],
            task.name,
            task.source,
            new CustomExecution(executionBody)
        );
    }
}

export class ExecutorManager implements Disposable {
    private taskProvider: ExecutorTaskProvider;

    private fileQueue: Uri[] = [];
    private activeEvent?: Disposable;

    constructor(ctx: ExtensionContext) {
        workspace.onDidSaveTextDocument(this.analyzeOnSave, this, ctx.subscriptions);

        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.analyzeCurrentFile', this.analyzeCurrentFile, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.analyzeSelectedFiles', this.selectAndAnalyzeFile, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.analyzeProject', this.analyzeProject, this)
        );
        ctx.subscriptions.push(commands.registerCommand('codechecker.executor.stopAnalysis', this.stopAnalysis, this));

        this.taskProvider = new ExecutorTaskProvider(this);
        ctx.subscriptions.push(tasks.registerTaskProvider(this.taskProvider.taskID, this.taskProvider));
    }

    dispose() {
        if (this.activeEvent !== undefined) {
            this.activeEvent.dispose();
        }
    }

    analyzeOnSave() {
        const canAnalyzeOnSave = workspace.getConfiguration('codechecker.executor').get<boolean>('runOnSave');
        // Fail silently if there's no compile_commands.json
        const ccExists = ExtensionApi.executorProcess.getCompileCommandsPath() !== undefined;

        if (!canAnalyzeOnSave || !ccExists) {
            return;
        }

        this.analyzeCurrentFile();
    }

    async selectAndAnalyzeFile(...files: string[]) {
        if (files.length > 0) {
            for (const file of files) {
                this.analyzeFile(file);
            }

            return;
        }

        const selectedFiles = await window.showOpenDialog({ canSelectFiles: true, canSelectMany: true });

        if (selectedFiles !== undefined) {
            for (const file of selectedFiles) {
                this.analyzeFile(file.fsPath);
            }
        }
    }

    analyzeCurrentFile() {
        const currentFile = window.activeTextEditor?.document.uri.fsPath;

        if (currentFile !== undefined) {
            this.analyzeFile(currentFile);
        }
    }

    analyzeFile(file: string) {
        const uri = Uri.file(file);
        this.fileQueue = this.fileQueue.filter((f) => f.fsPath !== uri.fsPath);
        this.fileQueue.push(uri);

        if (ExtensionApi.executorProcess.processStatus === ProcessStatus.running) {
            // Queue up the process, and add the callback if it does not exist
            if (this.activeEvent === undefined) {
                this.activeEvent = ExtensionApi.executorProcess.processStatusChange(
                    this.executeQueue,
                    this
                );
            }
            return;
        }

        this.executeQueue();
    }

    analyzeProject() {
        // Kill the process, since the entire project is getting analyzed anyways
        this.stopAnalysis();

        ExtensionApi.executorProcess.startProcess();
    }

    stopAnalysis() {
        this.fileQueue = [];

        if (ExtensionApi.executorProcess.processStatus === ProcessStatus.running) {
            ExtensionApi.executorProcess.killProcess();
        }
    }

    private executeQueue(_status?: ProcessStatus) {
        // Purge the event if there is nothing to execute
        if (this.fileQueue.length === 0) {
            this.activeEvent?.dispose();
            this.activeEvent = undefined;
            return;
        }

        if (ExtensionApi.executorProcess.processStatus === ProcessStatus.running) {
            return;
        }

        // Only start the latest, and purge the queue
        const latestFile = this.fileQueue.pop();
        this.fileQueue = [];

        if (latestFile) {
            ExtensionApi.executorProcess.startProcess(latestFile);
        }

        // And then finally, purge the event
        this.activeEvent?.dispose();
        this.activeEvent = undefined;
    }
}