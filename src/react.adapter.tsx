import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import { Options as RenderOptions, render } from "@react-email/render";
import { getModuleExport, load } from "locter";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
