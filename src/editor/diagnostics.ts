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
import { DiagnosticReport } from '../backend/types';

// TODO: implement api

// Get diagnostics severity for the given CodeChecker severity.
function getDiagnosticSeverity(severity: string): DiagnosticSeverity {
    if (severity === 'STYLE') {
        return DiagnosticSeverity.Information;
    }
    return DiagnosticSeverity.Error;
}

// Get diagnostic related information for the given report.
// eslint-disable-next-line no-unused-vars
function getRelatedInformation(report: DiagnosticReport): DiagnosticRelatedInformation[] {
    const items = [];
    for (const [idx, event] of report.bug_path_events.entries()) {
        items.push(new DiagnosticRelatedInformation(
            new Location(
                Uri.file(event.file.original_path),
                new Position(event.line - 1, event.column - 1)
            ),
            `${idx + 1}. ${event.message}`
        ));
    }
    return items;
}

function getDiagnostic(report: DiagnosticReport): Diagnostic {
    const severity = report.severity || 'UNSPECIFIED';

    return {
        message: `[${severity}] ${report.message} [${report.checker_name}]`,
        range: new Range(report.line - 1, report.column - 1, report.line - 1, report.column - 1),
        // FIXME: for now it's not possible to attach custom commands to related informations. Later if it will be
        // available through the VSCode API we can show related information here.
        // relatedInformation: getRelatedInformation(report),
        severity: getDiagnosticSeverity(severity),
        source: 'CodeChecker',
    };
}

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
        const updateDiagnosticMap = (report: DiagnosticReport) => {
            const file = Uri.file(report.file.original_path);
            diagnosticMap.get(file.toString())?.push(getDiagnostic(report));
        };

        // Update "regular" errors in files
        for (const uri of this._openedFiles) {
            if (!diagnosticMap.has(uri.toString())) {
                diagnosticMap.set(uri.toString(), []);
            }
        }

        const reports = ExtensionApi.diagnostics.getFileDiagnostics(
            ...this._openedFiles.filter(uri => ExtensionApi.diagnostics.dataExistsForFile(uri))
        );

        for (const report of reports) {
            updateDiagnosticMap(report);
        }

        const selectedDiagnostic = ExtensionApi.diagnostics.selectedEntry?.diagnostic;
        if (selectedDiagnostic && !reports.includes(selectedDiagnostic)) {
            updateDiagnosticMap(selectedDiagnostic);
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