import { basename, relative } from 'path';
import {
    Event,
    EventEmitter,
    ExtensionContext,
    ThemeColor,
    ThemeIcon,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    TreeItemLabel,
    TreeView,
    TreeViewSelectionChangeEvent,
    Uri,
    commands,
    window,
    workspace
} from 'vscode';
import { ExtensionApi } from '../../backend';
import { DiagnosticReport } from '../../backend/types';

export class ReportTreeItem extends TreeItem {
    parent: ReportTreeItem | undefined;

    constructor(
        public readonly _id: string,
        public readonly label: string | TreeItemLabel,
        public readonly iconPath: ThemeIcon,
        public readonly children?: ReportTreeItem[] | undefined
    ) {
        super(label, children?.length ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None);
        this._id = _id;
        this.label = label;
        this.iconPath = this.iconPath;
        this.children = children;

        // Set parent for children automatically.
        this.children?.forEach(c => c.parent = this);
    }

    // This function can be used to set ID attribute of a tree item and all the children of it based on the parent id.
    setId() {
        this.id = `${this.parent?.id ?? 'root'}_${this._id}`;
        this.children?.forEach(c => c.setId());
    }

    // It will expand the tree item (including all the parent items) if the tree item is in collapsed state.
    expand() {
        if (this.collapsibleState === TreeItemCollapsibleState.Collapsed) {
            this.collapsibleState = TreeItemCollapsibleState.Expanded;
        }

        if (this.parent !== undefined) {
            this.parent.expand();
        }
    }

    traverse(cb: (item: ReportTreeItem) => void) {
        cb(this);
        this.children?.forEach(c => c.traverse(cb));
    }
}

class TreeDiagnosticReport {
    constructor(
        public readonly entryId: number,
        public readonly value: DiagnosticReport
    ) {
        this.entryId = entryId;
        this.value = value;
    }
}

/* eslint-disable @typescript-eslint/naming-convention */
const severityOrder: { [key: string]: number } = {
    'CRITICAL': 0,
    'HIGH': 1,
    'MEDIUM': 2,
    'LOW': 3,
    'STYLE': 4,
    'UNSPECIFIED': 5,
};
/* eslint-enable @typescript-eslint/naming-convention */

export class ReportsView implements TreeDataProvider<ReportTreeItem> {
    protected currentFile?: Uri;
    protected currentEntryList?: DiagnosticReport[];

