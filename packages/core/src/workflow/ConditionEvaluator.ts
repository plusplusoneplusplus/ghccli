/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConditionOperator, BooleanExpression } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';

export interface ConditionEvaluationResult {
  result: boolean;
  evaluatedExpression: string;
  error?: string;
}

/**
 * Engine for evaluating conditional expressions and boolean logic
 * Supports variable references, step outputs, and complex boolean operations
 */
export class ConditionEvaluator {
  /**
   * Evaluate a condition expression
   * @param expression The condition or boolean expression to evaluate
   * @param context The workflow context containing variables and step outputs
   * @returns The evaluation result
   */
  async evaluate(
    expression: ConditionOperator | BooleanExpression,
    context: WorkflowContext
  ): Promise<ConditionEvaluationResult> {
    try {
      const result = await this.evaluateExpression(expression, context);
      return {
        result,
        evaluatedExpression: this.expressionToString(expression)
      };
    } catch (error) {
      return {
        result: false,
        evaluatedExpression: this.expressionToString(expression),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Recursively evaluate an expression
   */
  private async evaluateExpression(
    expression: ConditionOperator | BooleanExpression,
    context: WorkflowContext
  ): Promise<boolean> {
    if ('type' in expression) {
      if (['and', 'or', 'not'].includes(expression.type)) {
        return this.evaluateBooleanExpression(expression as BooleanExpression, context);
      } else {
        return this.evaluateConditionOperator(expression as ConditionOperator, context);
      }
    }
    
    throw new Error('Invalid expression format');
  }

  /**
   * Evaluate a boolean expression (AND, OR, NOT)
   */
  private async evaluateBooleanExpression(
    expression: BooleanExpression,
    context: WorkflowContext
  ): Promise<boolean> {
    const { type, conditions } = expression;

    switch (type) {
      case 'and':
        for (const condition of conditions) {
          const result = await this.evaluateExpression(condition, context);
          if (!result) return false;
        }
        return true;

      case 'or':
        for (const condition of conditions) {
          const result = await this.evaluateExpression(condition, context);
          if (result) return true;
        }
        return false;

      case 'not':
        if (conditions.length !== 1) {
          throw new Error('NOT expression must have exactly one condition');
        }
        const result = await this.evaluateExpression(conditions[0], context);
        return !result;

      default:
        throw new Error(`Unknown boolean expression type: ${type}`);
    }
  }

  /**
   * Evaluate a condition operator
   */
  private async evaluateConditionOperator(
    operator: ConditionOperator,
    context: WorkflowContext
  ): Promise<boolean> {
    const leftValue = this.resolveValue(operator.left, context);
    const rightValue = operator.right;

    switch (operator.type) {
      case 'equals':
        return this.compareValues(leftValue, rightValue, 'equals');

      case 'not_equals':
        return !this.compareValues(leftValue, rightValue, 'equals');

      case 'contains':
        return this.compareValues(leftValue, rightValue, 'contains');

      case 'not_contains':
        return !this.compareValues(leftValue, rightValue, 'contains');

      case 'exists':
        return leftValue !== undefined && leftValue !== null;

      case 'not_exists':
        return leftValue === undefined || leftValue === null;

      case 'greater_than':
        return this.compareValues(leftValue, rightValue, 'greater_than');

      case 'less_than':
        return this.compareValues(leftValue, rightValue, 'less_than');

      case 'greater_than_or_equal':
        return this.compareValues(leftValue, rightValue, 'greater_than_or_equal');

      case 'less_than_or_equal':
        return this.compareValues(leftValue, rightValue, 'less_than_or_equal');

      case 'matches':
        return this.compareValues(leftValue, rightValue, 'matches');

      case 'not_matches':
        return !this.compareValues(leftValue, rightValue, 'matches');

      default:
        throw new Error(`Unknown condition operator: ${(operator as any).type}`);
    }
  }

  /**
   * Resolve a value reference to its actual value
   * Supports variable references ({{variable.name}}) and step output references ({{steps.stepId.property}})
   */
  private resolveValue(valueRef: string, context: WorkflowContext): unknown {
    // Check if it's a variable reference
    if (valueRef.startsWith('{{') && valueRef.endsWith('}}')) {
      const path = valueRef.slice(2, -2).trim();
      
      // Handle step output references
      if (path.startsWith('steps.')) {
        const stepPath = path.substring(6); // Remove 'steps.'
        const [stepId, ...propertyParts] = stepPath.split('.');
        const stepOutput = context.getStepOutput(stepId);
        
        if (propertyParts.length === 0) {
          return stepOutput;
        }
        
        return this.getNestedValue(stepOutput, propertyParts.join('.'));
      }
      
      // Handle variable references
      const variables = context.getVariables();
      return this.getNestedValue(variables, path);
    }
    
    // Return as literal value if not a reference
    return valueRef;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    if (!path) return obj;
    
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' ? current[key] : undefined;
    }, obj);
  }

  /**
   * Compare two values using the specified comparison type
   */
  private compareValues(left: unknown, right: unknown, comparison: string): boolean {
    switch (comparison) {
      case 'equals':
        return left === right;

      case 'contains':
        if (typeof left === 'string' && typeof right === 'string') {
          return left.includes(right);
        }
        if (Array.isArray(left)) {
          return left.includes(right);
        }
        if (typeof left === 'object' && left !== null && typeof right === 'string') {
          return Object.prototype.hasOwnProperty.call(left, right);
        }
        return false;

      case 'greater_than':
        if (typeof left === 'number' && typeof right === 'number') {
          return left > right;
        }
        if (typeof left === 'string' && typeof right === 'string') {
          return left > right;
        }
        throw new Error(`Cannot compare ${typeof left} with ${typeof right} using greater_than`);

      case 'less_than':
        if (typeof left === 'number' && typeof right === 'number') {
          return left < right;
        }
        if (typeof left === 'string' && typeof right === 'string') {
          return left < right;
        }
        throw new Error(`Cannot compare ${typeof left} with ${typeof right} using less_than`);

      case 'greater_than_or_equal':
        if (typeof left === 'number' && typeof right === 'number') {
          return left >= right;
        }
        if (typeof left === 'string' && typeof right === 'string') {
          return left >= right;
        }
        throw new Error(`Cannot compare ${typeof left} with ${typeof right} using greater_than_or_equal`);

      case 'less_than_or_equal':
        if (typeof left === 'number' && typeof right === 'number') {
          return left <= right;
        }
        if (typeof left === 'string' && typeof right === 'string') {
          return left <= right;
        }
        throw new Error(`Cannot compare ${typeof left} with ${typeof right} using less_than_or_equal`);

      case 'matches':
        if (typeof left === 'string' && typeof right === 'string') {
          try {
            const regex = new RegExp(right);
            return regex.test(left);
          } catch (error) {
            throw new Error(`Invalid regex pattern: ${right}`);
          }
        }
        throw new Error(`Cannot use regex matching on ${typeof left} with ${typeof right}`);

      default:
        throw new Error(`Unknown comparison type: ${comparison}`);
    }
  }

  /**
   * Convert an expression to a readable string representation
   */
  private expressionToString(expression: ConditionOperator | BooleanExpression): string {
    if ('type' in expression && ['and', 'or', 'not'].includes(expression.type)) {
      const boolExpr = expression as BooleanExpression;
      const conditionStrings = boolExpr.conditions.map(c => this.expressionToString(c));
      
      switch (boolExpr.type) {
        case 'and':
          return `(${conditionStrings.join(' AND ')})`;
        case 'or':
          return `(${conditionStrings.join(' OR ')})`;
        case 'not':
          return `NOT(${conditionStrings[0]})`;
        default:
          return 'unknown';
      }
    } else {
      const condExpr = expression as ConditionOperator;
      const rightStr = condExpr.right !== undefined ? JSON.stringify(condExpr.right) : '';
      return `${condExpr.left} ${condExpr.type} ${rightStr}`.trim();
    }
  }
}