/**
 * Product category schemas.
 *
 * A category is a JSON file in `schemas/categories/`. It drives the register
 * form, client-side validation and how a passport renders. Adding a category is
 * adding a file — no code in this app changes, which is the extension point
 * AGENTS.md promises and a reviewer is expected to exercise.
 */
import battery from "../../../schemas/categories/battery.json";
import generic from "../../../schemas/categories/generic.json";
import textile from "../../../schemas/categories/textile.json";

/** A field a category asks an issuer to fill in. */
export interface CategoryField {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "enum";
  required?: boolean;
  maxLength?: number;
  pattern?: string;
  options?: string[];
  minimum?: number;
  maximum?: number;
}

/** Hints for rendering a registered product. */
export interface CategoryDisplay {
  title: string;
  subtitle?: string;
  highlights?: string[];
}

export interface CategorySchema {
  id: string;
  label: string;
  description?: string;
  fields: CategoryField[];
  display: CategoryDisplay;
  eventTypes: string[];
}

/**
 * Every bundled category.
 *
 * Imported statically rather than read from disk at request time so the list
 * works identically in a serverless runtime, where the filesystem may not carry
 * the repo's schema directory.
 */
export const CATEGORIES: CategorySchema[] = [generic, battery, textile] as unknown as CategorySchema[];

/** Looks up a category by id. */
export function getCategory(id: string): CategorySchema | undefined {
  return CATEGORIES.find(category => category.id === id);
}

/** A validation failure on one field. */
export interface FieldIssue {
  key: string;
  message: string;
}

/**
 * Validates form values against a category schema.
 *
 * Mirrors the constraints the JSON declares, so the issuer sees a useful error
 * before anything is signed, submitted or paid for.
 *
 * @param category Category the product belongs to.
 * @param values Raw form values, keyed by field key.
 * @returns One issue per violation; empty when the values are acceptable.
 */
export function validateCategoryValues(category: CategorySchema, values: Record<string, string>): FieldIssue[] {
  const issues: FieldIssue[] = [];

  for (const field of category.fields) {
    const raw = (values[field.key] ?? "").trim();

    if (raw === "") {
      if (field.required) issues.push({ key: field.key, message: `${field.label} is required` });
      continue;
    }

    if (field.maxLength !== undefined && raw.length > field.maxLength) {
      issues.push({ key: field.key, message: `${field.label} must be ${field.maxLength} characters or fewer` });
    }

    if (field.pattern !== undefined && !new RegExp(field.pattern).test(raw)) {
      issues.push({ key: field.key, message: `${field.label} is not in the expected format` });
    }

    if (field.type === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        issues.push({ key: field.key, message: `${field.label} must be a number` });
      } else {
        if (field.minimum !== undefined && value < field.minimum) {
          issues.push({ key: field.key, message: `${field.label} must be at least ${field.minimum}` });
        }
        if (field.maximum !== undefined && value > field.maximum) {
          issues.push({ key: field.key, message: `${field.label} must be at most ${field.maximum}` });
        }
      }
    }

    if (field.type === "enum" && field.options && !field.options.includes(raw)) {
      issues.push({ key: field.key, message: `${field.label} must be one of ${field.options.join(", ")}` });
    }
  }

  return issues;
}

/**
 * Converts form values into the typed payload submitted to HCS.
 *
 * Numbers become numbers and blanks are dropped entirely rather than sent as
 * empty strings — an absent field and a field explicitly set to "" must hash
 * the same way, or two records of the same product would disagree.
 *
 * @param category Category the product belongs to.
 * @param values Raw form values.
 * @returns A payload ready to hash and submit.
 */
export function toPayload(category: CategorySchema, values: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = { category: category.id };

  for (const field of category.fields) {
    const raw = (values[field.key] ?? "").trim();
    if (raw === "") continue;
    payload[field.key] = field.type === "number" ? Number(raw) : raw;
  }

  return payload;
}
