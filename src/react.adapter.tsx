import path from "node:path";
import { pathToFileURL } from "node:url";

import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import { Options, render } from "@react-email/render";
import { getModuleExport, load } from "locter";

export class ReactAdapter implements TemplateAdapter {
  private config: Options = {
    pretty: false,
    plainText: false,
  };

  constructor(config?: Options) {
    Object.assign(this.config, config);
  }

  public compile(mail: any, callback: any, options: MailerOptions): void {
    const { context, template } = mail.data;
    const templateExt = path.extname(template) || ".js";
    const templateName = path.basename(template, templateExt);
    const templateDir = path.isAbsolute(template)
      ? path.dirname(template)
      : path.join(options.template.dir, path.dirname(template));
    const templatePath = path.join(templateDir, templateName + templateExt);
    const templatePathFileURL = pathToFileURL(templatePath).href;

    load(templatePathFileURL)
      .then((tmplModule) => {
        const moduleDefault = getModuleExport(
          tmplModule,
          (key) => key === "default"
        );
        const Comp = moduleDefault.value;

        return render(<Comp {...context} />, this.config);
      })
      .then((html) => {
        mail.data.html = html;
        return callback();
      })
      .catch(callback);
  }
}
