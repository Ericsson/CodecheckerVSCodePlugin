import { ExtensionContext } from 'vscode';
import { DiagnosticRenderer } from './diagnostics';
import { NavigationHandler } from './navigation';

export class Editor {
    static init(ctx: ExtensionContext): void {
        this._diagnosticRenderer = new DiagnosticRenderer(ctx);
        this._navigationHandler = new NavigationHandler(ctx);
    }

    private static _diagnosticRenderer: DiagnosticRenderer;
    public static get diagnosticRenderer(): DiagnosticRenderer {
        return this._diagnosticRenderer;
    }

    private static _navigationHandler: NavigationHandler;
    public static get navigationHandler(): NavigationHandler {
        return this._navigationHandler;
    }
}