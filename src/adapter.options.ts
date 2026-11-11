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
};

type OwnOptionKeys =
  | "pretty"
  | "text"
  | "plainText"
  | "htmlToTextOptions"
  | "unstableTextConversion";

/** The keys the adapter does not own: they reach render() untouched. */
export type RenderPassThrough = Omit<ReactAdapterOptions, OwnOptionKeys>;

export interface ResolvedSettings {
  pretty: boolean;
  text: boolean;
  htmlToTextOptions: HtmlToTextConfig | undefined;
  unstableTextConversion: boolean;
  renderOptions: RenderPassThrough;
}

function isOptionsObject(value: unknown): value is ReactAdapterOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfigObject(value: unknown): value is HtmlToTextConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Splits the constructor options into the adapter's own settings and the keys for render(). */
export function resolveSettings(
  options: ReactAdapterOptions | undefined
): ResolvedSettings {
  const {
    pretty,
    text,
    plainText,
    htmlToTextOptions,
    unstableTextConversion,
    ...renderOptions
  }: ReactAdapterOptions = isOptionsObject(options) ? options : {};

  return {
    pretty: pretty === true,
    // `text` wins whenever it is set at all; plainText only counts as the alias of an unset text.
    text: text !== undefined ? text === true : plainText === true,
    htmlToTextOptions: isConfigObject(htmlToTextOptions)
      ? { ...htmlToTextOptions }
      : undefined,
    unstableTextConversion: unstableTextConversion === true,
    renderOptions,
  };
}
