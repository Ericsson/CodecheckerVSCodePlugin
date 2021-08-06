import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { promisify } from 'util';

import { parseDiagnostics } from '../../backend/parser/diagnostics';
import { AnalysisPathEvent, AnalysisPathKind } from '../../backend/types';
import { STATIC_FILE_PATH } from '../utils/constants';

suite('Unit Test: Diagnostics parser', () => {
    const staticPath = path.join(STATIC_FILE_PATH, 'diagnostics');

    suiteSetup('required files', async function () {
        try {
            await promisify(fs.access)(staticPath);
        } catch (_) {
            // Skip all tests if the requires files are not found
            this.skip();
        }
    });

    test('parses generated diagnostics', async () => {
        const asyncGlob = promisify(glob);
        const generatedFiles = await asyncGlob(path.join(staticPath, '*.plist'));

        for (const plistFile of generatedFiles) {
            const parsedFile = await parseDiagnostics(plistFile);

            assert.ok(parsedFile.files !== undefined);
            assert.ok(parsedFile.diagnostics !== undefined);

            const fileCount = parsedFile.files.length;

            for (const diagnostic of parsedFile.diagnostics) {
                assert.strictEqual(diagnostic.files, parsedFile.files, 'Files array should be reused');

                assert.ok(diagnostic.location.file < fileCount, 'Diagnostic in invalid file');
                assert.ok(diagnostic.path.every(pathEntry => {
                    switch (pathEntry.kind) {
                    case AnalysisPathKind.Control: return true;
                    case AnalysisPathKind.Event: return true;
                    default: return false;
                    }
                }), 'Diagnostic path contains unknown nodes - check CodeChecker version');

                const pathNodes = diagnostic.path
                    .filter(entry => entry.kind === AnalysisPathKind.Event) as AnalysisPathEvent[];

                // Assumed inside Editor.diagnosticRenderer
                assert.ok(pathNodes.length > 0, 'Assumes that the last element of the path is the error');
                assert.strictEqual(
                    pathNodes[pathNodes.length - 1].message,
                    diagnostic.description,
                    'Assumes that the last element of the path is the error'
                );
            }
        }
    });

    test('returns FileNotFound on invalid path', async () => {
        const testAndExpectCode = async (filename: string, code: string) => {
            await assert.rejects(
                () => parseDiagnostics(path.join(staticPath, filename)),
                (err) => {
                    assert.strictEqual(err.code, code, 'wrong error code');
                    return true;
                },
                `read invalid file ${filename}`
            );
        };

        await testAndExpectCode('not_found.plist', 'FileNotFound');
        await testAndExpectCode(path.join('invalid_folder', 'not_found.plist'), 'FileNotFound');
    });
});