import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import { Options, render } from "@react-email/render";

import { REACT_ADAPTER_ERROR_CODES, ReactAdapterError } from "./adapter.errors";
import { describeExport, isRenderable, loadTemplate } from "./template.loader";
import { locateTemplate } from "./template.lookup";

type TemplateMail = {
  data: { template: string; context?: Record<string, unknown>; html?: string };
};

export class ReactAdapter implements TemplateAdapter {
  private config: Options = {
    pretty: false,
    plainText: false,
  };

  constructor(config?: Options) {
    Object.assign(this.config, config);
  }

  // All work lives here so that nothing can throw synchronously out of compile().
  private async run(mail: unknown, options: MailerOptions): Promise<void> {
    const { context, template } = (mail as TemplateMail).data;
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
    let html: string;
    try {
      html = await render(<Comp {...context} />, this.config);
    } catch (cause) {
      // The message names the template but not the cause: a render error can carry context values.
      throw new ReactAdapterError(
        REACT_ADAPTER_ERROR_CODES.RENDER_FAILED,
        `Template "${template}" (${file}) threw while rendering; the component's error is in cause.`,
        { template, path: file, cause }
      );
    }
    (mail as TemplateMail).data.html = html;
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
