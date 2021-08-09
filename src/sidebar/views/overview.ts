import { Command, Event, EventEmitter, ExtensionContext, TreeDataProvider, TreeItem, TreeView, window } from 'vscode';
import { ExtensionApi } from '../../backend/api';
import { CheckerMetadata } from '../../backend/types';

export class OverviewItem {
    constructor(private label: string | (() => string), private command?: Command) {}

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const label = typeof this.label === 'string' ? this.label : this.label();

        const node = new TreeItem(label);
        node.command = this.command;
        node.description = this.command?.tooltip;

        return node;
    }
}

export class OverviewView implements TreeDataProvider<string> {
    private tree?: TreeView<string>;

    // FIXME: Export the keys into an enum, or otherwise check in the itemsList if an entry exists
    private items: {[id: string]: OverviewItem} = {
        'loading': new OverviewItem('Loading overview, please wait...'),

        'notfound': new OverviewItem('CodeChecker run not found.'),
        'notfound2': new OverviewItem('Run CodeChecker, reload metadata,'),
        'notfound3': new OverviewItem('or set the output folder to get started'),

        'files': new OverviewItem(() => `Total files analyzed: ${ExtensionApi.metadata.sourceFiles.size}`),
        'lastRun': new OverviewItem(() => `Last analysis run: ${
            new Date(ExtensionApi.metadata.metadata!.timestamps.begin /* seconds */ * 1000).toLocaleString()
        }`),
        'buildLength': new OverviewItem(() => {
            // Time in seconds
            const beginTime = ExtensionApi.metadata.metadata!.timestamps.begin;
            const endTime = ExtensionApi.metadata.metadata!.timestamps.end;
            const interval = endTime - beginTime;

            const hours = Math.floor(interval/3600) % 60;
            const minutes = Math.floor(interval/60) % 60;
            const seconds = Math.floor(interval) % 60;
            const ms = Math.floor(interval * 1000) % 1000;

            if (hours > 0 || minutes > 0) {
                // H:MM:SS s / M:SS s
                const formattedMinutes = hours > 0 ? (`${hours}:${minutes.toString().padStart(2, '0')}`) : minutes;
                return `Analysis duration: ${formattedMinutes}:${seconds.toString().padStart(2, '0')} s`;
            } else {
                // S.fff s
                return `Analysis duration: ${(seconds + ms / 1000).toFixed(3)} s`;
            }
        }),
        'analyzers': new OverviewItem(() => `Used analyzers: ${
            Object.keys(ExtensionApi.metadata.metadata!.analyzers).join(', ')
        }`),

        'separator': new OverviewItem('——'),

        'reloadMetadata': new OverviewItem('Reload CodeChecker metadata', {
            title: 'reloadMetadata', 
            command: 'codechecker.backend.reloadMetadata',
        }),
    };

    private regularItemsList = [
        'files',
        'lastRun',
        'buildLength',
        'analyzers',

        'separator',

        'reloadMetadata',
    ];
    private notFoundItemsList = [
        'notfound',
        'notfound2',
        'notfound3',

        'separator',

        'reloadMetadata',
    ];
    private itemsList: string[];

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._onDidChangeTreeData = new EventEmitter());
        ExtensionApi.metadata.metadataUpdated(this.updateStats, this, ctx.subscriptions);

        this.itemsList = ['loading'];

        ctx.subscriptions.push(this.tree = window.createTreeView(
            'codechecker.views.overview',
            {
                treeDataProvider: this
            }
        ));

        this.init();
    }

    private init() {
        if (ExtensionApi.metadata.metadata) {
            this.updateStats(ExtensionApi.metadata.metadata);
        }
    }

    updateStats(_event?: CheckerMetadata) {
        if (ExtensionApi.metadata.metadata !== undefined) {
            this.itemsList = this.regularItemsList;
        } else {
            this.itemsList = this.notFoundItemsList;
        }

        this._onDidChangeTreeData.fire();
    }

    private _onDidChangeTreeData: EventEmitter<void>;
    public get onDidChangeTreeData(): Event<void> {
        return this._onDidChangeTreeData.event;
    }

    getChildren(element?: string): string[] {
        if (element !== undefined) {
            return [];
        }

        return this.itemsList;
    }

    getTreeItem(item: string): TreeItem | Promise<TreeItem> {
        return this.items[item].getTreeItem();
    }
}
