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
import { getConfigAndReplaceVariables } from '../../utils/config';
import { ProcessStatus, ProcessType, ScheduledProcess } from '.';

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
    private versionChecked = false;
    private shownVersionWarning = false;

    private databaseWatches: FileSystemWatcher[] = [];
    private databaseEvents: Disposable[] = [];
    private compilationDatabasePaths: (string | undefined)[] = [];

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
        ctx.subscriptions.push(commands.registerCommand('codechecker.executor.stopAnalysis', this.stopAnalysis, this));

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
    public getCompileCommandsPath() {
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

        this._bridgeMessages.fire('>>> No database found in the following paths:\n');
        for (const filePath of this.compilationDatabasePaths) {
            if (filePath) {
                this._bridgeMessages.fire(`>>>   ${filePath}\n`);
            } else {
                this._bridgeMessages.fire('>>>   <no path set in settings>\n');
            }
        }

        return undefined;
    }

    public getAnalyzeCmdLine(...files: Uri[]): string | undefined {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        // TODO: Refactor for less code repetition across functions
        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath')
            ?? 'CodeChecker';
        const reportsFolder = this.getReportsFolder();
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
            `--output "${reportsFolder}"`,
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

    public getParseCmdLine(...files: Uri[]): string | undefined {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath') ?? 'CodeChecker';
        const reportsFolder = this.getReportsFolder();

        const filePaths = files.length
            ? `--file ${files.map((uri) => `"${uri.fsPath}"`).join(' ')}`
            : '';

        return [
            `${ccPath} parse`,
            `${reportsFolder}`,
            '-e json',
            filePaths
        ].join(' ');
    }

    public getVersionCmdLine(): string | undefined {
        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath')
            ?? 'CodeChecker';

        return [
            `${ccPath} analyzer-version`,
            '--output "json"',
        ].join(' ');
    }

    private analyzeOnSave() {
        const canAnalyzeOnSave = workspace.getConfiguration('codechecker.executor').get<boolean>('runOnSave');
        // Fail silently if there's no compile_commands.json
        const ccExists = this.getCompileCommandsPath() !== undefined;

        if (!canAnalyzeOnSave || !ccExists) {
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

        const commandLine = this.getAnalyzeCmdLine(file);

        if (commandLine === undefined) {
            return;
        }

        const process = new ScheduledProcess(commandLine, { processType: ProcessType.analyze });

        ExtensionApi.executorManager.addToQueue(process, 'prepend');
    }

    public async analyzeProject() {
        if (!await this.checkVersion()) {
            return;
        }

        // Kill the process, since the entire project is getting analyzed anyways
        this.stopAnalysis();

        const commandLine = this.getAnalyzeCmdLine();

        if (commandLine === undefined) {
            return;
        }

        const process = new ScheduledProcess(commandLine, { processType: ProcessType.analyze });

        ExtensionApi.executorManager.addToQueue(process, 'replace');
    }

    public stopAnalysis() {
        ExtensionApi.executorManager.clearQueue(ProcessType.analyze);

        if (ExtensionApi.executorManager.activeProcess?.processParameters.processType === ProcessType.analyze) {
            ExtensionApi.executorManager.killProcess();
        }
    }

    public async parseMetadata(...files: Uri[]) {
        if (!await this.checkVersion()) {
            return;
        }

        const commandLine = this.getParseCmdLine(...files);

        if (commandLine === undefined) {
            return;
        }

        const process = new ScheduledProcess(commandLine, { processType: ProcessType.parse });

        // TODO: Find a better way to collect full logger output
        let processOutput = '';

        process.processStdout((output) => processOutput += output);

        process.processStatusChange((status) => {
            if (status === ProcessStatus.finished) {
                ExtensionApi.diagnostics.parseDiagnosticsData(processOutput);
            }
        });

        ExtensionApi.executorManager.addToQueue(process, 'replace');
    }

    public async checkVersion(): Promise<boolean> {
        return new Promise((res, _rej) => {
            if (this.versionChecked) {
                res(this.versionChecked);
                return;
            }

            const commandLine = this.getVersionCmdLine();

            if (commandLine === undefined) {
                this._bridgeMessages.fire('>>> Unable to determine CodeChecker version commandline\n');

                this.versionChecked = false;
                return;
            }

            const process = new ScheduledProcess(commandLine, { processType: ProcessType.version });

            let processOutput = '';

            process.processStdout((output) => processOutput += output);

            process.processStatusChange(async (status) => {
                switch (status) {
                case ProcessStatus.running: return;
                case ProcessStatus.finished:
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

                            this.versionChecked = false;

                            if (!this.shownVersionWarning) {
                                this.shownVersionWarning = true;
                                let choice;

                                while (choice !== 'Close') {
                                    choice = await window.showWarningMessage(
                                        `The CodeChecker version you are using (${version.join('.')}) ` +
                                            `is not supported. (Minimum supported version: ${minimum.join('.')}) ` +
                                            'Please update to the latest CodeChecker version, ' +
                                            'or check the extension settings.',
                                        'Open releases',
                                        'Installation guide',
                                        'Open settings',
                                        'Close'
                                    );

                                    switch (choice) {
                                    case 'Open releases':
                                        commands.executeCommand(
                                            'vscode.open',
                                            Uri.parse('https://github.com/ericsson/codechecker/releases')
                                        );
                                        break;
                                    case 'Installation guide':
                                        commands.executeCommand(
                                            'vscode.open',
                                            Uri.parse('https://github.com/ericsson/codechecker#install-guide')
                                        );
                                        break;
                                    case 'Open settings':
                                        commands.executeCommand(
                                            'workbench.action.openSettings',
                                            '@ext:codechecker.codechecker'
                                        );
                                        break;
                                    default:
                                        choice = 'Close';
                                        break;
                                    }
                                }
                            }
                        } else {
                            this._bridgeMessages.fire(`>>> Supported CodeChecker version ${version}, enabled\n`);

                            this.versionChecked = true;

                            if (this.shownVersionWarning) {
                                this.shownVersionWarning = false;

                                window.showInformationMessage(
                                    `Found supported CodeChecker version ${version.join('.')}, enabled.`
                                );
                            }
                        }
                    } catch (err) {
                        this._bridgeMessages.fire(`>>> Internal error while checking version: ${err}\n`);
                        this.versionChecked = false;

                        window.showErrorMessage(
                            'CodeChecker: Internal error while checking version - see logs for details'
                        );
                    }

                    break;
                case ProcessStatus.removed:
                    if (this.versionChecked === undefined) {
                        this.versionChecked = false;
                    }

                    break;
                default:
                    this._bridgeMessages.fire('>>> CodeChecker error while checking version\n');
                    this.versionChecked = false;

                    if (!this.shownVersionWarning) {
                        this.shownVersionWarning = true;
                        let choice;

                        while (choice !== 'Close') {
                            choice = await window.showWarningMessage(
                                'CodeChecker executable not found. ' +
                                    'Download CodeChecker, or check the extension settings.',
                                'Open releases',
                                'Installation guide',
                                'Open settings',
                                'Close'
                            );

                            switch (choice) {
                            case 'Open releases':
                                commands.executeCommand(
                                    'vscode.open',
                                    Uri.parse('https://github.com/ericsson/codechecker/releases')
                                );
                                break;
                            case 'Installation guide':
                                commands.executeCommand(
                                    'vscode.open',
                                    Uri.parse('https://github.com/ericsson/codechecker#install-guide')
                                );
                                break;
                            case 'Open settings':
                                commands.executeCommand(
                                    'workbench.action.openSettings',
                                    '@ext:codechecker.codechecker'
                                );
                                break;
                            default:
                                choice = 'Close';
                                break;
                            }
                        }
                    }
                }

                res(this.versionChecked);
            });

            ExtensionApi.executorManager.addToQueue(process, 'replace');
        });
    }

    private updateCompilationDatabasePaths() {
        if (!workspace.workspaceFolders?.length) {
            return;
        }

        this.versionChecked = false;

        const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

        const ccFolder = getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? path.join(workspaceFolder, '.codechecker');

        // It will try to find compilation databases in these directories automatically. The order is important because
        // the first finding will be used.
        const dbRootDirPaths = [ccFolder, workspaceFolder, path.join(workspaceFolder, 'build')];
        const dbFileNames = ['compile_commands.json', 'compile_cmd.json'];

        this.compilationDatabasePaths = [
            getConfigAndReplaceVariables('codechecker.backend', 'compilationDatabasePath'),
            ...dbRootDirPaths.reduce((dbFilePaths: string[], dirName: string) => {
                dbFileNames.forEach(fileName => dbFilePaths.push(path.join(dirName, fileName)));
                return dbFilePaths;
            }, [])
        ];

        this.databaseEvents.forEach(watch => watch.dispose());
        this.databaseWatches.forEach(watch => watch.dispose());

        this.databaseWatches = this.compilationDatabasePaths
            .filter(x => x !== undefined)
            .map(path => workspace.createFileSystemWatcher(path!));

        for (const watch of this.databaseWatches) {
            this.databaseEvents.push(watch.onDidCreate(() => this._databaseLocationChanged.fire()));
            this.databaseEvents.push(watch.onDidDelete(() => this._databaseLocationChanged.fire()));
        }

        this._databaseLocationChanged.fire();
    }
}