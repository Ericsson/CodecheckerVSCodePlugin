import { ExtensionContext } from 'vscode';
import { OverviewView, ReportsView } from './views';

export class SidebarContainer {
    static init(ctx: ExtensionContext): void {
        this._overviewView = new OverviewView(ctx);
        this._reportsView = new ReportsView(ctx);
    }

    private static _overviewView: OverviewView;
    public static get overviewView(): OverviewView {
        return this._overviewView;
    }

    private static _reportsView: ReportsView;
    public static get reportsView(): ReportsView {
        return this._reportsView;
    }
}
