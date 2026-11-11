import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MailerOptions, TemplateAdapter } from "@nestjs-modules/mailer";
import { Options, render } from "@react-email/render";
import type { ComponentType } from "react";

import { locateTemplate } from "./template.lookup";

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

  // All work lives here so that nothing can throw synchronously out of compile().
  private async run(mail: unknown, options: MailerOptions): Promise<void> {
    const { context, template } = (mail as TemplateMail).data;
    const file = await locateTemplate(template, options?.template);
    const Comp = await loadTemplate(file);
    const html = await render(<Comp {...context} />, this.config);
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
