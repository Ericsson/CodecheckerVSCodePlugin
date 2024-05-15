import {
    Disposable,
    Event,
    EventEmitter,
    ExtensionContext,
    FileSystemWatcher,
    Uri,
    commands,
    window,
    workspace
} from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExtensionApi } from '../api';
import {
    getConfigAndReplaceVariables,
    parseShellArgsAndReplaceVariables,
    replaceVariables
} from '../../utils/config';
import { ProcessStatusType, ProcessType, ScheduledProcess } from '.';
import { NotificationType } from '../../editor/notifications';
import { Editor } from '../../editor';

// Structure:
//   CodeChecker analyzer version: \n {"base_package_version": "M.m.p", ...}
//
// Before CodeChecker 6.19.0 the output looked like this:
//   CodeChecker analyzer version: \n {"Base package version": "M.m.p", ...}
interface AnalyzerVersion {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'Base package version': string,

    // eslint-disable-next-line @typescript-eslint/naming-convention
    'base_package_version': string,
}

export class ExecutorBridge implements Disposable {
    /** False marks that CodeChecker was not found, or we have not checked yet */
    private checkedVersion: number[] | false = false;
    private shownVersionWarning = false;
    private versionCheckInProgress = false;

    private _versionCheckFinished: EventEmitter<number[] | false> = new EventEmitter();
    private get versionCheckFinished(): Event<number[] | false> {
        return this._versionCheckFinished.event;
    }

    private databaseWatches: FileSystemWatcher[] = [];
    private databaseEvents: Disposable[] = [];
    private compilationDatabasePaths: (string | undefined)[] = [];
    private folderSpecificCompilationDatabasePaths: {[path: string]: (string | undefined)[]} = {};

    /** Every line should have a newline at the end */
    private _bridgeMessages: EventEmitter<string> = new EventEmitter();
    /**
     * Messages emitted by the Executor bridge.
     * ``>>> metadata`` for all messages.
     */
    public get bridgeMessages(): Event<string> {
        return this._bridgeMessages.event;
    }

    private _databaseLocationChanged: EventEmitter<void> = new EventEmitter();
    public get databaseLocationChanged(): Event<void> {
        return this._databaseLocationChanged.event;
    }


