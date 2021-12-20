import {
    Diagnostic,
    DiagnosticCollection,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    ExtensionContext,
    Location,
    Position,
    Range,
    Uri,
    languages,
    window
} from 'vscode';
import { ExtensionApi } from '../backend/api';
import { DiagnosticPathEvent, DiagnosticReport } from '../backend/types';

// TODO: implement api

export class DiagnosticRenderer {
    private _diagnosticCollection: DiagnosticCollection;
    private _lastUpdatedFiles: Uri[] = [];
    private _openedFiles: Uri[] = [];

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._diagnosticCollection = languages.createDiagnosticCollection('codechecker'));

        ExtensionApi.diagnostics.diagnosticsUpdated(this.onDiagnosticUpdated, this, ctx.subscriptions);
    }

    onDiagnosticUpdated() {
        this._openedFiles = window.visibleTextEditors.map(editor => editor.document.uri);

        if (ExtensionApi.diagnostics.selectedEntry) {
            const entryFileName = ExtensionApi.diagnostics.selectedEntry.position.file;
            this._openedFiles.push(Uri.file(entryFileName));
        }

        this.updateAllDiagnostics();
    }

    // TODO: Implement CancellableToken
    updateAllDiagnostics(): void {
        const diagnosticMap: Map<string, Diagnostic[]> = new Map();

        const makeRelatedInformation = (
            entry: DiagnosticReport | DiagnosticPathEvent,
            message: string
        ): DiagnosticRelatedInformation => {
            const file = entry.file.original_path;

            return new DiagnosticRelatedInformation(
                new Location(Uri.file(file), new Position(entry.line-1, entry.column-1)),
                message
            );
        };

        const renderDiagnosticItem = (
            entry: DiagnosticReport,
            renderedDiag: DiagnosticPathEvent,
            severity: DiagnosticSeverity,
            relatedInformation: DiagnosticRelatedInformation[]
        ): boolean => {
            const affectedFile = Uri.file(renderedDiag.file.original_path);

            // When there's no ranges, render the location
            const range = renderedDiag.range
                ? new Range(
                    renderedDiag.range.start_line-1,
                    renderedDiag.range.start_col-1,
                    renderedDiag.range.end_line-1,
                    renderedDiag.range.end_col,
                ) : new Range(
                    renderedDiag.line-1,
                    renderedDiag.column-1,
                    renderedDiag.line-1,
                    renderedDiag.column
                );

            const diagnostics = diagnosticMap.get(affectedFile.toString()) ?? [];

            const finalDiag: Diagnostic = {
                message: renderedDiag.message,
                range,
                relatedInformation,
                severity,
                source: 'CodeChecker',
            };

            diagnostics.push(finalDiag);

            diagnosticMap.set(affectedFile.toString(), diagnostics);
            return false;
        };

        const renderErrorsInFile = (diagnosticData: DiagnosticReport[]) => {
            // Render source diagnostics
            for (const entry of diagnosticData) {
                if (entry === ExtensionApi.diagnostics.selectedEntry?.diagnostic) {
                    // render later, with the reproduction path
                    continue;
                }

                const errorDiag = entry.bug_path_events.find(elem => elem.message === entry.message);

                const entryFile = entry.file.original_path;

                // File is opened
                if (errorDiag !== undefined && this._openedFiles.some(file => file.fsPath === entryFile)) {
                    renderDiagnosticItem(entry, errorDiag, DiagnosticSeverity.Error, []);
                }
            }
        };

        const renderReproductionPath = (entry: DiagnosticReport) => {
            const fullPath = [...entry.bug_path_events];

            if (fullPath.length > 0) {
                const errorDiag = fullPath.pop()!;

                // Render corresponding error
                {
                    const relatedInformation: DiagnosticRelatedInformation[] = fullPath.length > 0
                        ? [
                            makeRelatedInformation(fullPath[0], 'first reproduction step'),
                            makeRelatedInformation(
                                fullPath[fullPath.length - 1],
                                'last reproduction step'
                            )
                        ]
                        : [];

                    renderDiagnosticItem(entry, errorDiag, DiagnosticSeverity.Error, relatedInformation);
                }

                // Render reproduction path
                for (const [idx, pathItem] of fullPath.entries()) {
                    const relatedInformation: DiagnosticRelatedInformation[] = [];

                    if (idx > 0) {
                        relatedInformation.push(
                            makeRelatedInformation(fullPath[idx - 1], 'previous reproduction step')
                        );
                    }
                    if (idx < fullPath.length - 2) {
                        relatedInformation.push(
                            makeRelatedInformation(fullPath[idx + 1], 'next reproduction step')
                        );
                    }
                    relatedInformation.push(makeRelatedInformation(errorDiag, 'original report'));

                    renderDiagnosticItem(entry, pathItem, DiagnosticSeverity.Information, relatedInformation);
                }
            }
        };


        // Update "regular" errors in files
        for (const uri of this._openedFiles) {
            if (!diagnosticMap.has(uri.toString())) {
                diagnosticMap.set(uri.toString(), []);
            }
        }

        const fileErrors = ExtensionApi.diagnostics.getFileDiagnostics(
            ...this._openedFiles.filter(uri => ExtensionApi.diagnostics.dataExistsForFile(uri))
        );
        renderErrorsInFile(fileErrors);

        // Render reproduction path, if applicable
        if (ExtensionApi.diagnostics.selectedEntry !== undefined) {
            renderReproductionPath(ExtensionApi.diagnostics.selectedEntry.diagnostic);
        }

        // Freshly pushed files become _lastOpenedFiles
        const updatedFiles = [...diagnosticMap.keys()];

        // Remove "just closed" files
        for (const uri of this._lastUpdatedFiles) {
            if (!diagnosticMap.has(uri.toString())) {
                diagnosticMap.set(uri.toString(), []);
            }
        }

        for (const [file, diagnostics] of diagnosticMap) {
            const uri = Uri.parse(file);
            this._diagnosticCollection.set(uri, diagnostics);
        }

        this._lastUpdatedFiles = updatedFiles.map(entry => Uri.parse(entry));
    }
}