import {
    CancellationToken,
    CodeLens,
    CodeLensProvider,
    Event,
    EventEmitter,
    ExtensionContext,
    Range,
    TextDocument,
    languages,
    window,
    workspace
} from 'vscode';
import { ExtensionApi } from '../backend';

export class CodeLensStepsProvider implements CodeLensProvider {
    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._onDidChangeCodeLenses = new EventEmitter());

        ExtensionApi.diagnostics.diagnosticsUpdated(
            this._onDidChangeCodeLenses.fire,
            this._onDidChangeCodeLenses,
            ctx.subscriptions
        );

        ctx.subscriptions.push(languages.registerCodeLensProvider('*', this));

        workspace.onDidChangeTextDocument(({ document }) => {
            const editor = window.activeTextEditor;
            if (document.uri.fsPath === editor?.document.uri.fsPath) {
                this._onDidChangeCodeLenses.fire();
            }
        });
    }

    private _onDidChangeCodeLenses: EventEmitter<void>;
    public get onDidChangeCodeLenses(): Event<void> {
        return this._onDidChangeCodeLenses.event;
    }

    provideCodeLenses(document: TextDocument, _token: CancellationToken): CodeLens[] {
        if (
            ExtensionApi.diagnostics.selectedEntry === undefined ||
            !workspace.getConfiguration('codechecker.editor').get('enableCodeLens') ||
            document.isDirty
        ) {
            return [];
        }

        const entry = ExtensionApi.diagnostics.selectedEntry;
        const fullPath = entry.diagnostic.bug_path_events;

        if (fullPath.length === 0) {
            return [];
        }

        const codeLenses = [];

        // Used when consecutive steps are displayed
        let previousJumpIdx = -1;

        for (const [idx, pathItem] of fullPath.entries()) {
            if (pathItem.file.original_path !== document.uri.fsPath) {
                previousJumpIdx = idx;
                continue;
            }

            // TODO: Handle multiple ranges
            const range = new Range(
                pathItem.line-1,
                0,
                pathItem.line-1,
                0,
            );

            codeLenses.push(new CodeLens(range, {
                'title': `${idx + 1}: ${pathItem.message}`,
                'command': 'codechecker.editor.jumpToStep',
                'arguments': [
                    entry.position.file,
                    entry.position.idx,
                    idx
                ]
            }));

            // When there's consecutive steps on the same line, hide Next and Previous
            const hideJumps = idx < fullPath.length - 1 &&
                fullPath[idx + 1].file.original_path === pathItem.file.original_path &&
                fullPath[idx + 1].line === pathItem.line;

            if (hideJumps) {
                continue;
            }

            if (previousJumpIdx >= 0) {
                codeLenses.push(new CodeLens(range, {
                    'title': 'Previous step',
                    'command': 'codechecker.editor.jumpToStep',
                    'arguments': [
                        entry.position.file,
                        entry.position.idx,
                        previousJumpIdx
                    ]
                }));
            }

            previousJumpIdx = idx;

            if (idx < fullPath.length - 1) {
                codeLenses.push(new CodeLens(range, {
                    'title': 'Next step',
                    'command': 'codechecker.editor.jumpToStep',
                    'arguments': [
                        entry.position.file,
                        entry.position.idx,
                        idx + 1
                    ]
                }));
            }
        }

        return codeLenses;
    }
}