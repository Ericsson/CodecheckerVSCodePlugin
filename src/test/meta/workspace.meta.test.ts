import * as assert from 'assert';
import { workspace } from 'vscode';
import { STATIC_WORKSPACE_PATH } from '../utils/constants';

suite('Meta Test: Workspace setup', () => {
    test('Active workspace set correctly', () => {
        assert.strictEqual(
            workspace.workspaceFolders && workspace.workspaceFolders[0]?.uri.fsPath,
            STATIC_WORKSPACE_PATH,
            'Please run the tests inside the staticFiles workspace'
        );
    });
});