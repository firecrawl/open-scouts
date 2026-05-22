import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isCompletelyEmpty(value: any): boolean {
  return (
    (typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function removeEmptyByKey(obj: any, keyToRemove: string): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => removeEmptyByKey(item, keyToRemove));
  }

  if (obj !== null && typeof obj === "object") {
    const cleaned: any = {};

    for (const key in obj) {
      const rawValue = obj[key];
      const cleanedValue = removeEmptyByKey(rawValue, keyToRemove);

      // Only remove if it's the target key AND it's completely empty ({} or [])
      if (key === keyToRemove && isCompletelyEmpty(cleanedValue)) {
        continue;
      }

      cleaned[key] = cleanedValue;
    }

    return cleaned;
  }

  return obj;
}

export function deepEqual(
  a: any,
  b: any,
  shouldRemoveEmptyByKey?: boolean,
  keyToRemove?: string,
): boolean {
  let _a = a;
  let _b = b;

  if (shouldRemoveEmptyByKey && keyToRemove) {
    _a = removeEmptyByKey(a, keyToRemove);
    _b = removeEmptyByKey(b, keyToRemove);
  }

  if (_a === _b) return true;

  if (typeof _a !== typeof _b || _a === null || _b === null) return false;

  if (Array.isArray(_a)) {
    if (!Array.isArray(_b) || _a.length !== _b.length) return false;
    return _a.every((item, index) => deepEqual(item, _b[index]));
  }

  if (typeof _a === "object") {
    const aKeys = Object.keys(_a);
    const bKeys = Object.keys(_b);

    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every(
      (key) => _b.hasOwnProperty(key) && deepEqual(_a[key], _b[key]),
    );
  }

  return false;
}

/**
 * Normalizes an email address to lowercase for consistent storage and querying.
 * Email addresses should be case-insensitive per RFC standards.
 */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

/**
 * Returns a same-origin path safe to pass to router.push or NextResponse.redirect.
 *
 * Rejects anything that could navigate off-origin or execute script, including
 * absolute URLs, protocol-relative URLs (//evil.com, /\evil.com), pseudo schemes
 * such as javascript:, data:, or vbscript:, and inputs containing whitespace or
 * control characters that browsers strip during URL parsing (e.g. "/\t/evil.com",
 * which would otherwise collapse to "//evil.com"). Validates the final parsed
 * origin against a placeholder base to catch any normalization escape.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string = "/",
): string {
  if (typeof value !== "string" || value.length === 0) return fallback;

  // Reject ASCII control characters and whitespace (including \t, \n, \r) which
  // browsers strip during URL parsing and can be used to bypass naive prefix
  // checks (e.g. "/%09/evil.com" decodes to "/\t/evil.com" → "//evil.com").
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7F]/.test(value)) return fallback;

  // Must be a path beginning with a single forward slash.
  if (value[0] !== "/") return fallback;

  // Reject protocol-relative ("//host") and backslash variants ("/\host")
  // that some browsers normalize to "//host".
  if (value.length > 1 && (value[1] === "/" || value[1] === "\\")) {
    return fallback;
  }

  // Final defense in depth: resolve against a placeholder origin and confirm
  // the parsed origin did not escape. Catches any normalization quirk the
  // static checks miss.
  try {
    const base = "https://redirect.invalid";
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return fallback;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}
