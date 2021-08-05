import { ExtensionContext, Position, Range, Uri, commands, window } from 'vscode';
import { ExtensionApi } from '../backend/api';
import { AnalysisPathEvent, AnalysisPathKind, DiagnosticEntry } from '../backend/types';

export class NavigationHandler {
    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.toggleSteps', this.toggleSteps, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.jumpToReport', this.jumpToReport, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.jumpToStep', this.jumpToStep, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.nextStep', this.nextStep, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.previousStep', this.previousStep, this));
    }

    toggleSteps(file: Uri | string, diagnosticIdx: number, targetState?: boolean) {
        if (typeof file === 'string') {
            file = Uri.file(file);
        }

        const diagnostic = ExtensionApi.diagnostics.getFileDiagnostics(file)[diagnosticIdx] ?? [];

        // If the target state isn't given, replace the active report, or clear if it's the same
        targetState = targetState ?? (diagnostic !== ExtensionApi.diagnostics.selectedEntry?.diagnostic);

        if (targetState) {
            ExtensionApi.diagnostics.setSelectedEntry({ file: file.fsPath, idx: diagnosticIdx });
        } else {
            ExtensionApi.diagnostics.setSelectedEntry();
        }
    }

    jumpToReport(file: Uri | string, diagnosticIndex: number) {
        if (typeof file === 'string') {
            file = Uri.file(file);
        }

        const diagnostic = ExtensionApi.diagnostics.getFileDiagnostics(file)[diagnosticIndex];
        const location = diagnostic?.location;
        const targetFile = location !== undefined ? Uri.file(diagnostic.files[location.file]) : file;

        window.showTextDocument(targetFile, {
            selection: location !== undefined ? new Range(
                location.line - 1,
                location.col - 1,
                location.line - 1,
                location.col - 1
            ) : undefined
        });

        if (diagnostic === undefined) {
            window.showInformationMessage('Unable to find specified bug, opened its file instead');
        }
    }

    jumpToStep(file: Uri | string, bugIndex: number, stepIndex: number) {
        if (typeof file === 'string') {
            file = Uri.file(file);
        }

        const diagnostic: DiagnosticEntry | undefined = ExtensionApi.diagnostics.getFileDiagnostics(file)[bugIndex];
        const diagnosticLocation = diagnostic?.location;

        const step = diagnostic?.path
            .filter(elem => elem.kind === AnalysisPathKind.Event)[stepIndex] as AnalysisPathEvent;
        const stepLocation = step?.location ?? diagnosticLocation;

        const targetFile = stepLocation !== undefined ? Uri.file(diagnostic.files[stepLocation.file])
            : diagnosticLocation !== undefined ? Uri.file(diagnostic.files[diagnosticLocation.file])
                : file;

        window.showTextDocument(targetFile, {
            selection: stepLocation !== undefined ? new Range(
                stepLocation.line - 1,
                stepLocation.col - 1,
                stepLocation.line - 1,
                stepLocation.col - 1
            ) : undefined
        });

        if (diagnostic === undefined) {
            window.showInformationMessage('Unable to find specified report, opened its file instead');
        } else if (step === undefined) {
            window.showInformationMessage('Unable to find specified reproduction step, opened the report instead');
        }
    }

    getStepIndexUnderCursor(which: 'first' | 'last'): number | null {
        if (window.activeTextEditor === undefined || ExtensionApi.diagnostics.selectedEntry === undefined) {
            return null;
        }

        const cursor = window.activeTextEditor.selection.anchor;

        const entry = ExtensionApi.diagnostics.selectedEntry.diagnostic;
        const reprPath = entry.path
            .filter(e => e.kind === AnalysisPathKind.Event) as AnalysisPathEvent[];

        let foundIdx = null;

        for (const [idx, path] of reprPath.entries()) {
            // Check location first
            if (window.activeTextEditor.document.uri.fsPath !== entry.files[path.location.file]) {
                continue;
            }

            if (cursor.isEqual(new Position(path.location.line-1, path.location.col-1))) {
                foundIdx = idx;

                if (which === 'first') {
                    break;
                }

                continue;
            }

            // Check inside the ranges
            if (!path.ranges) {
                continue;
            }

            for (const [start, end] of path.ranges) {
                const range = new Range(
                    start.line-1,
                    start.col-1,
                    end.line-1,
                    end.col,
                );

                if (range.contains(cursor)) {
                    foundIdx = idx;

                    if (which === 'first') {
                        break;
                    }
                }
            }
        }

        return foundIdx;
    }

    nextStep() {
        const stepIdx = this.getStepIndexUnderCursor('last');
        const entry = ExtensionApi.diagnostics.selectedEntry?.diagnostic;

        if (stepIdx === null || !entry) {
            return;
        }

        const reprPath = entry.path
            .filter(e => e.kind === AnalysisPathKind.Event) as AnalysisPathEvent[];

        if (stepIdx < reprPath.length - 1) {
            const stepLocation = reprPath[stepIdx + 1].location;

            window.showTextDocument(Uri.file(entry.files[stepLocation.file]), {
                selection: new Range(
                    stepLocation.line - 1,
                    stepLocation.col - 1,
                    stepLocation.line - 1,
                    stepLocation.col - 1
                )
            });
        }
    }

    previousStep() {
        const stepIdx = this.getStepIndexUnderCursor('first');
        const entry = ExtensionApi.diagnostics.selectedEntry?.diagnostic;

        if (stepIdx === null || !entry) {
            return;
        }

        const reprPath = entry.path
            .filter(e => e.kind === AnalysisPathKind.Event) as AnalysisPathEvent[];

        if (stepIdx > 0) {
            const stepLocation = reprPath[stepIdx - 1].location;

            window.showTextDocument(Uri.file(entry.files[stepLocation.file]), {
                selection: new Range(
                    stepLocation.line - 1,
                    stepLocation.col - 1,
                    stepLocation.line - 1,
                    stepLocation.col - 1
                )
            });
        }
    }
}