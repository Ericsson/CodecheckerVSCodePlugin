import { Event, EventEmitter, ExtensionContext, TextEditor, Uri, window } from 'vscode';
import { parseDiagnostics } from '../parser';
import { CheckerMetadata, DiagnosticEntry, DiagnosticFile } from '../types';
import { ExtensionApi } from '../api';

/**
 * API interface that provides Diagnostics data.  
 * Access the active instance via ExtensionApi.
 */
export class DiagnosticsApi {
    private _openedFiles: string[] = [];

    /** 
     * Content based on the contents of loaded .plist files.
     * Key: Source code file, value: .plist analysis files
     */
    private _diagnosticSourceFiles: Map<string, string[]> = new Map();

    /**
     * Loaded diagnostic files.
     * Key: .plist analysis file, value: file's contents
     */
    private _diagnosticEntries: Map<string, DiagnosticFile> = new Map();

    private _selectedEntry?: {
        file: string,
        idx: number
    };
    public get selectedEntry(): {
        position: {readonly file: string, readonly idx: number},
        diagnostic: DiagnosticEntry
    } | undefined {
        if (this._selectedEntry) {
            const activeFile = this._diagnosticEntries.get(this._selectedEntry.file);
            const diagnostic = activeFile?.diagnostics[this._selectedEntry.idx];

            if (diagnostic) {
                return {
                    position: this._selectedEntry!,
                    diagnostic
                };
            }
        }

        return undefined;
    }

    public setActiveReport(position: {file: string, idx: number} | undefined) {
        if (position) {
            const activeFile = this._diagnosticEntries.get(position.file);
            const diagnostic = activeFile?.diagnostics[position.idx];

            if (diagnostic) {
                this._selectedEntry = position;
                return;
            }
        }

        this._selectedEntry = undefined;
    }

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._diagnosticsUpdated = new EventEmitter());
        window.onDidChangeVisibleTextEditors(this.onDocumentsChanged, this, ctx.subscriptions);
        ExtensionApi.metadata.metadataUpdated(this.onMetadataUpdated, this, ctx.subscriptions);

        this.init();
    }

    private init() {
        // Initialize the currently opened windows
        this.onDocumentsChanged(window.visibleTextEditors);
    }

    /** Prefer calling ``reloadDiagnosticsAsync`` in an async context */
    reloadDiagnostics(forceReload?: boolean) {
        this.reloadDiagnosticsAsync(forceReload)
            .catch((err) => {
                console.error(err);
                window.showErrorMessage('Unexpected error when reloading diagnostics \nCheck console for more details');
            });
    }

    // TODO: Add support for cancellation tokens
    async reloadDiagnosticsAsync(forceReload?: boolean): Promise<void> {
        // TODO: Allow loading all diagnostics at once
        const plistFilesToLoad = this._openedFiles.flatMap(file => ExtensionApi.metadata.sourceFiles.get(file) || []);

        if (this._selectedEntry) {
            plistFilesToLoad.push(this._selectedEntry.file);
        }

        const loadedPlistFiles = new Set<string>();
        const newEntries = forceReload
            ? new Map()
            : new Map(this._diagnosticEntries.entries());
        const newSourceFiles = new Map();

        let plistErrors = false;

        // Load new .plist files
        for (const plistFile of plistFilesToLoad) {
            if (newEntries.has(plistFile)) {
                loadedPlistFiles.add(plistFile);
                continue;
            }

            try {
                const diagnosticEntry = await parseDiagnostics(plistFile);
                newEntries.set(plistFile, diagnosticEntry);
                loadedPlistFiles.add(plistFile);
            } catch (err) {
                switch (err.code) {
                // Silently ignore file-related errors
                case 'FileNotFound':
                case 'Unavailable':
                    break;

                default:
                    console.error(err);
                    plistErrors = true;
                }
            }
        }

        if (plistErrors) {
            window.showErrorMessage('Failed to read some CodeChecker diagnostic data\nCheck console for more details');
        }

        // Remove files that are no longer referenced
        for (const plistFile of newEntries.keys()) {
            if (!loadedPlistFiles.has(plistFile)) {
                newEntries.delete(plistFile);
            }
        }

        for (const [plistFile, parsedPlist] of newEntries.entries()) {
            for (const sourceFile of parsedPlist.files) {
                const references = newSourceFiles.get(sourceFile) || [];
                references.push(plistFile);
                newSourceFiles.set(sourceFile, references);
            }
        }

        this._selectedEntry = undefined;
        this._diagnosticEntries = newEntries;
        this._diagnosticSourceFiles = newSourceFiles;

        this._diagnosticsUpdated.fire();
    }

    dataExistsForFile(uri: Uri): boolean {
        return this._diagnosticSourceFiles.has(uri.fsPath);
    }

    /** Returns all opened diagnostics that run through the current file.
     *  Diagnostics that aren't in currently opened files are ignored.
     *  Calling getFileDiagnostics for multiple Uri-s may lead to duplicates.
     */
    getFileDiagnostics(uri: Uri): DiagnosticEntry[] {
        const diagnosticFiles = this._diagnosticSourceFiles.get(uri.fsPath) ?? [];

        return diagnosticFiles
            .flatMap(file => this._diagnosticEntries.get(file)?.diagnostics ?? []);
    }

    /** Returns a unique list of all diagnostics that run through the current files.
     *  Calling getFileDiagnostics for multiple Uri-s may lead to duplicates.
     */
    getMultipleFileDiagnostics(uris: Uri[]): DiagnosticEntry[] {
        const diagnosticSet = new Set<DiagnosticEntry>();

        for (const uri of uris) {
            for (const diagnostic of this.getFileDiagnostics(uri)) {
                diagnosticSet.add(diagnostic);
            }
        }

        return [...diagnosticSet.values()];
    }

    private _diagnosticsUpdated: EventEmitter<void>;
    public get diagnosticsUpdated(): Event<void> {
        return this._diagnosticsUpdated.event;
    }

    private onDocumentsChanged(event: TextEditor[]): void {
        this._openedFiles = event.map(editor => editor.document.uri.fsPath);

        this.reloadDiagnostics();
    }

    private onMetadataUpdated(metadata: CheckerMetadata | undefined) {
        this.reloadDiagnostics(true);
    }
}