import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import {
  pretty,
  render,
  toPlainText,
  unstableToPlainText,
} from "@react-email/render";

import { classifyMail } from "./adapter.mail";
import {
  ReactAdapterOptions,
  ResolvedSettings,
  resolveSettings,
} from "./adapter.options";
import { REACT_ADAPTER_ERROR_CODES, ReactAdapterError } from "./adapter.errors";
import { describeExport, isRenderable, loadTemplate } from "./template.loader";
import { locateTemplate } from "./template.lookup";

export class ReactAdapter implements TemplateAdapter {
  private readonly settings: ResolvedSettings;

  constructor(options?: ReactAdapterOptions) {
    this.settings = resolveSettings(options);
  }

  // All work lives here so that nothing can throw synchronously out of compile().
  private async run(mail: unknown, options: MailerOptions): Promise<void> {
    const { settings } = this;
    const classified = classifyMail(mail);
    if (classified.kind === "pass-through") {
      return;
    }
    const { data, template, context } = classified;
    const file = await locateTemplate(template, options?.template, {
      allowOutside: settings.unsafeAllowOutsideTemplateDir,
    });
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
    if (settings.text && data["text"] === undefined) {
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
    // html and text are assigned only after rendering and text conversion both succeeded. If a write fails
    // (for example a non-extensible mail.data) the error is INVALID_MAIL, and html may already have been written.
    try {
      data["html"] = html;
      if (text !== undefined) {
        data["text"] = text;
      }
    } catch (cause) {
      throw new ReactAdapterError(
        REACT_ADAPTER_ERROR_CODES.INVALID_MAIL,
        "mail.data could not be updated; the assignment error is in cause.",
        { template, path: file, cause }
      );
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
