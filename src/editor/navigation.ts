import { ExtensionContext, Position, Range, Uri, commands, window } from 'vscode';
import { ExtensionApi } from '../backend/api';
import { DiagnosticReport } from '../backend/types';

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

        const diagnostic: DiagnosticReport | undefined =
            ExtensionApi.diagnostics.getFileDiagnostics(file)[diagnosticIndex];
        const targetFile = diagnostic ? Uri.file(diagnostic.file.original_path) : file;

        window.showTextDocument(targetFile, {
            selection: diagnostic !== undefined ? new Range(
                diagnostic.line - 1,
                diagnostic.column - 1,
                diagnostic.line - 1,
                diagnostic.column - 1
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

        const diagnostic: DiagnosticReport | undefined = ExtensionApi.diagnostics.getFileDiagnostics(file)[bugIndex];

        const step = diagnostic?.bug_path_events[stepIndex];

        const targetFile = step ? Uri.file(step.file.original_path)
            : diagnostic !== undefined ? Uri.file(diagnostic.file.original_path)
                : file;

        // Show the reproduction path on jumping to a step, to enable navigation.
        this.toggleSteps(file, bugIndex, true);

        window.showTextDocument(targetFile, {
            selection: step !== undefined ? new Range(
                step.line - 1,
                step.column - 1,
                step.line - 1,
                step.column - 1
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
        const reprPath = entry.bug_path_events;

        let foundIdx = null;

        for (const [idx, path] of reprPath.entries()) {
            // Check location first
            if (window.activeTextEditor.document.uri.fsPath !== path.file.original_path) {
                continue;
            }

            if (cursor.isEqual(new Position(path.line-1, path.column-1))) {
                foundIdx = idx;

                if (which === 'first') {
                    break;
                }

                continue;
            }

            // Check inside the ranges
            if (!path.range) {
                continue;
            }

            const range = new Range(
                path.range.start_line-1,
                path.range.start_col-1,
                path.range.end_line-1,
                path.range.end_col,
            );

            if (range.contains(cursor)) {
                foundIdx = idx;

                if (which === 'first') {
                    break;
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

        const reprPath = entry.bug_path_events;

        if (stepIdx < reprPath.length - 1) {
            const step = reprPath[stepIdx + 1];

            window.showTextDocument(Uri.file(step.file.original_path), {
                selection: new Range(
                    step.line - 1,
                    step.column - 1,
                    step.line - 1,
                    step.column - 1
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

        const reprPath = entry.bug_path_events;

        if (stepIdx > 0) {
            const step = reprPath[stepIdx - 1];

            window.showTextDocument(Uri.file(step.file.original_path), {
                selection: new Range(
                    step.line - 1,
                    step.column - 1,
                    step.line - 1,
                    step.column - 1
                )
            });
        }
    }
}