import { Event, EventEmitter, ExtensionContext, TextEditor, Uri, window } from 'vscode';
import { parseDiagnostics } from '../parser';
import { CheckerMetadata, DiagnosticReport } from '../types';
import { ExtensionApi } from '../api';

/**
 * API interface that provides Diagnostics data.
 * Access the active instance via ExtensionApi.
 */
export class DiagnosticsApi {
    private _openedFiles: string[] = [];

    /**
     * Loaded diagnostic entries.
     * Key: Full path to file, value: reports related to file
     */
    private _diagnosticEntries: Map<string, DiagnosticReport[]> = new Map();

    private _selectedEntry?: {
        file: string,
        idx: number
    };
    public get selectedEntry(): {
        position: {readonly file: string, readonly idx: number},
        diagnostic: DiagnosticReport
    } | undefined {
        if (this._selectedEntry) {
            const activeFile = this.getFileDiagnostics(Uri.file(this._selectedEntry.file)) ?? [];
            const diagnostic = activeFile[this._selectedEntry.idx];

            if (diagnostic) {
                return {
                    position: this._selectedEntry,
                    diagnostic
                };
            }
        }

        return undefined;
    }

    public setSelectedEntry(position?: {file: string, idx: number}) {
        if (position) {
            const activeFile = this.getFileDiagnostics(Uri.file(position.file)) ?? [];
            const diagnostic = activeFile[position.idx];

            if (diagnostic) {
                this._selectedEntry = position;
                this._diagnosticsUpdated.fire();
                return;
            }
        }

        this._selectedEntry = undefined;
        this._diagnosticsUpdated.fire();
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

    public reloadDiagnostics() {
        // TODO: Allow loading all diagnostics at once
        const filesToLoad = this._openedFiles;

        if (this._selectedEntry) {
            filesToLoad.push(this._selectedEntry.file);
        }

        ExtensionApi.executorBridge.parseMetadata(...filesToLoad.map(file => Uri.file(file)));
    }

    // Parses diagnostic data from 'CodeChecker parse'.
    public parseDiagnosticsData(data: string) {
        let result;
        try {
            result = parseDiagnostics(data);
        } catch (err: any) {
            console.error('Failed to read CodeChecker data');
            console.error(err);
            window.showErrorMessage(
                'Failed to read some CodeChecker diagnostic data\nCheck console for more details'
            );
            return;
        }

        const newEntries = new Map<string, DiagnosticReport[]>();

        for (const report of result.reports) {
            const file = report.file.original_path;
            const entry = newEntries.get(file) ?? [];
            entry.push(report);
            newEntries.set(file, entry);
        }

        if (this._selectedEntry) {
            const originalSelected = this._diagnosticEntries.get(this._selectedEntry.file)!;
            const newSelected = newEntries.get(this._selectedEntry.file);

            // Assume that if the number of errors is the same, the entries haven't changed
            if (originalSelected.length !== newSelected?.length) {
                this._selectedEntry = undefined;
            }
        }
        this._diagnosticEntries = newEntries;

        this._diagnosticsUpdated.fire();
    }

    dataExistsForFile(uri: Uri): boolean {
        return this._diagnosticEntries.has(uri.fsPath);
    }

    /** Returns all opened diagnostics that run through the selected files.
     *  Diagnostics that aren't in currently opened files are ignored.
     *  Calling getFileDiagnostics multiple times on different files may lead to duplicates.
     */
    getFileDiagnostics(...uris: Uri[]): DiagnosticReport[] {
        const diagnosticSet = new Set<DiagnosticReport>();

        for (const uri of uris) {
            for (const diagnostic of this._diagnosticEntries.get(uri.fsPath) ?? []) {
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

    private onMetadataUpdated(_metadata: CheckerMetadata | undefined) {
        this.reloadDiagnostics();
    }
}