import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import { Options, render } from "@react-email/render";
import type { ComponentType } from "react";

type TemplateComponent = ComponentType<Record<string, unknown>>;

type TemplateMail = {
  data: { template: string; context?: Record<string, unknown>; html?: string };
};

function isEsModule(mod: unknown): mod is { default: unknown } {
  return typeof mod === "object" && mod !== null && "__esModule" in mod;
}

function isRequireEsmError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (
    error.code === "ERR_REQUIRE_ESM" ||
    error.code === "ERR_REQUIRE_ASYNC_MODULE"
  );
}

async function loadTemplate(file: string): Promise<TemplateComponent> {
  // createRequire rejects a relative path, so resolve against process.cwd() first, as 0.2.5 did implicitly.
  const absolute = path.resolve(file);
  try {
    const mod: unknown = createRequire(absolute)(absolute);
    return (isEsModule(mod) ? mod.default : mod) as TemplateComponent;
  } catch (error) {
    if (!isRequireEsmError(error)) {
      throw error;
    }
    const ns = (await import(pathToFileURL(absolute).href)) as {
      default: TemplateComponent;
    };
    return ns.default;
  }
}

export class ReactAdapter implements TemplateAdapter {
  private config: Options = {
    pretty: false,
    plainText: false,
  };

  constructor(config?: Options) {
    Object.assign(this.config, config);
  }

  public compile(
    mail: unknown,
    callback: (err?: unknown) => unknown,
    options: MailerOptions
  ): void {
    const { context, template } = (mail as TemplateMail).data;
    const templateExt = path.extname(template) || ".js";
    const templateName = path.basename(template, templateExt);
    const templateDir = path.isAbsolute(template)
      ? path.dirname(template)
      : path.join(options.template!.dir!, path.dirname(template));
    const templatePath = path.join(templateDir, templateName + templateExt);

    loadTemplate(templatePath)
      .then((Comp) => render(<Comp {...context} />, this.config))
      .then((html) => {
        (mail as TemplateMail).data.html = html;
      })
      .then(
        () => callback(),
        (error: unknown) => callback(error)
      );
  }
}
