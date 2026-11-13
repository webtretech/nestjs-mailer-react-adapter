import { REACT_ADAPTER_ERROR_CODES, ReactAdapterError } from "./adapter.errors";
import { isPlainObjectLike } from "./template.confine";

/** mail.data as the adapter sees it: an object whose keys it does not own stay untyped. */
export type MailData = Record<string, unknown>;

export type MailClassification =
  | { kind: "pass-through" }
  | {
      kind: "render";
      data: MailData;
      template: string;
      context: Record<string, unknown>;
    };

// Names a value's type for error messages. Never includes the value itself.
function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
}

function invalidMail(message: string, template?: string): ReactAdapterError {
  return new ReactAdapterError(
    REACT_ADAPTER_ERROR_CODES.INVALID_MAIL,
    message,
    template === undefined ? {} : { template }
  );
}

/**
 * Decides, before any template work, what compile() does with a mail it knows nothing
 * about: pass it through, render it, or fail. Checks run in a fixed order, so the first
 * applicable failure is the one reported: mail and mail.data shape, pass-through, no body,
 * template type, context type. Messages report types only, never values.
 */
export function classifyMail(mail: unknown): MailClassification {
  if (!isPlainObjectLike(mail)) {
    throw invalidMail(`mail must be an object; got ${describeType(mail)}`);
  }
  const { data } = mail;
  if (!isPlainObjectLike(data)) {
    throw invalidMail(`mail.data must be an object; got ${describeType(data)}`);
  }

  // The caller supplied the body: never overwrite it.
  if (data["html"] || data["raw"]) {
    return { kind: "pass-through" };
  }

  const { template } = data;
  if (template === undefined || template === null || template === "") {
    // A caller-provided text, even an empty one, counts as a body.
    if (data["text"] !== undefined) {
      return { kind: "pass-through" };
    }
    throw new ReactAdapterError(
      REACT_ADAPTER_ERROR_CODES.NO_BODY,
      "mail has no template and no html, text or raw body"
    );
  }
  if (typeof template !== "string") {
    throw invalidMail(
      `mail.data.template must be a string; got ${describeType(template)}`
    );
  }

  const { context } = data;
  if (context === undefined || context === null) {
    return { kind: "render", data, template, context: {} };
  }
  if (!isPlainObjectLike(context)) {
    throw invalidMail(
      `mail.data.context must be an object; got ${describeType(context)}`,
      template
    );
  }
  return { kind: "render", data, template, context };
}
