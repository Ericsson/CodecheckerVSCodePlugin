export interface CheckerData {
    readonly status: 'enabled' | 'disabled' | 'unknown';
    readonly name: string;
    readonly analyzer: string;
    readonly description: string;
    readonly labels: string[];
}
