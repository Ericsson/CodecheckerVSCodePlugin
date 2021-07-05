import {
    ConfigurationChangeEvent,
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
import { parseMetadata } from '../parser';
import { CheckerMetadata } from '../types';

export class MetadataApi implements Disposable {
    private _metadata?: CheckerMetadata;
    public get metadata(): CheckerMetadata | undefined {
        return this._metadata;
    }

    // Path to the metadata.json file
    private metadataPath?: string;
    private metadataWatch?: FileSystemWatcher;
    private metadataWatchDisposables: Disposable[] = [];

    private _metadataSourceFiles: Map<string, string[]> = new Map();
    /** 
     * Content based on the metadata file only.  
     * Key: Source code file, value: .plist analysis files
     */
    public get sourceFiles(): ReadonlyMap<string, string[]> {
        return this._metadataSourceFiles;
    }

    /** Automatically adds itself to ctx.disposables. */
    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this);
        ctx.subscriptions.push(this._metadataUpdated = new EventEmitter());
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.backend.reloadMetadata', this.reloadMetadata, this)
        );

        workspace.onDidChangeConfiguration(this.onConfigChanged, this, ctx.subscriptions);

        this.init();
    }

    private init() {
        this.updateMetadataPath();
    }

    dispose() {
        this.disposeWatcher();
    }

    private _metadataUpdated: EventEmitter<CheckerMetadata | undefined>;
    public get metadataUpdated(): Event<CheckerMetadata | undefined> {
        return this._metadataUpdated.event;
    }

    private disposeWatcher() {
        for (const disposable of this.metadataWatchDisposables) {
            disposable.dispose();
        }

        this.metadataWatch?.dispose();
    }

    /** Reloads metadata after updating. */
    private updateMetadataPath() {
        this.disposeWatcher();

        this.metadataPath = workspace.getConfiguration('codechecker.backend').get<string>('outputFolder');

        if (this.metadataPath) {
            const workspaceFolder = workspace.workspaceFolders![0].uri.fsPath;

            // Substitute basic variables into the folder path
            this.metadataPath = this.metadataPath
                .replace(/\${workspaceRoot}/g, workspaceFolder)
                .replace(/\${workspaceFolder}/g, workspaceFolder)
                .replace(/\${cwd}/g, process.cwd())
                .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => process.env[envName] ?? '');

            this.metadataPath = Uri.joinPath(Uri.file(this.metadataPath), './metadata.json').fsPath;

            // Create watcher that triggers on updates
            this.metadataWatch = workspace.createFileSystemWatcher(this.metadataPath);

            this.metadataWatchDisposables.push(this.metadataWatch.onDidChange(this.reloadMetadata, this));
            this.metadataWatchDisposables.push(this.metadataWatch.onDidCreate(this.reloadMetadata, this));
            this.metadataWatchDisposables.push(this.metadataWatch.onDidDelete(this.reloadMetadata, this));
        }

        this.reloadMetadata()
            .catch((err) => {
                console.log(err);
                window.showErrorMessage('Unexpected error when reloading metadata\nCheck console for more details');
            });
    }

    /** Reloads associated CodeChecker metadata.
     *
     * Automatically fires in the following cases:
     *   - Extension config changed
     *   - Contents of the metadata file changed
     *   - ``codechecker.backend.reloadMetadata`` fired
     */
    async reloadMetadata(): Promise<void> {
        let precheckFailed = false;

        if (!this.metadataPath) {
            window.showWarningMessage(
                'Metadata folder has invalid path\n' +
                'Please change `CodeChecker > Backend > Output folder path` in the settings'
            );

            precheckFailed = true;
        }

        if (!workspace.workspaceFolders?.length) {
            window.showInformationMessage('CodeChecker is disabled - open a workspace to get started');

            precheckFailed = true;
        }

        if (precheckFailed) {
            this._metadata = undefined;
            this._metadataSourceFiles = new Map();
            this._metadataUpdated.fire(this._metadata);
            return;
        }

        let metadata;

        try {
            metadata = await parseMetadata(this.metadataPath!);
        } catch (err) {
            // Silently ignore File not found errors
            if (err.code !== 'FileNotFound') {
                console.error(err);
                window.showErrorMessage('Failed to read CodeChecker metadata\nCheck console for more details');
                // Not returning, because the cache needs to be cleared
            }
        }

        // TODO: Support multiple tools
        this._metadata = metadata?.tools[0];

        this._metadataSourceFiles = new Map();

        if (this._metadata) {
            // reverse keys/values, so the source file becomes the key
            for (const [analysisFile, sourceFile] of Object.entries(this._metadata.result_source_files)) {
                const entries = this._metadataSourceFiles.get(sourceFile) ?? [];
                entries.push(analysisFile);
                this._metadataSourceFiles.set(sourceFile, entries);
            }
        }

        this._metadataUpdated.fire(this._metadata);
    }

    onConfigChanged(event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration('codechecker.backend')) {
            this.updateMetadataPath();
        }
    }
}
