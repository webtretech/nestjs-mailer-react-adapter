import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import { render } from "@react-email/render";
import * as path from "path";

interface ReactAdapterConfig {
  pretty?: boolean;
}

export class ReactAdapter implements TemplateAdapter {
  private readonly config: ReactAdapterConfig;

  constructor(config?: ReactAdapterConfig) {
    this.config = { pretty: false, ...config };
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
