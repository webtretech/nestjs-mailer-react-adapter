import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import { Options as RenderOptions, render } from "@react-email/render";
import { getModuleExport, load } from "locter";
import path from "node:path";

type AdapterConfig = RenderOptions;

export class ReactAdapter implements TemplateAdapter {
  private config: AdapterConfig = {
    pretty: false,
    plainText: false,
  };

  constructor(config?: AdapterConfig) {
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

    load(templatePath)
      .then((tmpl) => {
        const moduleDefault = getModuleExport(tmpl);
        const Component = moduleDefault.value;
        mail.data.html = render(<Component {...context} />, this.config);

        return callback();
      })
      .catch(callback);
  }
}
