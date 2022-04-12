import * as assert from 'assert';
import * as path from 'path';
const sinon = require('sinon');
import { Range, Uri, commands, extensions, languages, window } from 'vscode';
import { DiagnosticsApi } from '../../backend/processor';
import { DiagnosticRenderer } from '../../editor';
import { CodeLensStepsProvider } from '../../editor/codelens';
import { CodeCheckerExtension } from '../../extension';
import { STATIC_WORKSPACE_PATH } from '../utils/constants';
import { openFileWithEvent, waitForEvent, wrapWithEvent } from '../utils/events';
import { closeAllTabs } from '../utils/files';

suite('Functional Test: Frontend - Editor', () => {
    let extensionMembers: CodeCheckerExtension;
    let codeLensStepsProvider: CodeLensStepsProvider;
    let diagnosticRenderer: DiagnosticRenderer;
    let diagnosticsApi: DiagnosticsApi;
    const filePath = path.join(STATIC_WORKSPACE_PATH, 'file.cpp');
    const headerPath = path.join(STATIC_WORKSPACE_PATH, 'file.h');


    suiteSetup('Load extension', async function() {
        await closeAllTabs();
        extensionMembers = await extensions.getExtension('codechecker.codechecker')!.activate();
        codeLensStepsProvider = extensionMembers.editor.codeLensStepsProvider;
        diagnosticRenderer = extensionMembers.editor.diagnosticRenderer;
        diagnosticsApi = extensionMembers.extensionApi.diagnostics;
    });

    teardown('Close leftover tabs', async function() {
        await closeAllTabs();
    });

    test('Diagnostics show up in the editor', async function() {
        const diagnosticSpy = sinon.spy(diagnosticRenderer, 'updateAllDiagnostics');

        // Fires on all diagnostic changes
        await openFileWithEvent(languages.onDidChangeDiagnostics, filePath);

        assert.ok(diagnosticSpy.called, 'updateAllDiagnostics not called');

        const diagnostics = languages.getDiagnostics(Uri.file(filePath));
        assert.ok(diagnostics.length > 0, 'Diagnostics do not show up in the editor');
    });

    test('Diagnostics updates on file switch', async function() {
        await openFileWithEvent(languages.onDidChangeDiagnostics, headerPath);

        // Diagnostics change event is inaccurate here, wait for DiagnosticsApi reload instead
        // Note: Can catch residual events from closing the previous file...
        await openFileWithEvent(diagnosticsApi.diagnosticsUpdated, filePath);

        // ...so make sure at least some diagnostics are loaded by this point
        while (diagnosticsApi['_diagnosticEntries'].size === 0) {
            await waitForEvent(diagnosticsApi.diagnosticsUpdated);
        }

        const diagnostics = languages.getDiagnostics(Uri.file(filePath));
        assert.ok(diagnostics.length > 0, 'Diagnostics not loaded after file switch');
    }).timeout(5000);

    test('Showing repr.steps shows CodeLens, hide removes them', async function() {
        // TODO: Find a way to get custom decorations in an opened file
        await openFileWithEvent(languages.onDidChangeDiagnostics, filePath);

        await wrapWithEvent(
            codeLensStepsProvider.onDidChangeCodeLenses,
            async () => await commands.executeCommand('codechecker.editor.toggleSteps', filePath, 0, true)
        );

        await wrapWithEvent(
            codeLensStepsProvider.onDidChangeCodeLenses,
            async () => await commands.executeCommand('codechecker.editor.toggleSteps', filePath, 0, false)
        );
    });

    test('Navigation commands, in same file as well as between different files', async function() {
        // The path of this division by zero has 6 steps, with steps 3-4 in main.h, rest in main.cpp
        const changePositionViaCommand = async (command: string, ...params: any[]) => {
            await wrapWithEvent(
                window.onDidChangeTextEditorSelection,
                async () => await commands.executeCommand(command, ...params)
            );
        };

        await openFileWithEvent(diagnosticsApi.diagnosticsUpdated, filePath);

        await window.showTextDocument(Uri.file(filePath), { selection: new Range(0, 0, 0, 0) });

        await wrapWithEvent(
            codeLensStepsProvider.onDidChangeCodeLenses,
            async () => await commands.executeCommand('codechecker.editor.toggleSteps', filePath, 0, true)
        );

        assert.strictEqual(
            diagnosticsApi.selectedEntry?.diagnostic.message,
            'Division by zero',
            'Unexpected CodeChecker results, the test needs updating'
        );

        const positions: [string, number, number][] = [
            [filePath, 3, 17], // Passing 0
            [filePath, 3, 13], // Entering call
            [headerPath, 3, 0], // Entered call
            [headerPath, 4, 2], // Returning zero
            [filePath, 3, 13], // Returning from foo - same position as Entering call (issue #86)
            [filePath, 3, 11] // Entered call
        ];

        const assertPosition = (idx: number) => {
            const [file, line, col] = positions[idx];

            assert.strictEqual(
                window.activeTextEditor?.document.uri.fsPath,
                file,
                'File mismatch on step ' + idx
            );
            assert.strictEqual(
                window.activeTextEditor?.selection.active.line,
                line,
                'Line mismatch on step ' + idx
            );
            assert.strictEqual(
                window.activeTextEditor?.selection.active.character,
                col,
                'Column mismatch on step ' + idx
            );
        };

        // Report position is the same as step 5 in this case
        await changePositionViaCommand('codechecker.editor.jumpToReport', filePath, 0);
        assertPosition(5);

        await changePositionViaCommand('codechecker.editor.jumpToStep', filePath, 0, 0);
        assertPosition(0);

        // Step forwards all the way
        for (let idx = 1; idx < positions.length; idx++) {
            await changePositionViaCommand('codechecker.editor.nextStep');
            assertPosition(idx);
        }

        // And then backwards all the way
        for (let idx = positions.length - 2; idx >= 0; idx--) {
            await changePositionViaCommand('codechecker.editor.previousStep');
            assertPosition(idx);
        }

        // closeAllTabs handles all resulting events
        await commands.executeCommand('codechecker.editor.toggleSteps', filePath, 0, false);
    }).timeout(8000);
});
