import { ExtensionContext } from 'vscode';
import { MetadataApi } from './processor';

export class ExtensionApi {
    static init(ctx: ExtensionContext): void {
        this._metadata = new MetadataApi(ctx);
    }

    private static _metadata: MetadataApi;
    public static get metadata() {
        return this._metadata;
    }
}