    protected tree?: TreeView<ReportTreeItem>;
    // Contains [fullpath => item] entries
    private treeItems: Map<string, ReportTreeItem> = new Map();
    private selectedTreeItems: ReportTreeItem[] = [];

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._onDidChangeTreeData = new EventEmitter());
        window.onDidChangeActiveTextEditor(this.refreshBugList, this, ctx.subscriptions);

        ExtensionApi.diagnostics.diagnosticsUpdated(() => {
            // FIXME: fired twice when a file is opened freshly.
            const selected = ExtensionApi.diagnostics.selectedEntry?.position.file;
            for (const filePath of this.treeItems.keys()) {
                if (filePath !== selected) {
                    this.treeItems.delete(filePath);
                }
            }

            this.refreshBugList();
        }, this, ctx.subscriptions);

        ctx.subscriptions.push(this.tree = window.createTreeView(
            'codechecker.views.reports',
            { treeDataProvider: this }
        ));

        this.init();
    }

    protected init() {
        this.currentFile = window.activeTextEditor?.document.uri;

        this.tree?.onDidChangeSelection((item: TreeViewSelectionChangeEvent<ReportTreeItem>) => {
            this.selectedTreeItems = item.selection;
        });
    }

    private _onDidChangeTreeData: EventEmitter<void>;
    public get onDidChangeTreeData(): Event<void> {
        return this._onDidChangeTreeData.event;
    }

    refreshBugList() {
        // Hide the report list when there's no metadata
        const metadataExists = ExtensionApi.metadata.metadata !== undefined;
        commands.executeCommand('setContext', 'codechecker.sidebar.showReports', metadataExists);

        const activeUri = window.activeTextEditor?.document.uri;
        if (!activeUri) {
            return;
        }

        // Handle Code's Output tab
        if (activeUri?.scheme === 'output') {
            // Only clear currentFile if it was closed
            if (window.visibleTextEditors.every((editor) => editor.document.uri.fsPath !== this.currentFile?.fsPath)) {
                this.currentFile = undefined;
            }
        } else {
            this.currentFile = activeUri;
        }

        // Clear tree on file close
        if (this.currentFile === undefined) {
            this.currentEntryList = [];
            this._onDidChangeTreeData.fire();
            return;
        }

        this.currentEntryList = ExtensionApi.diagnostics.getFileDiagnostics(this.currentFile);
        this._onDidChangeTreeData.fire();
    }

    revealSelectedItems() {
        const selectedIds = new Set(this.selectedTreeItems.map(item => item.id));
        this.treeItems.forEach(root => root.traverse(item => {
            if (selectedIds.has(item.id)) {
                void this.tree?.reveal(item, { select: true, focus: true });
            }
        }));
    }

    readonly getTreeItem = (t: ReportTreeItem) => t;

    readonly getParent = (t: ReportTreeItem) => t.parent;

    getReportStepItems({ entryId, value: entry }: TreeDiagnosticReport): ReportTreeItem[] {
        const selectedPosition = ExtensionApi.diagnostics.selectedEntry?.position;
        const isActiveReport = selectedPosition?.idx === entryId;
        const currentFile = this.currentFile;

        const jumpToReportItem = new ReportTreeItem('jumpToReport', 'Jump to report', new ThemeIcon('debug-step-over'));
        jumpToReportItem.command = {
            title: 'jumpToReport',
            command: 'codechecker.editor.jumpToReport',
            arguments: [currentFile, entryId, true]
        };

        const checkerData = ExtensionApi.metadata.checkerData
            ?.get(`${entry.analyzer_name ?? ''}/${entry.checker_name ?? ''}`);

        const docUrl = checkerData?.labels
            .find((val) => val.startsWith('doc_url:'))
            ?.substring(8);

        const goToDocsItems = [];

        if (docUrl !== undefined) {
            const goToDocsItem = new ReportTreeItem('openDocs', 'Go to checker documentation', new ThemeIcon('book'));
            goToDocsItem.command = {
                title: 'openDocs',
                command: 'codechecker.editor.openDocs',
                arguments: [docUrl]
            };

            goToDocsItems.push(goToDocsItem);
        }

        let toggleStepsItem = null;
        if (isActiveReport) {
            toggleStepsItem = new ReportTreeItem(
                'hideReproductionSteps', 'Hide reproduction steps', new ThemeIcon('eye-closed'));
        } else {
            toggleStepsItem = new ReportTreeItem(
                'showReproductionSteps', 'Show reproduction steps', new ThemeIcon('eye'));
        }

        toggleStepsItem.command = {
            title: 'toggleSteps',
            command: 'codechecker.editor.toggleSteps',
            arguments: [currentFile, entryId]
        };

        let indentation = 0;
        return [
            jumpToReportItem,
            ...goToDocsItems,
            toggleStepsItem,
            ...entry.bug_path_events.map((event, idx) => {
                const filePath = event.file.original_path;
                const fileName = basename(filePath);

                const item = new ReportTreeItem(
                    `${idx + 1}`,
                    `${'    '.repeat(indentation)} ${idx + 1}. ${fileName}:${event.line} - ${event.message}`,
                    new ThemeIcon('debug-breakpoint'));

                item.tooltip = [
                    `Message: ${event.message}`,
                    `File path: ${filePath}`,
                    `Line: ${event.line}`,
                    `Column: ${event.column}`,
                ].join('\n');

                item.command = {
                    title: 'jumpToStep',
                    command: 'codechecker.editor.jumpToStep',
                    arguments: [currentFile, entryId, idx, true]
                };

                if (event.message.includes('Calling')) {
                    indentation += 1;
                } else if (event.message.includes('Returning from')) {
                    indentation -= 1;
                }

                return item;
            })
        ];
    }

    getReportItems(entries: TreeDiagnosticReport[]): ReportTreeItem[] {
        return entries.map(entry => {
            /* eslint-disable @typescript-eslint/naming-convention */
            const {
                file, line, column, analyzer_name, checker_name, message, report_hash, severity, review_status,
                bug_path_events
            } = entry.value;
            /* eslint-enable @typescript-eslint/naming-convention */

            const item: ReportTreeItem = new ReportTreeItem(
                `${entry.entryId}`,
                `L${line} - ${checker_name} [${bug_path_events.length}]`,
                new ThemeIcon('bug'),
                this.getReportStepItems(entry));

            item.tooltip = [
                `Analyze name: ${analyzer_name}`,
                `Checker name: ${checker_name}`,
                `Severity: ${severity}`,
                `File path: ${file.original_path}`,
                `Line: ${line}`,
                `Column: ${column}`,
                `Message: ${message}`,
                `Report hash: ${report_hash}`,
                `Review status: ${review_status}`,

            ].join('\n');

            return item;
        });
    }

    getRootItemThemeIcon(severity: string): ThemeIcon {
        const color = `severity.${severity.toLocaleLowerCase()}`;
        return new ThemeIcon('warning', new ThemeColor(color));
    }

    sortSeverityItems([severityA]: [string, DiagnosticReport[]], [severityB]: [string, DiagnosticReport[]]) {
        return severityOrder[severityA] - severityOrder[severityB];
    }

    // Get root level items.
    getRootItems(): ReportTreeItem[] | undefined {
        if (!this.currentEntryList?.length) {
            return [new ReportTreeItem('noReportsFound', 'No reports found', new ThemeIcon('pass'))];
        }

        const severityItems: { [key: string]: TreeDiagnosticReport[] } = {};
        for (const [idx, entry] of this.currentEntryList.entries()) {
            const severity = entry.severity || 'UNSPECIFIED';
            if (!(severity in severityItems)) {
                severityItems[severity] = [];
            }
            severityItems[severity].push(new TreeDiagnosticReport(idx, entry));
        }

        const rootItems: ReportTreeItem[] = [];

        rootItems.push(...Object.entries(severityItems)
            .sort(([severityA]: [string, TreeDiagnosticReport[]], [severityB]: [string, TreeDiagnosticReport[]]) =>
                severityOrder[severityA] - severityOrder[severityB])
            .map(([severity, entries]) => {
                const item: ReportTreeItem = new ReportTreeItem(
                    severity, severity, this.getRootItemThemeIcon(severity), this.getReportItems(entries));

                return item;
            }));

        return rootItems;
    }

    getChildren(t?: ReportTreeItem): ReportTreeItem[] | undefined {
        const currentFile = this.currentFile;
        if (!currentFile) {
            return [new ReportTreeItem('noFileSelected', 'No file selected', new ThemeIcon('warning'))];
        }

        if (t) {
            return t.children;
        }

        // Refresh current file's reports
        let filePath = currentFile.fsPath;
        const workspaceFolder = workspace.workspaceFolders?.[0].uri.fsPath;
        if (workspaceFolder) {
            filePath = relative(workspaceFolder, filePath);
        }

        const item: ReportTreeItem = new ReportTreeItem(
            currentFile.fsPath, filePath, new ThemeIcon('file-code'),
            this.getRootItems());
        item.setId();

        item.collapsibleState = TreeItemCollapsibleState.Expanded;
        this.treeItems.set(currentFile.fsPath, item);

        if (!this.selectedTreeItems.length) {
            item.children?.[0]?.children?.[0].expand();
        }

        this.revealSelectedItems();

        const items = [];
        if (ExtensionApi.diagnostics.selectedEntry) {
            const item = new ReportTreeItem('hideSteps', 'Hide active reproduction steps', new ThemeIcon('eye-closed'));
            item.command = {
                title: 'toggleSteps',
                command: 'codechecker.editor.toggleSteps',
                arguments: [this.currentFile, -1, false]
            };
            items.push(item);
        }

        return [...items, ...this.treeItems.values()];
    }
}