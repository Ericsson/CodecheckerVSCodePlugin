import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

import { runTests } from 'vscode-test';
import { STATIC_WORKSPACE_PATH } from './utils/constants';
import { promisify } from 'util';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to test runner
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        console.error('Tests workspace folder:', STATIC_WORKSPACE_PATH);

        // Run CodeChecker on the test workspace first, to get the compile database, and initial files
        const logResult = spawnSync(
            'CodeChecker log -b "make" -o ./compile_commands.json',
            { cwd: STATIC_WORKSPACE_PATH, shell: true, stdio: 'inherit' }
        );

        if (logResult.status !== 0) {
            console.error('CodeChecker log failed to run on initial folder');
            console.error(logResult);
            throw logResult.error;
        } else {
            console.error('CodeChecker log ran successfully on initial folder');
        }

        const analyzeResult = spawnSync(
            'CodeChecker analyze ./compile_commands.json -o ./.codechecker/reports',
            { cwd: STATIC_WORKSPACE_PATH, shell: true, stdio: 'inherit' }
        );

        if (analyzeResult.status !== 0) {
            console.error('CodeChecker analyze failed to run on initial folder');
            console.error(analyzeResult);
            throw analyzeResult.error;
        } else {
            console.log('CodeChecker analyze ran successfully on initial folder');
        }

        const settingsPath = path.join(STATIC_WORKSPACE_PATH, '.vscode');

        if (await promisify(fs.exists)(settingsPath)) {
            await promisify(fs.rmdir)(settingsPath, { recursive: true });
        }

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [STATIC_WORKSPACE_PATH]
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();
