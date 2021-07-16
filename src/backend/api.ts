import { ExtensionContext } from 'vscode';
import { DiagnosticsApi, MetadataApi } from './processor';

export class ExtensionApi {
    static init(ctx: ExtensionContext): void {
        this._metadata = new MetadataApi(ctx);
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
}
