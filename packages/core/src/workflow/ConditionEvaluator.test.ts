/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConditionEvaluator } from './ConditionEvaluator.js';
import { ConditionOperator, BooleanExpression } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';

describe('ConditionEvaluator', () => {
  let evaluator: ConditionEvaluator;
  let context: WorkflowContext;

  beforeEach(() => {
    evaluator = new ConditionEvaluator();
    context = new WorkflowContext('test-workflow', {
      testVar: 'hello',
      numberVar: 42,
      arrayVar: ['a', 'b', 'c'],
      nested: {
        prop: 'nested-value',
        count: 10
      }
    });
    
    // Add some step outputs
    context.setStepOutput('step1', { result: 'success', code: 0 });
    context.setStepOutput('step2', { result: 'failed', code: 1, error: 'Something went wrong' });
  });

  describe('Basic Condition Operators', () => {
    it('should evaluate equals operator correctly', async () => {
      const condition: ConditionOperator = {
        type: 'equals',
        left: '{{testVar}}',
        right: 'hello'
      };

      const result = await evaluator.evaluate(condition, context);
      expect(result.result).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should evaluate not_equals operator correctly', async () => {
      const condition: ConditionOperator = {
        type: 'not_equals',
        left: '{{testVar}}',
        right: 'goodbye'
      };

      const result = await evaluator.evaluate(condition, context);
      expect(result.result).toBe(true);
    });

    it('should evaluate contains operator for strings', async () => {
      const condition: ConditionOperator = {
        type: 'contains',
        left: '{{testVar}}',
        right: 'ell'
      };

      const result = await evaluator.evaluate(condition, context);
      expect(result.result).toBe(true);
    });

    it('should evaluate contains operator for arrays', async () => {
      const condition: ConditionOperator = {
        type: 'contains',
        left: '{{arrayVar}}',
        right: 'b'
      };

      const result = await evaluator.evaluate(condition, context);
      expect(result.result).toBe(true);
    });

    it('should evaluate exists operator correctly', async () => {
      const existingCondition: ConditionOperator = {
        type: 'exists',
        left: '{{testVar}}'
      };

      const nonExistingCondition: ConditionOperator = {
        type: 'exists',
        left: '{{nonExistentVar}}'
      };

      const existingResult = await evaluator.evaluate(existingCondition, context);
      const nonExistingResult = await evaluator.evaluate(nonExistingCondition, context);

      expect(existingResult.result).toBe(true);
      expect(nonExistingResult.result).toBe(false);
    });

    it('should evaluate numeric comparison operators', async () => {
      const greaterThan: ConditionOperator = {
        type: 'greater_than',
        left: '{{numberVar}}',
        right: 40
      };

      const lessThan: ConditionOperator = {
        type: 'less_than',
        left: '{{numberVar}}',
        right: 50
      };

      const gtResult = await evaluator.evaluate(greaterThan, context);
      const ltResult = await evaluator.evaluate(lessThan, context);

      expect(gtResult.result).toBe(true);
      expect(ltResult.result).toBe(true);
    });

    it('should evaluate regex matches operator', async () => {
      const matchesCondition: ConditionOperator = {
        type: 'matches',
        left: '{{testVar}}',
        right: '^h.*o$'
      };

      const result = await evaluator.evaluate(matchesCondition, context);
      expect(result.result).toBe(true);
    });
  });

  describe('Variable and Step Output Resolution', () => {
    it('should resolve nested variable references', async () => {
      const condition: ConditionOperator = {
        type: 'equals',
        left: '{{nested.prop}}',
        right: 'nested-value'
      };

      const result = await evaluator.evaluate(condition, context);
      expect(result.result).toBe(true);
    });

    it('should resolve step output references', async () => {
      const condition: ConditionOperator = {
        type: 'equals',
        left: '{{steps.step1.result}}',
        right: 'success'
      };

      const result = await evaluator.evaluate(condition, context);
      expect(result.result).toBe(true);
    });

    it('should resolve nested step output references', async () => {
      const condition: ConditionOperator = {
        type: 'equals',
        left: '{{steps.step2.code}}',
        right: 1
      };

      const result = await evaluator.evaluate(condition, context);
      expect(result.result).toBe(true);
    });

    it('should handle literal values (non-references)', async () => {
      const condition: ConditionOperator = {
        type: 'equals',
        left: 'literal-string',
        right: 'literal-string'
      };

      const result = await evaluator.evaluate(condition, context);
      expect(result.result).toBe(true);
    });
  });

  describe('Boolean Expressions', () => {
    it('should evaluate AND expressions correctly', async () => {
      const andExpression: BooleanExpression = {
        type: 'and',
        conditions: [
          {
            type: 'equals',
            left: '{{testVar}}',
            right: 'hello'
          },
          {
            type: 'greater_than',
            left: '{{numberVar}}',
            right: 40
          }
        ]
      };

      const result = await evaluator.evaluate(andExpression, context);
      expect(result.result).toBe(true);
    });

    it('should evaluate OR expressions correctly', async () => {
      const orExpression: BooleanExpression = {
        type: 'or',
        conditions: [
          {
            type: 'equals',
            left: '{{testVar}}',
            right: 'goodbye'
          },
          {
            type: 'greater_than',
            left: '{{numberVar}}',
            right: 40
          }
        ]
      };

      const result = await evaluator.evaluate(orExpression, context);
      expect(result.result).toBe(true);
    });

    it('should evaluate NOT expressions correctly', async () => {
      const notExpression: BooleanExpression = {
        type: 'not',
        conditions: [
          {
            type: 'equals',
            left: '{{testVar}}',
            right: 'goodbye'
          }
        ]
      };

      const result = await evaluator.evaluate(notExpression, context);
      expect(result.result).toBe(true);
    });

    it('should evaluate nested boolean expressions', async () => {
      const nestedExpression: BooleanExpression = {
        type: 'and',
        conditions: [
          {
            type: 'equals',
            left: '{{testVar}}',
            right: 'hello'
          },
          {
            type: 'or',
            conditions: [
              {
                type: 'equals',
                left: '{{steps.step1.result}}',
                right: 'success'
              },
              {
                type: 'greater_than',
                left: '{{numberVar}}',
                right: 100
              }
            ]
          }
        ]
      };

      const result = await evaluator.evaluate(nestedExpression, context);
      expect(result.result).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid regex patterns gracefully', async () => {
      const invalidRegexCondition: ConditionOperator = {
        type: 'matches',
        left: '{{testVar}}',
        right: '[invalid-regex'
      };

      const result = await evaluator.evaluate(invalidRegexCondition, context);
      expect(result.result).toBe(false);
      expect(result.error).toContain('Invalid regex pattern');
    });

    it('should handle type mismatches in comparisons', async () => {
      const invalidComparison: ConditionOperator = {
        type: 'greater_than',
        left: '{{testVar}}',
        right: 42
      };

      const result = await evaluator.evaluate(invalidComparison, context);
      expect(result.result).toBe(false);
      expect(result.error).toContain('Cannot compare');
    });

    it('should handle undefined variable references', async () => {
      const undefinedVarCondition: ConditionOperator = {
        type: 'equals',
        left: '{{undefinedVar}}',
        right: 'test'
      };

      const result = await evaluator.evaluate(undefinedVarCondition, context);
      expect(result.result).toBe(false);
    });

    it('should handle undefined step output references', async () => {
      const undefinedStepCondition: ConditionOperator = {
        type: 'equals',
        left: '{{steps.nonExistentStep.result}}',
        right: 'test'
      };

      const result = await evaluator.evaluate(undefinedStepCondition, context);
      expect(result.result).toBe(false);
    });
  });

  describe('Expression String Representation', () => {
    it('should generate readable strings for condition operators', async () => {
      const condition: ConditionOperator = {
        type: 'equals',
        left: '{{testVar}}',
        right: 'hello'
      };

      const result = await evaluator.evaluate(condition, context);
      expect(result.evaluatedExpression).toContain('{{testVar}} equals "hello"');
    });

    it('should generate readable strings for boolean expressions', async () => {
      const booleanExpr: BooleanExpression = {
        type: 'and',
        conditions: [
          {
            type: 'equals',
            left: '{{testVar}}',
            right: 'hello'
          },
          {
            type: 'exists',
            left: '{{numberVar}}'
          }
        ]
      };

      const result = await evaluator.evaluate(booleanExpr, context);
      expect(result.evaluatedExpression).toContain('AND');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined values correctly', async () => {
      context.setVariable('nullVar', null);
      context.setVariable('undefinedVar', undefined);

      const nullExistsCondition: ConditionOperator = {
        type: 'exists',
        left: '{{nullVar}}'
      };

      const undefinedExistsCondition: ConditionOperator = {
        type: 'exists',
        left: '{{undefinedVar}}'
      };

      const nullResult = await evaluator.evaluate(nullExistsCondition, context);
      const undefinedResult = await evaluator.evaluate(undefinedExistsCondition, context);

      expect(nullResult.result).toBe(false);
      expect(undefinedResult.result).toBe(false);
    });

    it('should handle empty arrays and strings', async () => {
      context.setVariable('emptyArray', []);
      context.setVariable('emptyString', '');

      const emptyArrayCondition: ConditionOperator = {
        type: 'contains',
        left: '{{emptyArray}}',
        right: 'anything'
      };

      const emptyStringCondition: ConditionOperator = {
        type: 'contains',
        left: '{{emptyString}}',
        right: 'anything'
      };

      const arrayResult = await evaluator.evaluate(emptyArrayCondition, context);
      const stringResult = await evaluator.evaluate(emptyStringCondition, context);

      expect(arrayResult.result).toBe(false);
      expect(stringResult.result).toBe(false);
    });

    it('should handle deep nested object references', async () => {
      context.setVariable('deepObject', {
        level1: {
          level2: {
            level3: {
              value: 'deep-value'
            }
          }
        }
      });

      const deepCondition: ConditionOperator = {
        type: 'equals',
        left: '{{deepObject.level1.level2.level3.value}}',
        right: 'deep-value'
      };

      const result = await evaluator.evaluate(deepCondition, context);
      expect(result.result).toBe(true);
    });
  });
});