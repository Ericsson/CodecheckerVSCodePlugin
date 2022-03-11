import * as assert from 'assert';
import * as path from 'path';
import { Uri, commands, extensions } from 'vscode';
import { DiagnosticsApi, MetadataApi } from '../../backend/processor';
import { CodeCheckerExtension } from '../../extension';
import { STATIC_WORKSPACE_PATH } from '../utils/constants';
import { openFileWithEvent, waitForEvent } from '../utils/events';
import { closeAllTabs } from '../utils/files';

suite('Functional Test: Backend - Processor', () => {
    let extensionMembers: CodeCheckerExtension;
    let metadataApi: MetadataApi;
    let diagnosticsApi: DiagnosticsApi;

    const filePath = path.join(STATIC_WORKSPACE_PATH, 'file.cpp');
    const headerPath = path.join(STATIC_WORKSPACE_PATH, 'file.h');

    suiteSetup('Load extension', async function() {
        await closeAllTabs();
        extensionMembers = await extensions.getExtension('codechecker.codechecker')!.activate();
        metadataApi = extensionMembers.extensionApi.metadata;
        diagnosticsApi = extensionMembers.extensionApi.diagnostics;
    });

    teardown('Close leftover tabs', async function() {
        await closeAllTabs();
    });

    test('Fresh CodeChecker metadata is analyzed correctly', async function() {
        await openFileWithEvent(diagnosticsApi.diagnosticsUpdated, filePath);

        // Assuming an analysis is already created for us
        assert.ok(metadataApi.metadata !== undefined, 'Failed to read fresh CodeChecker metadata');
        assert.ok(diagnosticsApi['_diagnosticEntries'].size > 0, 'Failed to load fresh CodeChecker diagnostics');
    });

    test('Reload metadata command', async function() {
        await openFileWithEvent(diagnosticsApi.diagnosticsUpdated, filePath);

        const metadataEvent = waitForEvent(metadataApi.metadataUpdated);
        const diagnosticsEvent = waitForEvent(diagnosticsApi.diagnosticsUpdated);

        await commands.executeCommand('codechecker.backend.reloadMetadata');

        const eventData = await metadataEvent;
        assert.ok(eventData !== undefined, 'Failed to read fresh CodeChecker metadata');

        await diagnosticsEvent;
        assert.ok(diagnosticsApi['_diagnosticEntries'].size > 0, 'Failed to load fresh CodeChecker diagnostics');
    });

    test('Diagnostics provides data for opened file', async function() {
        await openFileWithEvent(diagnosticsApi.diagnosticsUpdated, filePath);

        const fileDiagnostics = diagnosticsApi.getFileDiagnostics(Uri.file(filePath));

        assert.ok(fileDiagnostics.length > 0, 'No data for current file');

        for (const diagnostic of fileDiagnostics) {
            assert.strictEqual(diagnostic.file.original_path, filePath, 'Diagnostics returns reports from wrong files');
        }
    });

    test('Switching files does not clear selected entry', async function() {
        await openFileWithEvent(diagnosticsApi.diagnosticsUpdated, filePath);

        diagnosticsApi.setSelectedEntry({ file: filePath, idx: 0 });
        assert.ok(diagnosticsApi.selectedEntry !== undefined, 'Selected entry cannot be set');

        await openFileWithEvent(diagnosticsApi.diagnosticsUpdated, headerPath);

        assert.ok(diagnosticsApi.selectedEntry !== undefined, 'Selected entry cleared on file switch');
    });
});