    /** Automatically adds itself to ctx.subscriptions. */
    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this);

        workspace.onDidSaveTextDocument(this.analyzeOnSave, this, ctx.subscriptions);
        workspace.onDidChangeConfiguration(this.updateCompilationDatabasePaths, this, ctx.subscriptions);
        workspace.onDidChangeConfiguration((e) => {
            // Check the version only if the CodeChecker executable path is changed.
            if (!e.affectsConfiguration('codechecker.executor')) { return; }

            this.checkVersion();
        }, this, ctx.subscriptions);

        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.analyzeCurrentFile', this.analyzeCurrentFile, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.analyzeSelectedFiles', this.selectAndAnalyzeFile, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.analyzeProject', this.analyzeProject, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.runCodeCheckerLog', this.runLogDefaultCommand, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.runLogWithBuildCommand', this.runLogCustomCommand, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.clearQueue', this.stopAndClearQueue, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.stopCodeChecker', this.stopCodeChecker, this)
        );
        ctx.subscriptions.push(commands.registerCommand(
            'codechecker.executor.removeFromQueue',
            ExtensionApi.executorManager.removeFromQueue,
            ExtensionApi.executorManager
        ));
        ctx.subscriptions.push(commands.registerCommand(
            'codechecker.executor.forceRunProcess',
            ExtensionApi.executorManager.forceRunProcess,
            ExtensionApi.executorManager
        ));

        this.updateCompilationDatabasePaths();
        this.checkVersion();
    }

    dispose() {
        this.databaseEvents.forEach(watch => watch.dispose());
        this.databaseWatches.forEach(watch => watch.dispose());
    }

    public getReportsFolder(): string {
        const workspaceFolder = workspace.workspaceFolders![0].uri.fsPath;
        const ccFolder = getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? path.join(workspaceFolder, '.codechecker');
        return path.join(ccFolder, 'reports');
    }

    /**
     * `updateCompilationDatabasePaths` should be run at least once before calling this function, to initialize the
     * database paths.
     * Otherwise, it will return undefined.
     */
    public getCompileCommandsPath(workspaceFolder?: string) {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        for (const filePath of this.compilationDatabasePaths) {
            if (filePath && fs.existsSync(filePath)) {
                this._bridgeMessages.fire(`>>> Database found at path: ${filePath}\n`);
                // TODO: Cache the result and only update on eg. watch change
                return filePath;
            }
        }

        if (workspaceFolder) {
            for (const filePath of this.folderSpecificCompilationDatabasePaths[workspaceFolder]) {
                if (filePath && fs.existsSync(filePath)) {
                    this._bridgeMessages.fire(
                        `>>> Database found at path: ${filePath} for workspace: ${workspaceFolder} \n`
                    );
                    return filePath;
                }
            }
        }

        this._bridgeMessages.fire('>>> No database found in the following paths:\n');
        for (const filePath of this.compilationDatabasePaths) {
            if (filePath) {
                this._bridgeMessages.fire(`>>>   ${filePath}\n`);
            } else {
                this._bridgeMessages.fire('>>>   <no path set in settings>\n');
            }
        }

        if (workspaceFolder) {
            for (const filePath of this.folderSpecificCompilationDatabasePaths[workspaceFolder]) {
                if (filePath) {
                    this._bridgeMessages.fire(`>>>   ${filePath}\n`);
                }
            }
        } else {
            this._bridgeMessages.fire('>>>   <no workspace folder searched>\n');
        }

        return undefined;
    }

    public getAnalyzeCmdArgs(...files: Uri[]): string[] | undefined {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        const reportsFolder = this.getReportsFolder();

        const ccArgumentsSetting = workspace.getConfiguration('codechecker.executor').get<string>('arguments');

        const ccArguments = parseShellArgsAndReplaceVariables(ccArgumentsSetting ?? '');

        const ccThreads = workspace.getConfiguration('codechecker.executor').get<string>('threadCount');
        // FIXME: Add support for selecting a specific workspace folder

        const args = [
            'analyze',
            '--output', reportsFolder
        ];

        if (ccThreads) {
            args.push('-j', ccThreads);
        }

        if (this.checkedVersion < [6, 22, 0]) {
            const ccCompileCmd = this.getCompileCommandsPath(
                files.length
                    ? workspace.getWorkspaceFolder(files[0])?.uri.fsPath
                    : workspace.workspaceFolders[0].uri.fsPath
            );

            if (ccCompileCmd === undefined) {
                Editor.notificationHandler.showNotification(
                    NotificationType.warning,
                    'No compilation database found, CodeChecker not started - see logs for details'
                );
                return undefined;
            }

            args.push(ccCompileCmd);

            if (files.length) {
                args.push('--file', ...files.map((uri) => uri.fsPath));
            }
        } else {
            // For newer versions, only prefer explicit compilation databases via settings
            const ccCompileCmd = this.getCompileCommandsPath();

            if (ccCompileCmd !== undefined) {
                args.push(ccCompileCmd);

                if (files.length) {
                    args.push('--file', ...files.map((uri) => uri.fsPath));
                }
            } else if (files.length === 0) {
                // FIXME: Add a way to analyze all open workspaces, or a selected one
                this._bridgeMessages.fire('>>> Using CodeChecker\'s built-in compilation database resolver\n');
                args.push(workspace.workspaceFolders[0].uri.fsPath);
            } else if (files.length === 1) {
                this._bridgeMessages.fire('>>> Using CodeChecker\'s built-in compilation database resolver\n');
                args.push(files[0].fsPath);
            } else {
                // Fallback to autodetection
                const autodetectCompileCmd = this.getCompileCommandsPath(workspace.workspaceFolders[0].uri.fsPath);

                if (autodetectCompileCmd === undefined) {
                    Editor.notificationHandler.showNotification(
                        NotificationType.warning,
                        'No compilation database found, CodeChecker not started - ' +
                        'Analyzing multiple files at once is only supported with a compilation database'
                    );
                    return undefined;
                }

                args.push(autodetectCompileCmd);
                args.push('--file', ...files.map((uri) => uri.fsPath));
            }
        }

        args.push(...ccArguments);

        return args;
    }

    public getCheckersCmdArgs(): string[] | undefined {
        return [
            'checkers',
            '--details',
            '--output', 'json',
        ];
    }

    public getLogCmdArgs(buildCommand?: string): string[] | undefined {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        if (buildCommand === undefined) {
            buildCommand = getConfigAndReplaceVariables('codechecker.executor', 'logBuildCommand') ?? 'make';
        } else {
            buildCommand = replaceVariables(buildCommand) ?? 'make';
        }

        const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;
        const ccFolder = getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? path.join(workspaceFolder, '.codechecker');

        const logArgumentsSetting = workspace.getConfiguration('codechecker.executor').get<string>('logArguments');
        const logArguments = parseShellArgsAndReplaceVariables(logArgumentsSetting ?? '');

        // Use a predefined path as fallback here
        // TODO: Add handling for multi-root workspaces here by resolving the build command's target
        const ccCompileCmd = this.getCompileCommandsPath() ?? path.join(ccFolder, 'compile_commands.json');

        return [
            'log',
            ...logArguments,
            '--output', ccCompileCmd,
            '--build', buildCommand
        ];
    }

    public getParseCmdArgs(...files: Uri[]): string[] | undefined {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        const reportsFolder = this.getReportsFolder();

        const filePaths = files.length
            ? ['--file', ...files.map((uri) => uri.fsPath)]
            : [];

        return [
            'parse',
            reportsFolder,
            '-e', 'json',
            ...filePaths
        ];
    }

    public getVersionCmdArgs(): string[] | undefined {
        return [
            'analyzer-version',
            '--output', 'json',
        ];
    }

    private analyzeOnSave() {
        const canAnalyzeOnSave = workspace.getConfiguration('codechecker.executor').get<boolean>('runOnSave');

        // Analyze even if the comp.db doesn't exists, for multi-root workspaces
        if (!canAnalyzeOnSave) {
            return;
        }

        this.analyzeCurrentFile();
    }

    public async selectAndAnalyzeFile(...files: string[]) {
        if (files.length > 0) {
            for (const file of files) {
                await this.analyzeFile(Uri.file(file));
            }

            return;
        }

        const selectedFiles = await window.showOpenDialog({ canSelectFiles: true, canSelectMany: true });

        if (selectedFiles !== undefined) {
            for (const file of selectedFiles) {
                await this.analyzeFile(file);
            }
        }
    }

    public async analyzeCurrentFile() {
        const currentFile = window.activeTextEditor?.document.uri;

        if (currentFile !== undefined) {
            await this.analyzeFile(currentFile);
        }
    }

    public async analyzeFile(file: Uri) {
        if (!await this.checkVersion()) {
            return;
        }

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') || 'CodeChecker';
        const commandArgs = this.getAnalyzeCmdArgs(file);

        if (commandArgs === undefined) {
            return;
        }

        // FIXME: Add handling for missing comp.db. output messages of CodeChecker
        const process = new ScheduledProcess(ccPath, commandArgs, { processType: ProcessType.analyze });

        ExtensionApi.executorManager.addToQueue(process, 'prepend');
    }

    public async analyzeProject() {
        if (!await this.checkVersion()) {
            return;
        }

        // Kill the process, since the entire project is getting analyzed anyways
        this.stopAndClearQueue();

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') || 'CodeChecker';
        const commandArgs = this.getAnalyzeCmdArgs();

        if (commandArgs === undefined) {
            return;
        }

        const process = new ScheduledProcess(ccPath, commandArgs, { processType: ProcessType.analyze });

        ExtensionApi.executorManager.addToQueue(process, 'replace');
    }

    public async runLogCustomCommand(buildCommand?: string) {
        if (buildCommand === undefined) {
            buildCommand = await window.showInputBox({
                prompt: 'Enter the build command to run with CodeChecker log',
                value: getConfigAndReplaceVariables('codechecker.executor', 'logBuildCommand') ?? 'make'
            });
        }

        if (buildCommand !== undefined) {
            await this.runLog(buildCommand);
        }
    }

    public async runLogDefaultCommand() {
        if (!workspace.workspaceFolders?.length) {
            return;
        }

        await this.runLog();
    }

    public async runLog(buildCommand?: string) {
        if (!await this.checkVersion()) {
            return;
        }

        // Kill the process, since the compilation database is getting overwritten
        this.stopAndClearQueue();

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') || 'CodeChecker';
        const commandArgs = this.getLogCmdArgs(buildCommand);

        if (commandArgs === undefined) {
            return;
        }

        const process = new ScheduledProcess(ccPath, commandArgs, { processType: ProcessType.log });

        ExtensionApi.executorManager.addToQueue(process, 'replace');
    }

    public async reloadCheckerData() {
        if (!await this.checkVersion()) {
            return;
        }

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') || 'CodeChecker';
        const commandArgs = this.getCheckersCmdArgs();

        if (commandArgs === undefined) {
            return;
        }

        const process = new ScheduledProcess(ccPath, commandArgs, { processType: ProcessType.checkers });

        // TODO: Find a better way to collect full process output
        let processOutput = '';

        process.processStdout((output) => processOutput += output);

        process.processStatusChange((status) => {
            if (status.type === ProcessStatusType.finished) {
                ExtensionApi.metadata.parseCheckerData(processOutput);
            }
        });

        ExtensionApi.executorManager.addToQueue(process, 'replace');
    }

    public stopAndClearQueue() {
        ExtensionApi.executorManager.clearQueue(ProcessType.analyze);
        ExtensionApi.executorManager.clearQueue(ProcessType.log);

        const processType = ExtensionApi.executorManager.activeProcess?.processParameters.processType;

        if (processType === ProcessType.analyze || processType === ProcessType.log) {
            this.stopCodeChecker();
        }
    }

    public stopCodeChecker() {
        ExtensionApi.executorManager.killProcess();
    }

    public async parseMetadata(...files: Uri[]) {
        if (!await this.checkVersion()) {
            return;
        }

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') || 'CodeChecker';
        const commandArgs = this.getParseCmdArgs(...files);

        if (commandArgs === undefined) {
            return;
        }

        const process = new ScheduledProcess(ccPath, commandArgs, { processType: ProcessType.parse });

        // TODO: Find a better way to collect full logger output
        let processOutput = '';

        process.processStdout((output) => processOutput += output);

        process.processStatusChange((status) => {
            if (status.type === ProcessStatusType.finished) {
                ExtensionApi.diagnostics.parseDiagnosticsData(processOutput);
            }
        });

        ExtensionApi.executorManager.addToQueue(process, 'replace');
    }

    public async stopMetadataTasks() {
        ExtensionApi.executorManager.clearQueue(ProcessType.parse);

        if (ExtensionApi.executorManager.activeProcess?.processParameters.processType === ProcessType.parse) {
            ExtensionApi.executorManager.killProcess();
        }
    }

    public async checkVersion(): Promise<number[] | false> {
        return new Promise((res, _rej) => {
            if (this.checkedVersion) {
                res(this.checkedVersion);
                return;
            }

            if (this.versionCheckInProgress) {
                const disposable = this.versionCheckFinished((result) => {
                    disposable.dispose();
                    res(result);
                });
                return;
            }

            this.versionCheckInProgress = true;
            const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') || 'CodeChecker';
            const commandArgs = this.getVersionCmdArgs();

            if (commandArgs === undefined) {
                this._bridgeMessages.fire('>>> Unable to determine CodeChecker version commandline\n');

                this.checkedVersion = false;

                this.versionCheckInProgress = false;
                this._versionCheckFinished.fire(this.checkedVersion);

                res(this.checkedVersion);
                return;
            }

            const process = new ScheduledProcess(ccPath, commandArgs, { processType: ProcessType.version });

            let processOutput = '';

            process.processStdout((output) => processOutput += output);

            process.processStatusChange(async (status) => {
                switch (status.type) {
                case ProcessStatusType.running: return;
                case ProcessStatusType.finished:
                    try {
                        const data = JSON.parse(processOutput) as AnalyzerVersion;

                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        const package_version = data['base_package_version'] || data['Base package version'];

                        // Convert semver to array
                        const version = package_version.split('.').map(x => parseInt(x));

                        const minimum = [6, 18, 2];

                        if (version < minimum) {
                            this._bridgeMessages.fire(`>>> Unsupported CodeChecker version ${version}\n`);
                            this._bridgeMessages.fire(`>>> Minimum version: ${minimum}\n`);

                            this.checkedVersion = false;

                            if (!this.shownVersionWarning) {
                                this.shownVersionWarning = true;

                                const notificationText = 'The CodeChecker version you are using ' +
                                    `(${version.join('.')}) is not supported. ` +
                                    `(Minimum supported version: ${minimum.join('.')}) ` +
                                    'Please update to the latest CodeChecker version, ' +
                                    'or check the extension settings.';
                                const choices = [
                                    {
                                        title: 'Open releases',
                                        command: 'vscode.open',
                                        arguments: [Uri.parse('https://github.com/ericsson/codechecker/releases')]
                                    },
                                    {
                                        title: 'Installation guide',
                                        command: 'vscode.open',
                                        arguments: [Uri.parse('https://github.com/ericsson/codechecker#install-guide')]
                                    },
                                    {
                                        title: 'Open settings',
                                        command: 'workbench.action.openSettings',
                                        arguments: ['@ext:codechecker.codechecker']
                                    },
                                ];

                                // Only send the notification once to the sidebar
                                void Editor.notificationHandler.showNotification(
                                    NotificationType.warning,
                                    notificationText,
                                    { choices, showOnTray: false }
                                );

                                let choice;

                                // but keep open until closed on the tray
                                while (choice !== 'Close') {
                                    choice = await Editor.notificationHandler.showNotification(
                                        NotificationType.warning,
                                        notificationText,
                                        {
                                            choices: [...choices, { title: 'Close', command: '' }],
                                            showOnSidebar: false
                                        }
                                    ) ?? 'Close'; // user presses the X
                                }
                            }
                        } else {
                            this._bridgeMessages.fire(`>>> Supported CodeChecker version ${version}, enabled\n`);

                            this.checkedVersion = version;

                            if (this.shownVersionWarning) {
                                this.shownVersionWarning = false;

                                Editor.notificationHandler.showNotification(
                                    NotificationType.information,
                                    `Found supported CodeChecker version ${version.join('.')}, enabled.`,
                                    { showOnTray: false }
                                );
                            }
                        }
                    } catch (err) {
                        this._bridgeMessages.fire(`>>> Internal error while checking version: ${err}\n`);
                        this.checkedVersion = false;

                        Editor.notificationHandler.showNotification(
                            NotificationType.error,
                            'CodeChecker: Internal error while checking version - see logs for details'
                        );
                    }

                    break;
                case ProcessStatusType.removed:
                    if (this.checkedVersion === undefined) {
                        this.checkedVersion = false;
                    }

                    break;
                default:
                    this._bridgeMessages.fire('>>> CodeChecker error while checking version\n');
                    this.checkedVersion = false;

                    if (!this.shownVersionWarning) {
                        this.shownVersionWarning = true;

                        const notificationText = 'CodeChecker executable not found. ' +
                            'Download CodeChecker, or check the extension settings.';
                        const choices = [
                            {
                                title: 'Open releases',
                                command: 'vscode.open',
                                arguments: [Uri.parse('https://github.com/ericsson/codechecker/releases')]
                            },
                            {
                                title: 'Installation guide',
                                command: 'vscode.open',
                                arguments: [Uri.parse('https://github.com/ericsson/codechecker#install-guide')]
                            },
                            {
                                title: 'Open settings',
                                command: 'workbench.action.openSettings',
                                arguments: ['@ext:codechecker.codechecker']
                            }
                        ];

                        // Only send the notification once to the sidebar
                        void Editor.notificationHandler.showNotification(
                            NotificationType.warning,
                            notificationText,
                            { choices, showOnTray: false }
                        );

                        let choice;

                        // but keep open until closed on the tray
                        while (choice !== 'Close') {
                            choice = await Editor.notificationHandler.showNotification(
                                NotificationType.warning,
                                notificationText,
                                {
                                    choices: [...choices, { title: 'Close', command: '' }],
                                    showOnSidebar: false
                                }
                            ) ?? 'Close'; // user presses the X
                        }
                    }
                }

                this.versionCheckInProgress = false;
                this._versionCheckFinished.fire(this.checkedVersion);

                res(this.checkedVersion);
            });

            ExtensionApi.executorManager.addToQueue(process, 'replace');
        });
    }

    private updateCompilationDatabasePaths() {
        if (!workspace.workspaceFolders?.length) {
            return;
        }

        this.compilationDatabasePaths = [
            getConfigAndReplaceVariables('codechecker.backend', 'compilationDatabasePath')
        ];

        this.folderSpecificCompilationDatabasePaths = {};

        for (const folder of workspace.workspaceFolders) {
            const folderPath = folder.uri.fsPath;

            // It will try to find compilation databases in these directories automatically. The order is important
            // because the first finding will be used.
            const dbRootDirPaths = [
                path.join(folderPath, '.codechecker'),
                folderPath,
                path.join(folderPath, 'build')
            ];
            const dbFileNames = ['compile_commands.json', 'compile_cmd.json'];

            this.folderSpecificCompilationDatabasePaths[folderPath] = [
                ...dbRootDirPaths.reduce((dbFilePaths: string[], dirName: string) => {
                    dbFileNames.forEach(fileName => dbFilePaths.push(path.join(dirName, fileName)));
                    return dbFilePaths;
                }, [])
            ];
        }


        this.databaseEvents.forEach(watch => watch.dispose());
        this.databaseWatches.forEach(watch => watch.dispose());

        this.databaseWatches = this.compilationDatabasePaths
            .filter(x => x !== undefined)
            .map(path => workspace.createFileSystemWatcher(path!));

        this.databaseWatches.push(...Object.values(this.folderSpecificCompilationDatabasePaths)
            .reduce((fileSystemWatchers, paths) => {
                paths.filter(x => x !== undefined)
                    .forEach(path => fileSystemWatchers.push(workspace.createFileSystemWatcher(path!)));
                return fileSystemWatchers;
            }, [] as FileSystemWatcher[])
        );

        for (const watch of this.databaseWatches) {
            this.databaseEvents.push(watch.onDidCreate(() => this._databaseLocationChanged.fire()));
            this.databaseEvents.push(watch.onDidDelete(() => this._databaseLocationChanged.fire()));
        }

        this._databaseLocationChanged.fire();
    }
}