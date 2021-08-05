import { ExtensionContext, Position, Range, Uri, commands, window } from 'vscode';
import { ExtensionApi } from '../backend/api';
import { AnalysisPathEvent, AnalysisPathKind, DiagnosticEntry } from '../backend/types';

export class NavigationHandler {
    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.jumpToReport', this.jumpToReport, this));
        ctx.subscriptions.push(commands.registerCommand('codechecker.editor.jumpToStep', this.jumpToStep, this));
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
}