import { ExtensionContext } from 'vscode';
import { DiagnosticRenderer } from './diagnostics';

export class Editor {
    static init(ctx: ExtensionContext): void {
        this._diagnosticRenderer = new DiagnosticRenderer(ctx);
    }

    private static _diagnosticRenderer: DiagnosticRenderer;
    public static get diagnosticRenderer(): DiagnosticRenderer {
        return this._diagnosticRenderer;
    }
}