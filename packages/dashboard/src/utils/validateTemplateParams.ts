import type { TemplateParameter } from "../types/dashboard";

export interface ValidationError {
  key: string;
  message: string;
}

/**
 * Validates parameter values against a template parameter schema.
 * Returns an array of validation errors (empty if all valid).
 */
export function validateTemplateParams(
  schema: TemplateParameter[],
  values: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const param of schema) {
    const value = values[param.key];
    const error = validateSingleParam(param, value);
    if (error) {
      errors.push(error);
    }
  }

  return errors;
}

function validateSingleParam(
  param: TemplateParameter,
  value: unknown,
): ValidationError | null {
  // Required check
  if (param.required && isEmpty(value)) {
    return { key: param.key, message: `${param.label} is required` };
  }

  // Skip further validation if value is empty and not required
  if (isEmpty(value)) {
    return null;
  }

  switch (param.type) {
    case "number":
      return validateNumber(param, value);
    case "url":
      return validateUrl(param, value);
    case "string":
    case "cron":
      return validatePattern(param, value);
    default:
      return null;
  }
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function validateNumber(
  param: TemplateParameter,
  value: unknown,
): ValidationError | null {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) {
    return { key: param.key, message: `${param.label} must be a number` };
  }
  if (param.validation?.min !== undefined && num < param.validation.min) {
    return {
      key: param.key,
      message: `${param.label} must be at least ${param.validation.min}`,
    };
  }
  if (param.validation?.max !== undefined && num > param.validation.max) {
    return {
      key: param.key,
      message: `${param.label} must be at most ${param.validation.max}`,
    };
  }
  return null;
}

function validateUrl(
  param: TemplateParameter,
  value: unknown,
): ValidationError | null {
  const str = typeof value === "string" ? value : `${value as string}`;
  try {
    new URL(str);
    return null;
  } catch {
    return { key: param.key, message: `${param.label} must be a valid URL` };
  }
}

function validatePattern(
  param: TemplateParameter,
  value: unknown,
): ValidationError | null {
  if (!param.validation?.pattern) {
    return null;
  }
  const str = typeof value === "string" ? value : `${value as string}`;
  const regex = new RegExp(param.validation.pattern);
  if (!regex.test(str)) {
    return {
      key: param.key,
      message: `${param.label} does not match the required format`,
    };
  }
  return null;
}
