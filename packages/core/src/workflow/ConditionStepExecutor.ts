/**
 * @license
 * Copyright 2025 Yiheng Tao
 * SPDX-License-Identifier: Apache-2.0
 */

import { WorkflowStep, ConditionConfig } from './types.js';
import { WorkflowContext } from './WorkflowContext.js';
import { StepExecutor } from './StepExecutor.js';
import { ConditionEvaluator, ConditionEvaluationResult } from './ConditionEvaluator.js';

export interface ConditionExecutionResult {
  conditionResult: boolean;
  evaluatedExpression: string;
  triggeredSteps: string[];
  executionTime: number;
  evaluationError?: string;
}

/**
 * Executor for condition-type workflow steps
 * Evaluates conditional expressions and determines which steps should execute next
 */
export class ConditionStepExecutor extends StepExecutor {
  private conditionEvaluator: ConditionEvaluator;

  constructor() {
    super();
    this.conditionEvaluator = new ConditionEvaluator();
  }

  getSupportedType(): string {
    return 'condition';
  }

  validate(step: WorkflowStep): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (step.type !== 'condition') {
      errors.push(`Invalid step type: expected 'condition', got '${step.type}'`);
    }

    const config = step.config as ConditionConfig;
    if (!config.expression) {
      errors.push('Condition step must have an expression');
    }

    // Validate expression structure
    if (config.expression) {
      const expressionValidation = this.validateExpression(config.expression);
      if (!expressionValidation.valid) {
        errors.push(...expressionValidation.errors);
      }
    }

    // Validate onTrue and onFalse arrays
    if (config.onTrue && !Array.isArray(config.onTrue)) {
      errors.push('onTrue must be an array of step IDs');
    }

    if (config.onFalse && !Array.isArray(config.onFalse)) {
      errors.push('onFalse must be an array of step IDs');
    }

    if (config.onTrue && Array.isArray(config.onTrue) && config.onTrue.some(stepId => typeof stepId !== 'string')) {
      errors.push('All step IDs in onTrue must be strings');
    }

    if (config.onFalse && Array.isArray(config.onFalse) && config.onFalse.some(stepId => typeof stepId !== 'string')) {
      errors.push('All step IDs in onFalse must be strings');
    }

    // Warn if neither onTrue nor onFalse is specified
    if (!config.onTrue && !config.onFalse) {
      errors.push('Condition step should specify either onTrue or onFalse (or both)');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async execute(step: WorkflowStep, context: WorkflowContext): Promise<ConditionExecutionResult> {
    const config = step.config as ConditionConfig;
    const startTime = Date.now();

    try {
      // Evaluate the condition
      const evaluationResult: ConditionEvaluationResult = await this.conditionEvaluator.evaluate(
        config.expression,
        context
      );

      // Determine which steps should be triggered
      const triggeredSteps: string[] = [];
      if (evaluationResult.result && config.onTrue) {
        triggeredSteps.push(...config.onTrue);
      } else if (!evaluationResult.result && config.onFalse) {
        triggeredSteps.push(...config.onFalse);
      }

      // Store the condition result in context for potential use by other steps
      context.setVariable(`condition_${step.id}_result`, evaluationResult.result);
      context.setVariable(`condition_${step.id}_triggered_steps`, triggeredSteps);

      const result: ConditionExecutionResult = {
        conditionResult: evaluationResult.result,
        evaluatedExpression: evaluationResult.evaluatedExpression,
        triggeredSteps,
        executionTime: Date.now() - startTime,
        evaluationError: evaluationResult.error
      };

      // If there was an evaluation error but continueOnError is true, don't throw
      if (evaluationResult.error && !config.continueOnError) {
        throw new Error(`Condition evaluation failed: ${evaluationResult.error}`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // If continueOnError is true, return a result with the error instead of throwing
      if (config.continueOnError) {
        context.log(`Condition evaluation error (continuing): ${errorMessage}`, 'warn');
        return {
          conditionResult: false,
          evaluatedExpression: 'error',
          triggeredSteps: config.onFalse || [],
          executionTime: Date.now() - startTime,
          evaluationError: errorMessage
        };
      }
      
      throw new Error(`Condition execution failed: ${errorMessage}`);
    }
  }

  /**
   * Validate the structure of a condition expression
   */
  private validateExpression(expression: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!expression || typeof expression !== 'object') {
      errors.push('Expression must be an object');
      return { valid: false, errors };
    }

    if (!expression.type) {
      errors.push('Expression must have a type');
      return { valid: false, errors };
    }

    // Validate boolean expressions
    if (['and', 'or', 'not'].includes(expression.type)) {
      if (!Array.isArray(expression.conditions)) {
        errors.push('Boolean expression must have a conditions array');
      } else {
        if (expression.type === 'not' && expression.conditions.length !== 1) {
          errors.push('NOT expression must have exactly one condition');
        }
        
        // Recursively validate nested conditions
        for (let i = 0; i < expression.conditions.length; i++) {
          const nestedValidation = this.validateExpression(expression.conditions[i]);
          if (!nestedValidation.valid) {
            errors.push(...nestedValidation.errors.map(err => `conditions[${i}]: ${err}`));
          }
        }
      }
    }
    // Validate condition operators
    else if ([
      'equals', 'not_equals', 'contains', 'not_contains', 'exists', 'not_exists',
      'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal',
      'matches', 'not_matches'
    ].includes(expression.type)) {
      if (!expression.left) {
        errors.push('Condition operator must have a left operand');
      }
      
      if (typeof expression.left !== 'string') {
        errors.push('Left operand must be a string (variable or step reference)');
      }
      
      // For operators that require a right operand
      if (['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 
           'greater_than_or_equal', 'less_than_or_equal', 'matches', 'not_matches'].includes(expression.type)) {
        if (expression.right === undefined) {
          errors.push(`Operator ${expression.type} requires a right operand`);
        }
      }
    } else {
      errors.push(`Unknown expression type: ${expression.type}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  protected async beforeExecute(step: WorkflowStep, context: WorkflowContext): Promise<void> {
    const config = step.config as ConditionConfig;
    context.log(`Evaluating condition: ${JSON.stringify(config.expression)}`);
    
    if (config.onTrue) {
      context.log(`Steps to execute if true: ${config.onTrue.join(', ')}`);
    }
    
    if (config.onFalse) {
      context.log(`Steps to execute if false: ${config.onFalse.join(', ')}`);
    }
  }

  protected async afterExecute(step: WorkflowStep, context: WorkflowContext, result: unknown): Promise<void> {
    const conditionResult = result as ConditionExecutionResult;
    context.log(`Condition evaluated to: ${conditionResult.conditionResult}`);
    context.log(`Expression: ${conditionResult.evaluatedExpression}`);
    
    if (conditionResult.triggeredSteps.length > 0) {
      context.log(`Triggered steps: ${conditionResult.triggeredSteps.join(', ')}`);
    } else {
      context.log('No steps triggered by this condition');
    }
    
    if (conditionResult.evaluationError) {
      context.log(`Evaluation error: ${conditionResult.evaluationError}`, 'warn');
    }
    
    context.log(`Condition execution completed in ${conditionResult.executionTime}ms`);
  }

  protected async onError(step: WorkflowStep, context: WorkflowContext, error: Error): Promise<void> {
    const config = step.config as ConditionConfig;
    context.log(`Condition step ${step.id} failed: ${error.message}`, 'error');
    
    if (config.continueOnError) {
      context.log('Continuing execution due to continueOnError setting', 'warn');
    }
  }
}