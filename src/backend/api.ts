import { ExtensionContext } from 'vscode';
import { ExecutorManager, ExecutorProcess } from './executor';
import { DiagnosticsApi, MetadataApi } from './processor';

export class ExtensionApi {
    static init(ctx: ExtensionContext): void {
        this._metadata = new MetadataApi(ctx);
        this._diagnostics = new DiagnosticsApi(ctx);
        this._executorProcess = new ExecutorProcess(ctx);
        this._executorManager = new ExecutorManager(ctx);
    }

    private static _metadata: MetadataApi;
    public static get metadata() {
        return this._metadata;
    }

    private static _diagnostics: DiagnosticsApi;
    public static get diagnostics() {
        return this._diagnostics;
    }

    private static _executorProcess: ExecutorProcess;
    public static get executorProcess() {
        return this._executorProcess;
    }

    private static _executorManager: ExecutorManager;
    public static get executorManager() {
        return this._executorManager;
    }
}
