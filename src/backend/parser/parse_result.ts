import { ParseResult } from '../types';

export function parseDiagnostics(data: string): ParseResult {

    const parsedContents = JSON.parse(data);

    if (parsedContents.version === undefined) {
        throw new SyntaxError('Invalid output of CodeChecker parse');
    } if (parsedContents.version !== 1) {
        throw new SyntaxError(`Version ${parsedContents.version} not supported`);
    }

    return parsedContents as ParseResult;
}
