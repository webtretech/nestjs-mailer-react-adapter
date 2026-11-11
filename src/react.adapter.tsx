import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import {
  pretty,
  render,
  toPlainText,
  unstableToPlainText,
} from "@react-email/render";

import {
  ReactAdapterOptions,
  ResolvedSettings,
  resolveSettings,
} from "./adapter.options";
import { REACT_ADAPTER_ERROR_CODES, ReactAdapterError } from "./adapter.errors";
import { describeExport, isRenderable, loadTemplate } from "./template.loader";
import { locateTemplate } from "./template.lookup";

type TemplateMail = {
  data: {
    template: string;
    context?: Record<string, unknown>;
    html?: string;
    text?: unknown;
  };
};

export class ReactAdapter implements TemplateAdapter {
  private readonly settings: ResolvedSettings;

  constructor(options?: ReactAdapterOptions) {
    this.settings = resolveSettings(options);
  }

  // All work lives here so that nothing can throw synchronously out of compile().
  private async run(mail: unknown, options: MailerOptions): Promise<void> {
    const { settings } = this;
    const {
      context,
      template,
      text: providedText,
    } = (mail as TemplateMail).data;
    const file = await locateTemplate(template, options?.template);
    const { value, exportNames } = await loadTemplate(file, template);
    if (!isRenderable(value)) {
      throw new ReactAdapterError(
        REACT_ADAPTER_ERROR_CODES.INVALID_EXPORT,
        `Template "${template}" (${file}) does not default-export a React component; found ${describeExport(value, exportNames)}.`,
        { template, path: file }
      );
    }
    const Comp = value;
    // One render without pretty: the text part is built from this raw HTML (D-32).
    let raw: string;
    try {
      raw = await render(<Comp {...context} />, settings.renderOptions);
    } catch (cause) {
      // The message names the template but not the cause: a render error can carry context values.
      throw new ReactAdapterError(
        REACT_ADAPTER_ERROR_CODES.RENDER_FAILED,
        `Template "${template}" (${file}) threw while rendering; the component's error is in cause.`,
        { template, path: file, cause }
      );
    }
    let text: string | undefined;
    if (settings.text && providedText === undefined) {
      try {
        text = settings.unstableTextConversion
          ? unstableToPlainText(raw)
          : toPlainText(raw, settings.htmlToTextOptions);
      } catch (cause) {
        throw new ReactAdapterError(
          REACT_ADAPTER_ERROR_CODES.TEXT_FAILED,
          `Template "${template}" (${file}) rendered, but its text part could not be built; the converter's error is in cause.`,
          { template, path: file, cause }
        );
      }
    }
    let html = raw;
    if (settings.pretty) {
      try {
        html = await pretty(raw);
      } catch (cause) {
        throw new ReactAdapterError(
          REACT_ADAPTER_ERROR_CODES.RENDER_FAILED,
          `Template "${template}" (${file}) rendered, but its HTML could not be formatted; the formatter's error is in cause.`,
          { template, path: file, cause }
        );
      }
    }
    // Assigned only once both parts exist, so a failure above leaves the mail untouched.
    (mail as TemplateMail).data.html = html;
    if (text !== undefined) {
      (mail as TemplateMail).data.text = text;
    }
  }

  public compile(
    mail: unknown,
    callback: (err?: unknown) => unknown,
    options: MailerOptions
  ): void {
    this.run(mail, options).then(
      () => callback(),
      (error: unknown) => callback(error)
    );
  }
}
