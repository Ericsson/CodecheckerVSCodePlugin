import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { MetadataParseError, parseMetadata } from '../../backend/parser';
import { STATIC_FILE_PATH } from '../utils/constants';

suite('Unit Test: Metadata Parser', () => {
    const staticPath = path.join(STATIC_FILE_PATH, 'metadata');

    suiteSetup('required files', async function () {
        try {
            await promisify(fs.access)(staticPath);
        } catch (_) {
            // Skip all tests if the requires files are not found
            this.skip();
        }
    });

    test('v2.json', async () => {
        const file = await parseMetadata(path.join(staticPath, 'v2.json'));

        // Check cherry-picked members
        const tool = file.tools[0];
        assert.ok(tool !== undefined);
        assert.strictEqual(tool.name, 'codechecker');

        assert.ok(tool.result_source_files !== undefined);
        assert.ok(tool.analyzers !== undefined);
        assert.ok(tool.timestamps !== undefined);
    });

    test('v1.json', async () => {
        const file = await parseMetadata(path.join(staticPath, 'v1.json'));
        const expected = await parseMetadata(path.join(staticPath, 'v1.expected.json'));

        assert.deepStrictEqual(file, expected, 'failed to convert v1.json');
    });

    test('invalid files', async () => {
        const testAndExpectCode = async (filename: string, code: string) => {
            await assert.rejects(
                () => parseMetadata(path.join(staticPath, filename)),
                (err: MetadataParseError) => {
                    assert.strictEqual(err.code, code, 'wrong error code');
                    return true;
                },
                `read invalid file ${filename}`
            );
        };
        const testAndExpectSyntaxError = async (filename: string) => {
            await assert.rejects(
                () => parseMetadata(path.join(staticPath, filename)),
                (err: MetadataParseError) => {
                    assert.ok(err instanceof SyntaxError, 'wrong error type');
                    return true;
                },
                `read invalid file ${filename}`
            );
        };

        await testAndExpectCode('not_found.json', 'FileNotFound');
        await testAndExpectCode('invalid_version.json', 'UnsupportedVersion');

        await testAndExpectSyntaxError('empty.json');
        await testAndExpectSyntaxError('invalid_members.json');
        await testAndExpectSyntaxError('json_error.txt'); // .txt to avoid misleading syntax error in VSCode
    });
});