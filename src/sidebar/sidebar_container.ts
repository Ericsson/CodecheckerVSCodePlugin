import { ExtensionContext } from 'vscode';
import { OverviewView } from './views';

export class SidebarContainer {
    static init(ctx: ExtensionContext): void {
        this._overviewView = new OverviewView(ctx);
    }

    private static _overviewView: OverviewView;
    public static get overviewView(): OverviewView {
        return this._overviewView;
    }
}
