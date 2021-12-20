import { basename } from 'path';
import {
    Command,
    Event,
    EventEmitter,
    ExtensionContext,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    TreeView,
    Uri,
    commands,
    window
} from 'vscode';
import { ExtensionApi } from '../../backend/api';
import { DiagnosticReport } from '../../backend/types';

export interface IssueMetadata {
    entryIndex?: number;
    reprStep?: number;
    reprHasChildren?: boolean;
    description?: string;
    command?: Command;
}

export class ReportsView implements TreeDataProvider<IssueMetadata> {
    protected currentFile?: Uri;
    protected currentEntryList?: DiagnosticReport[];

    protected tree?: TreeView<IssueMetadata>;

    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this._onDidChangeTreeData = new EventEmitter());
        window.onDidChangeActiveTextEditor(this.refreshBugList, this, ctx.subscriptions);
        ExtensionApi.diagnostics.diagnosticsUpdated(this.refreshBugList, this, ctx.subscriptions);

        ctx.subscriptions.push(this.tree = window.createTreeView(
            'codechecker.views.reports',
            { treeDataProvider: this }
        ));

        this.init();
    }

    protected init() {
        this.currentFile = window.activeTextEditor?.document.uri;
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

    getChildren(element?: IssueMetadata): IssueMetadata[] | undefined {
        // Special case: No file selected
        if (!this.currentFile) {
            if (element === undefined) {
                return [{ description: 'No file selected' }];
            }

            return [];
        // Special case: No reports in current file
        } else if ((this.currentEntryList?.length ?? 0) === 0) {
            if (element === undefined) {
                return [{ description: `No reports found in file ${basename(this.currentFile.fsPath)}` }];
            }

            return [];
        }

        // First level, report list
        if (element?.entryIndex === undefined) {
            const reportsText = this.currentEntryList!.length === 1
                ? '1 report'
                : `${this.currentEntryList!.length} reports`;

            const header: IssueMetadata[] = [
                { description: `${reportsText} found in file ${basename(this.currentFile!.fsPath)}` }
            ];

            let selectedHeader: IssueMetadata[] = [];

            if (ExtensionApi.diagnostics.selectedEntry) {
                selectedHeader = [
                    {
                        description: 'Hide active reproduction steps',
                        command: {
                            title: 'toggleSteps',
                            command: 'codechecker.editor.toggleSteps',
                            arguments: [this.currentFile, -1, false]
                        }
                    }
                ];
            }

            const currentHeader: IssueMetadata[] = [
                { description: '——' },
                { description: 'In the current file:' }
            ];

            const currentItems = this.currentEntryList!
                .map((entry, idx): [DiagnosticReport, number] => [entry, idx])
                .filter(([entry, _]) => entry.file.original_path === this.currentFile?.fsPath)
                .map(([_, entryIndex]) => { return { entryIndex }; });

            const relatedHeader: IssueMetadata[] = [
                { description: '——' },
                { description: 'In related files:' }
            ];

            const relatedItems = this.currentEntryList!
                .map((entry, idx): [DiagnosticReport, number] => [entry, idx])
                .filter(([entry, _]) => entry.file.original_path !== this.currentFile?.fsPath)
                .map(([_, entryIndex]) => { return { entryIndex }; });

            return header
                .concat(selectedHeader)
                .concat(currentHeader)
                .concat(currentItems)
                .concat(relatedHeader)
                .concat(relatedItems);
        }

        // Commands have no children
        if (element.description !== undefined || element.command !== undefined) {
            return [];
        }

        const path = this.currentEntryList![element.entryIndex].bug_path_events
            .map((pathElem, idx) => { return { idx, pathElem }; });

        // Second level, reproduction steps
        if (element.reprStep === undefined) {
            const selectedPosition = ExtensionApi.diagnostics.selectedEntry?.position;
            const isActiveReport = selectedPosition?.idx === element.entryIndex;

            const commands: IssueMetadata[] = [
                {
                    ...element,
                    description: 'Jump to report',
                    command: {
                        title: 'jumpToReport',
                        command: 'codechecker.editor.jumpToReport',
                        arguments: [this.currentFile, element.entryIndex, true]
                    }
                },
                {
                    ...element,
                    description: `${isActiveReport ? 'Hide' : 'Show'} reproduction steps`,
                    command: {
                        title: 'toggleSteps',
                        command: 'codechecker.editor.toggleSteps',
                        arguments: [this.currentFile, element.entryIndex]
                    }
                },
                { ...element, description: '——' }
            ];

            const items = path
                .filter((/* { pathElem } */) => /* pathElem.depth */ 0 === 0)
                .map(({ idx }) => {
                    return {
                        ...element,
                        reprStep: idx
                    };
                });

            return commands.concat(items);
        }

        // Third level, children of reproduction steps
        // There are inner-depth children
        if (
            path[element.reprStep + 1] /* &&
            path[element.reprStep + 1].pathElem.depth > path[element.reprStep].pathElem.depth */
        ) {
            const children = path.slice(element.reprStep + 1);

            /* const startingDepth = path[element.reprStep].pathElem.depth; */
            /* const childDepth = path[element.reprStep + 1].pathElem.depth; */

            const sameLevelIdx = children.findIndex((/* { pathElem } */) => /* pathElem.depth <= startingDepth */ true);

            const items = children.slice(0, sameLevelIdx)
                /* .filter(({ pathElem }) => pathElem.depth <= childDepth) */
                .map(({ idx }) => {
                    return {
                        ...element,
                        reprStep: idx
                    };
                });

            return items;
        }

        // Third level, no inner-depth children
        return [];
    }

    getTreeItem(element: IssueMetadata): TreeItem | Thenable<TreeItem> {
        // Command nodes
        if (element.command !== undefined) {
            const item = new TreeItem(element.description ?? element.command.title);
            item.command = element.command;
            return item;
        }

        // Description nodes, also handles special case with no reports
        if (element.description !== undefined) {
            return new TreeItem(element.description);
        }

        // Invalid nodes, detect early
        if (element.entryIndex === undefined) {
            console.error('Tried to add invalid node to CurrentFileReports tree:', element);
            return new TreeItem('Internal error - invalid node');
        }

        const currentReport = this.currentEntryList![element.entryIndex];
        const steps = currentReport.bug_path_events;

        // First level, report list
        if (element.reprStep === undefined) {
            const currentReportPath = currentReport.file.original_path;

            const fileDescription = currentReportPath === this.currentFile?.fsPath
                ? `[L${currentReport.line}]`
                : `[${basename(currentReportPath)}:${currentReport.line}]`;

            const item = new TreeItem(`${fileDescription} - ${currentReport.message}`);
            item.collapsibleState = TreeItemCollapsibleState.Collapsed;
            item.description = `(${steps.length})`;

            if (currentReportPath !== this.currentFile?.fsPath) {
                item.tooltip = `Full path to file: ${currentReportPath}`;
            }

            return item;
        }

        // Second level, repr steps
        const currentStep = steps[element.reprStep];

        // const stepHasChildren = steps[element.reprStep + 1] && currentStep.depth < steps[element.reprStep + 1].depth;
        const currentStepPath = currentReport.file.original_path;
        const currentStepFile = basename(currentStepPath);

        const item = new TreeItem(
            `${element.reprStep + 1}. [${currentStepFile}:${currentStep.line}] - ${currentStep.message}`
        );
        item.tooltip = `Full path to file: ${currentStepPath}`;
        item.collapsibleState = /* stepHasChildren ? TreeItemCollapsibleState.Expanded :*/TreeItemCollapsibleState.None;
        item.command = {
            title: 'jumpToStep',
            command: 'codechecker.editor.jumpToStep',
            arguments: [this.currentFile, element.entryIndex, element.reprStep, true]
        };

        return item;
    }
}