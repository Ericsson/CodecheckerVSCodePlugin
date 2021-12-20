import { ExtensionContext } from 'vscode';
import { ExecutorBridge as ExecutorBridge, ExecutorManager } from './executor';
import { DiagnosticsApi, MetadataApi } from './processor';

export class ExtensionApi {
    static init(ctx: ExtensionContext): void {
        this._metadata = new MetadataApi(ctx);
        this._executorManager = new ExecutorManager(ctx);
        this._executorBridge = new ExecutorBridge(ctx);
        this._diagnostics = new DiagnosticsApi(ctx);
    }

    private static _metadata: MetadataApi;
    public static get metadata() {
        return this._metadata;
    }

    private static _diagnostics: DiagnosticsApi;
    public static get diagnostics() {
        return this._diagnostics;
    }

    private static _executorManager: ExecutorManager;
    public static get executorManager() {
        return this._executorManager;
    }

    private static _executorBridge: ExecutorBridge;
    public static get executorBridge() {
        return this._executorBridge;
    }
}
