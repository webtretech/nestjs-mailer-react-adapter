import "reflect-metadata";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, test } from "node:test";

// This file is copied into a scratch project by scripts/contract.mjs and runs there, so every
// package below resolves from that project's node_modules: the mailer version under test and the
// adapter from the packed tarball, never from the repository working tree.
const require = createRequire(path.join(process.cwd(), "noop.js"));
const { NestFactory } = require("@nestjs/core");
const { Module } = require("@nestjs/common");
const { MailerModule, MailerService } = require("@nestjs-modules/mailer");
const { ReactAdapter } = require("@webtre/nestjs-mailer-react-adapter");

const major = Number.parseInt(
  require("@nestjs-modules/mailer/package.json").version,
  10
);

// One Nest application per adapter-text mode, each with its own counting wrapper, so no result
// depends on test order. abortOnError: false turns a bootstrap failure into a thrown error with a
// message instead of a silent process exit.
async function boot(adapterOptions) {
  const calls = { compile: 0 };
  const real = new ReactAdapter(adapterOptions);
  const adapter = {
    compile(mail, callback, options) {
      calls.compile += 1;
      return real.compile(mail, callback, options);
    },
  };
  class AppModule {}
  Module({
    imports: [
      MailerModule.forRoot({
        transport: { jsonTransport: true },
        defaults: { from: "from@example.test" },
        template: { dir: process.env.TEMPLATES_DIR, adapter },
      }),
    ],
  })(AppModule);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  return { app, calls, mailer: app.get(MailerService) };
}

async function send(mailer, mail) {
  const info = await mailer.sendMail({
    to: "to@example.test",
    subject: "s",
    ...mail,
  });
  return JSON.parse(info.message);
}

// Only the template's own elements are asserted: the document wrapper and React's comment markers
// differ between React 18 and React 19.
function assertWelcomeHtml(html) {
  assert.match(html, /<h1 id="greeting">Hello Ann<\/h1>/);
  assert.match(html, /<p>Thanks for joining\.<\/p>/);
}

test("claimed mailer major is the installed one", () => {
  assert.equal(Number(process.env.EXPECTED_MAILER_MAJOR), major);
});

describe("adapter text off", () => {
  let app;
  let mailer;

  before(async () => {
    ({ app, mailer } = await boot({}));
  });
  after(async () => {
    await app.close();
  });

  test("templated sendMail sends the rendered HTML", async () => {
    const message = await send(mailer, {
      template: "welcome",
      context: { name: "Ann" },
    });
    assertWelcomeHtml(message.html);
  });
});
