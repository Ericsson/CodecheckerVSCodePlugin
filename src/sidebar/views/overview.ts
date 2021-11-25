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

export class OverviewView implements TreeDataProvider<OverviewItem> {
    private tree?: TreeView<OverviewItem>;

    private topItems: {[id: string]: OverviewItem[]} = {
        'loading': [
            new OverviewItem('Loading overview, please wait...')
        ],
        'notFound': [
            new OverviewItem('CodeChecker run not found.'),
            new OverviewItem('Run CodeChecker, reload metadata,'),
            new OverviewItem('or set the output folder to get started')
        ],
        'normal': [
            new OverviewItem(() => `Total files analyzed: ${ExtensionApi.metadata.sourceFiles.size}`),
            new OverviewItem(() => `Last analysis run: ${
                new Date(ExtensionApi.metadata.metadata!.timestamps.begin /* seconds */ * 1000).toLocaleString()
            }`),
            new OverviewItem(() => {
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
            new OverviewItem(() => `Used analyzers: ${
                Object.keys(ExtensionApi.metadata.metadata!.analyzers).join(', ')
            }`),
        ]
    };

    private bottomItems: {[id: string]: OverviewItem[]} = {
        'normal': [
            new OverviewItem('Reload CodeChecker metadata', {
                title: 'reloadMetadata',
                command: 'codechecker.backend.reloadMetadata',
            }),
            new OverviewItem('Re-analyze current file', {
                title: 'reloadMetadata',
                command: 'codechecker.executor.analyzeCurrentFile',
            }),
            new OverviewItem('Re-analyze entire project', {
                title: 'reloadMetadata',
                command: 'codechecker.executor.analyzeProject',
            }),
        ],
        'ccNotFound': [
            new OverviewItem('Compilation database not found.'),
            new OverviewItem('Show database setup dialog...', {
                title: 'showSetupDialog',
                command: 'codechecker.editor.showSetupDialog'
            }),
            new OverviewItem('——'),
            new OverviewItem('Reload CodeChecker metadata', {
                title: 'reloadMetadata',
                command: 'codechecker.backend.reloadMetadata',
            }),
        ]
    };

    private separator = [new OverviewItem('——')];

    private itemsList: OverviewItem[][];

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._onDidChangeTreeData = new EventEmitter());
        ExtensionApi.metadata.metadataUpdated(this.updateStats, this, ctx.subscriptions);
        ExtensionApi.executorProcess.databaseLocationChanged(this.updateStats, this, ctx.subscriptions);

        this.itemsList = [this.topItems.loading];

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

    updateStats(_event?: CheckerMetadata | void) {
        const topItems = ExtensionApi.metadata.metadata !== undefined
            ? this.topItems.normal
            : this.topItems.notFound;

        const bottomItems = ExtensionApi.executorProcess.getCompileCommandsPath() !== undefined
            ? this.bottomItems.normal
            : this.bottomItems.ccNotFound;

        this.itemsList = [topItems, this.separator, bottomItems];

        this._onDidChangeTreeData.fire();
    }

    private _onDidChangeTreeData: EventEmitter<void>;
    public get onDidChangeTreeData(): Event<void> {
        return this._onDidChangeTreeData.event;
    }

    getChildren(element?: OverviewItem): OverviewItem[] {
        if (element !== undefined) {
            return [];
        }

        return this.itemsList.flat();
    }

    getTreeItem(item: OverviewItem): TreeItem | Promise<TreeItem> {
        return item.getTreeItem();
    }
}
