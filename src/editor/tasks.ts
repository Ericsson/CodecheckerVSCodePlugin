import {
    CancellationToken,
    CustomExecution,
    Event,
    EventEmitter,
    ExtensionContext,
    ProviderResult,
    Pseudoterminal,
    Task,
    TaskDefinition,
    TaskProvider,
    TerminalDimensions,
    tasks,
    workspace
} from 'vscode';
import { ExtensionApi } from '../backend';


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
        this._onDidWrite.fire('Piping the console log is work-in-progress, see Output/CodeChecker tab for logs');
    }

    close(): void {
        throw new Error('Method not implemented.');
    }
}

export class AnalyzeTaskProvider implements TaskProvider<Task> {
    taskID = 'CodeChecker';

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(tasks.registerTaskProvider(this.taskID, this));
    }

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
            callback = () => ExtensionApi.executorBridge.analyzeProject();
            break;
        case ExecutorTaskType.currentFile:
            callback = () => ExtensionApi.executorBridge.analyzeCurrentFile();
            break;
        case ExecutorTaskType.selectedFiles:
            callback = () => ExtensionApi.executorBridge.selectAndAnalyzeFile(task.definition.selectedFiles);
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

export class LogTaskProvider implements TaskProvider<Task> {
    taskID = 'CodeChecker log';

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(tasks.registerTaskProvider(this.taskID, this));
    }

    provideTasks(token: CancellationToken): ProviderResult<Task[]> {
        if (workspace.workspaceFolders === undefined) {
            return [];
        }

        const tasks = [
            this.resolveTask(new Task(
                { type: this.taskID },
                workspace.workspaceFolders[0],
                'Run CodeChecker log',
                this.taskID
            ), token)!,
        ];

        return tasks;
    }

    resolveTask(task: Task, _token: CancellationToken): Task | undefined {
        const callback = () => {
            if (task.definition.customBuildCommand) {
                ExtensionApi.executorBridge.runLogCustomCommand(task.definition.customBuildCommand);
            } else {
                ExtensionApi.executorBridge.runLogDefaultCommand();
            }
        };

        const executionBody = async (_definition: TaskDefinition) => {
            const terminal = new ExecutorTaskTerminal();
            callback();
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