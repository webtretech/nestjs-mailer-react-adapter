/**
 * Options for the html-to-text converter that builds the text part. Typed loosely on
 * purpose: render's own option type would leak an untyped value into this package's public API.
 */
export type HtmlToTextConfig = Readonly<Record<string, unknown>>;

export type ReactAdapterOptions = {
  /** Format the HTML with prettier. The text part is always built from the unformatted HTML. */
  pretty?: boolean;
  /** Fill `mail.data.text` from the rendered HTML when the mail does not provide a text part. */
  text?: boolean;
  /** @deprecated Use text instead. */
  plainText?: boolean;
  /** Options for the default HTML to text converter. Ignored when `unstableTextConversion` is true. */
  htmlToTextOptions?: HtmlToTextConfig;
  /** Convert to text with render's in-house formatter instead of html-to-text. */
  unstableTextConversion?: boolean;
  /** Load templates from outside template.dir and template.dirs. Constructor only; only the literal true enables it. */
  unsafeAllowOutsideTemplateDir?: boolean;
};

type OwnOptionKeys =
  | "pretty"
  | "text"
  | "plainText"
  | "htmlToTextOptions"
  | "unstableTextConversion"
  | "unsafeAllowOutsideTemplateDir";

/** The keys the adapter does not own: they reach render() untouched. */
export type RenderPassThrough = Omit<ReactAdapterOptions, OwnOptionKeys>;

export interface ResolvedSettings {
  pretty: boolean;
  text: boolean;
  htmlToTextOptions: HtmlToTextConfig | undefined;
  unstableTextConversion: boolean;
  unsafeAllowOutsideTemplateDir: boolean;
  renderOptions: RenderPassThrough;
}

function isOptionsObject(value: unknown): value is ReactAdapterOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfigObject(value: unknown): value is HtmlToTextConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let plainTextWarned = false;

// Once per process. Node applies --no-deprecation and --throw-deprecation itself; under
// --throw-deprecation the error is raised after this function has returned.
function warnPlainTextDeprecated(): void {
  if (plainTextWarned) {
    return;
  }
  plainTextWarned = true;
  process.emitWarning(
    "The ReactAdapter option plainText is deprecated; use text instead. plainText: true now keeps HTML in mail.data.html and fills mail.data.text.",
    { type: "DeprecationWarning", code: "REACT_ADAPTER_DEP0001" }
  );
}

/** Splits the constructor options into the adapter's own settings and the keys for render(). */
export function resolveSettings(
  options: ReactAdapterOptions | undefined
): ResolvedSettings {
  const source: ReactAdapterOptions = isOptionsObject(options) ? options : {};
  const {
    pretty,
    text,
    plainText,
    htmlToTextOptions,
    unstableTextConversion,
    unsafeAllowOutsideTemplateDir,
    ...renderOptions
  } = source;

  // The key being present is enough, whether it holds true or false (D-26).
  if (plainText !== undefined) {
    warnPlainTextDeprecated();
  }

  return {
    pretty: pretty === true,
    // `text` wins whenever it is set at all; plainText only counts as the alias of an unset text.
    text: text !== undefined ? text === true : plainText === true,
    htmlToTextOptions: isConfigObject(htmlToTextOptions)
      ? { ...htmlToTextOptions }
      : undefined,
    unstableTextConversion: unstableTextConversion === true,
    // Strict: only the literal true counts, and only as an own property of the constructor argument.
    // A value inherited through the prototype chain (a polluted Object.prototype) never enables it.
    unsafeAllowOutsideTemplateDir:
      Object.hasOwn(source, "unsafeAllowOutsideTemplateDir") &&
      unsafeAllowOutsideTemplateDir === true,
    renderOptions,
  };
}
