import {
    Diagnostic,
    DiagnosticCollection,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    ExtensionContext,
    Location,
    Position,
    Range,
    ThemeColor,
    Uri,
    languages,
    window
} from 'vscode';
import { ExtensionApi } from '../backend/api';
import { DiagnosticReport } from '../backend/types';

// Decoration type for highlighting report step positions.
const reportStepDecorationType = window.createTextEditorDecorationType({
    backgroundColor: new ThemeColor('codechecker.highlightBugReportPoints.background'),
    borderColor: new ThemeColor('codechecker.highlightBugReportPoints.border'),
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '2px',
});

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

// This function will return a range for the given report.
function getRange(report: DiagnosticReport) {
    const startLine = report.line - 1;
    const endLine = startLine;
    const startColumn = report.column - 1;
    let endColumn = startColumn;

    // Get better range position from the visible text editors if there is any.
    const editor = window.visibleTextEditors.find(e => e.document.uri.fsPath === report.file.original_path);
    if (editor) {
        const range = editor.document.getWordRangeAtPosition(new Position(startLine, startColumn));
        if (range?.isSingleLine && startColumn < range?.end.character) {
            endColumn = range.end.character;
        }
    }

    return new Range(startLine, report.column - 1, endLine, endColumn);
}

function getDiagnostic(report: DiagnosticReport): Diagnostic {
    const severity = report.severity || 'UNSPECIFIED';

    return {
        message: `[${severity}] ${report.message} [${report.checker_name}]`,
        range: getRange(report),
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
        this.highlightActiveBugStep();
    }

    highlightActiveBugStep() {
        const editor = window.activeTextEditor;
        if (!editor) {
            return;
        }

        const diagnostic = ExtensionApi.diagnostics.selectedEntry?.diagnostic;
        if (!diagnostic) {
            // Hide report step decorations when no report step is selected.
            editor.setDecorations(reportStepDecorationType, []);
            return;
        }

        // Decorate report steps.
        const ranges = diagnostic.bug_path_positions.reduce((prev: Range[], curr) => {
            if (curr.file.original_path === editor.document.uri.fsPath) {
                const range = curr.range;
                prev.push(new Range(
                    new Position(range.start_line - 1, range.start_col - 1),
                    new Position(range.end_line - 1, range.end_col)
                ));
            }
            return prev;
        }, []);
        editor.setDecorations(reportStepDecorationType, ranges);
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