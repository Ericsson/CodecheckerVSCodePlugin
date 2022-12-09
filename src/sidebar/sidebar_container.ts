import { ExtensionContext } from 'vscode';
import { NotificationView, OverviewView, ReportsView } from './views';

export class SidebarContainer {
    static init(ctx: ExtensionContext): void {
        this._overviewView = new OverviewView(ctx);
        this._reportsView = new ReportsView(ctx);
        this._notificationView = new NotificationView(ctx);
    }

    private static _overviewView: OverviewView;
    public static get overviewView(): OverviewView {
        return this._overviewView;
    }

    private static _reportsView: ReportsView;
    public static get reportsView(): ReportsView {
        return this._reportsView;
    }

    private static _notificationView: NotificationView;
    public static get notificationView(): NotificationView {
        return this._notificationView;
    }
}
