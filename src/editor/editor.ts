import { ExtensionContext } from 'vscode';
import { CodeLensStepsProvider } from './codelens';
import { DiagnosticRenderer } from './diagnostics';
import { ExecutorAlerts } from './executor';
import { FolderInitializer } from './initialize';
import { LoggerPanel } from './logger';
import { NavigationHandler } from './navigation';
import { ExecutorTaskProvider } from './tasks';

export class Editor {
    static init(ctx: ExtensionContext): void {
        this._diagnosticRenderer = new DiagnosticRenderer(ctx);
        this._navigationHandler = new NavigationHandler(ctx);
        this._codeLensStepsProvider = new CodeLensStepsProvider(ctx);
        this._loggerPanel = new LoggerPanel(ctx);
        this._executorAlerts = new ExecutorAlerts(ctx);
        this._folderInitializer = new FolderInitializer(ctx);
        this._executorTaskProvider = new ExecutorTaskProvider(ctx);
    }

    private static _diagnosticRenderer: DiagnosticRenderer;
    public static get diagnosticRenderer(): DiagnosticRenderer {
        return this._diagnosticRenderer;
    }

    private static _codeLensStepsProvider: CodeLensStepsProvider;
    public static get codeLensStepsProvider(): CodeLensStepsProvider {
        return this._codeLensStepsProvider;
    }

    private static _navigationHandler: NavigationHandler;
    public static get navigationHandler(): NavigationHandler {
        return this._navigationHandler;
    }

    private static _loggerPanel: LoggerPanel;
    public static get loggerPanel(): LoggerPanel {
        return this._loggerPanel;
    }

    private static _executorAlerts: ExecutorAlerts;
    public static get executorAlerts(): ExecutorAlerts {
        return this._executorAlerts;
    }

    private static _folderInitializer: FolderInitializer;
    public static get folderInitializer(): FolderInitializer {
        return this._folderInitializer;
    }

    private static _executorTaskProvider: ExecutorTaskProvider;
    public static get executorTaskProvider(): ExecutorTaskProvider {
        return this._executorTaskProvider;
    }
}