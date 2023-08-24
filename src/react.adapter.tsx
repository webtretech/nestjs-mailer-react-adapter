import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import { Options as RenderOptions, render } from "@react-email/render";
import path from "node:path";

interface ReactAdapterConfig extends RenderOptions {}

export class ReactAdapter implements TemplateAdapter {
  private config: ReactAdapterConfig = {
    pretty: false,
    plainText: false,
  };

  constructor(config?: ReactAdapterConfig) {
    Object.assign(this.config, config);
  }

  public compile(mail: any, callback: any, options: MailerOptions): void {
    const { context, template } = mail.data;
    const templateExt = path.extname(template) || ".js";
    const templateName = path.basename(template, path.extname(template));
    const templateDir = path.isAbsolute(template)
      ? path.dirname(template)
      : path.join(options.template.dir, path.dirname(template));
    const templatePath = path.join(templateDir, templateName + templateExt);

    import(templatePath)
      .then((tmpl) => {
        const Component = tmpl.default.default;
        const html = render(<Component {...context} />, this.config);
        mail.data.html = html;

        return callback();
      })
      .catch(callback);
  }
}
