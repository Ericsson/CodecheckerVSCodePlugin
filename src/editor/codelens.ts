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
    workspace
} from 'vscode';
import { ExtensionApi } from '../backend';
import { AnalysisPathEvent, AnalysisPathKind } from '../backend/types';

export class CodeLensStepsProvider implements CodeLensProvider {
    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._onDidChangeCodeLenses = new EventEmitter());

        ExtensionApi.diagnostics.diagnosticsUpdated(
            this._onDidChangeCodeLenses.fire,
            this._onDidChangeCodeLenses,
            ctx.subscriptions
        );

        ctx.subscriptions.push(languages.registerCodeLensProvider('*', this));
    }

    private _onDidChangeCodeLenses: EventEmitter<void>;
    public get onDidChangeCodeLenses(): Event<void> {
        return this._onDidChangeCodeLenses.event;
    }

    provideCodeLenses(document: TextDocument, _token: CancellationToken): CodeLens[] {
        if (ExtensionApi.diagnostics.selectedEntry === undefined ||
            !workspace.getConfiguration('codechecker.editor').get('enableCodeLens')) {
            return [];
        }

        const entry = ExtensionApi.diagnostics.selectedEntry;
        const fullPath = entry.diagnostic.path
            .filter(elem => elem.kind === AnalysisPathKind.Event) as AnalysisPathEvent[];

        if (fullPath.length === 0) {
            return [];
        }

        const codeLenses = [];

        // Used when consecutive steps are displayed
        let previousJumpIdx = -1;

        for (const [idx, pathItem] of fullPath.entries()) {
            if (entry.diagnostic.files[pathItem.location.file] !== document.uri.fsPath) {
                continue;
            }

            // TODO: Handle multiple ranges
            const range = new Range(
                pathItem.location.line-1,
                0,
                pathItem.location.line-1,
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
                fullPath[idx + 1].location.file === pathItem.location.file &&
                fullPath[idx + 1].location.line === pathItem.location.line;

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

                previousJumpIdx = idx;
            }

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