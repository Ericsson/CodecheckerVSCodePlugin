import { ExtensionContext, Position, Range, Uri, commands, env, window } from 'vscode';
import { ExtensionApi } from '../backend';
import { DiagnosticReport } from '../backend/types';

export class NavigationHandler {
    // The step index keyboard navigation is currently on.
    private currentStepIndex?: number;

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.toggleSteps', this.toggleSteps, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.jumpToReport', this.jumpToReport, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.jumpToStep', this.jumpToStep, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.nextStep', this.nextStep, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.previousStep', this.previousStep, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.openDocs', this.openDocs, this));
    }

    openDocs(docUrl: Uri | string) {
        if (typeof docUrl === 'string') {
            docUrl = Uri.parse(docUrl);
        }

        void env.openExternal(docUrl);
    }

    onDiagnosticsUpdated() {
        // The selectedEntry can change only via toggleSteps() or via a new CodeChecker parse run.
        // toggleSteps() resets the index on change, CC parse sets the entry to undefined.
        if (ExtensionApi.diagnostics.selectedEntry === undefined) {
            this.currentStepIndex = undefined;
        }
    }

    toggleSteps(file: Uri | string, diagnosticIdx: number, targetState?: boolean) {
        if (typeof file === 'string') {
            file = Uri.file(file);
        }

        const diagnostic = ExtensionApi.diagnostics.getFileDiagnostics(file)[diagnosticIdx] ?? [];

        // Reset the step count whether the diagnostics are replaced or not
        this.currentStepIndex = undefined;

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
        } else if (diagnostic === ExtensionApi.diagnostics.selectedEntry?.diagnostic) {
            // With the repr. path open, the report is always the last step
            this.currentStepIndex = diagnostic.bug_path_events.length - 1;
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
            // With the repr. path open, the report is always the last step
            this.currentStepIndex = diagnostic.bug_path_events.length - 1;
        } else {
            // Otherwise set the current index
            this.currentStepIndex = stepIndex;
        }
    }

    getStepIndexUnderCursor(which: 'first' | 'last'): number | undefined {
        if (window.activeTextEditor === undefined || ExtensionApi.diagnostics.selectedEntry === undefined) {
            return undefined;
        }

        const cursor = window.activeTextEditor.selection.anchor;

        const entry = ExtensionApi.diagnostics.selectedEntry.diagnostic;
        const reprPath = entry.bug_path_events;

        // The cursor is on the bug's original jump location
        let isExactPosition = false;
        let foundIdx: number | undefined;

        for (const [idx, path] of reprPath.entries()) {
            // Check location first
            if (window.activeTextEditor.document.uri.fsPath !== path.file.original_path) {
                continue;
            }

            if (cursor.isEqual(new Position(path.line-1, path.column-1))) {
                // Set the first result if there's no exact-position match yet,
                // or always set the last result
                if ((which === 'first' && isExactPosition)) {
                    continue;
                }

                foundIdx = idx;
                isExactPosition = true;

                continue;
            }

            // Set the first result if there's a range, there's nothing found yet,
            // or set the last result if there's no exact-position match yet
            if (!path.range || (which === 'first' && foundIdx !== undefined) || isExactPosition) {
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
            }
        }

        return foundIdx;
    }

    nextStep() {
        const stepIdx = this.currentStepIndex ?? this.getStepIndexUnderCursor('last');
        const entry = ExtensionApi.diagnostics.selectedEntry?.diagnostic;

        if (stepIdx === undefined || !entry) {
            return;
        }

        const reprPath = entry.bug_path_events;

        if (stepIdx < reprPath.length - 1) {
            this.currentStepIndex = stepIdx + 1;
            const step = reprPath[this.currentStepIndex];

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
        const stepIdx = this.currentStepIndex ?? this.getStepIndexUnderCursor('first');
        const entry = ExtensionApi.diagnostics.selectedEntry?.diagnostic;

        if (stepIdx === undefined || !entry) {
            return;
        }

        const reprPath = entry.bug_path_events;

        if (stepIdx > 0) {
            this.currentStepIndex = stepIdx - 1;
            const step = reprPath[this.currentStepIndex];

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