/**
 * @module ValidationTypes
 * @description Common validation types and interfaces
 */

/**
 * Validation rule definition
 */
export interface ResourceValidationRule {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly severity: 'error' | 'warning' | 'info';
    readonly validate: (filePath: string, content: string, context?: any) => Promise<ValidationRuleResult>;
}

/**
 * Result of a validation rule execution
 */
export interface ValidationRuleResult {
    readonly isValid: boolean;
    readonly errors: readonly string[];
    readonly warnings: readonly string[];
    readonly suggestions?: readonly string[];
}

/**
 * Validation issue found during validation
 */
export interface ValidationIssue {
    readonly ruleId: string;
    readonly severity: 'error' | 'warning' | 'info';
    readonly message: string;
    readonly filePath?: string;
    readonly line?: number;
    readonly column?: number;
    readonly suggestion?: string;
}

/**
 * Overall validation result for a resource
 */
export interface ResourceValidationResult {
    readonly isValid: boolean;
    readonly errors: readonly ValidationIssue[];
    readonly warnings: readonly ValidationIssue[];
    readonly info: readonly ValidationIssue[];
    readonly summary: {
        readonly totalIssues: number;
        readonly errorCount: number;
        readonly warningCount: number;
        readonly infoCount: number;
    };
}
