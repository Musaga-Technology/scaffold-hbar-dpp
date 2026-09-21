"use client";

import type { CategoryField, CategorySchema, FieldIssue } from "~~/lib/categories";

/**
 * A form generated from a category schema.
 *
 * Nothing here knows what a battery or a garment is. Adding a category is
 * adding a JSON file; this component renders whatever it declares.
 */
export const SchemaForm = ({
  category,
  values,
  issues,
  disabled,
  onChange,
}: {
  category: CategorySchema;
  values: Record<string, string>;
  issues: FieldIssue[];
  disabled?: boolean;
  onChange: (key: string, value: string) => void;
}) => {
  const issueFor = (key: string) => issues.find(issue => issue.key === key)?.message;

  const input = (field: CategoryField) => {
    const common = {
      id: `field-${field.key}`,
      value: values[field.key] ?? "",
      disabled,
      "aria-invalid": Boolean(issueFor(field.key)),
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        onChange(field.key, event.target.value),
    };

    if (field.type === "enum" && field.options) {
      return (
        <select {...common} className="select select-bordered w-full">
          <option value="">Select…</option>
          {field.options.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    return (
      <input
        {...common}
        type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
        className="input input-bordered w-full"
        maxLength={field.maxLength}
        min={field.minimum}
        max={field.maximum}
      />
    );
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {category.fields.map(field => {
        const issue = issueFor(field.key);
        return (
          <div key={field.key} className="form-control w-full">
            <label className="label pb-1" htmlFor={`field-${field.key}`}>
              <span className="label-text">
                {field.label}
                {field.required && <span className="text-error"> *</span>}
              </span>
            </label>
            {input(field)}
            {issue && <span className="mt-1 text-xs text-error">{issue}</span>}
          </div>
        );
      })}
    </div>
  );
};
