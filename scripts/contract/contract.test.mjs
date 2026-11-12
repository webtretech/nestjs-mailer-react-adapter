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
const {
  ReactAdapter,
  ReactAdapterError,
  REACT_ADAPTER_ERROR_CODES,
} = require("@webtre/nestjs-mailer-react-adapter");

const major = Number.parseInt(
  require("@nestjs-modules/mailer/package.json").version,
  10
);
// MailerTemplateError is a public export of v4 only; it is loaded in the v4 branches below.
const MailerTemplateError =
  major >= 4
    ? require("@nestjs-modules/mailer").MailerTemplateError
    : undefined;

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
  let calls;
  let mailer;

  before(async () => {
    ({ app, calls, mailer } = await boot({}));
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

  // v4 mailer derives a text part from the html (textFromHtml, no case change); v2 and v3 send none.
  test("text part of a templated sendMail", async () => {
    const message = await send(mailer, {
      template: "welcome",
      context: { name: "Ann" },
    });
    if (major >= 4) {
      assert.match(message.text, /^Hello Ann/);
    } else {
      assert.equal("text" in message, false);
    }
  });

  // v4 wraps the adapter error in MailerTemplateError (code ETEMPLATE, permanent, cause is the
  // adapter error); v2 and v3 reject with the adapter error itself.
  test("missing template rejects with an error naming the template", async () => {
    await assert.rejects(
      send(mailer, { template: "nope", context: {} }),
      (error) => {
        assert.equal(
          REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND,
          "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
        );
        assert.match(error.message, /"nope"/);
        if (major >= 4) {
          assert.ok(error instanceof MailerTemplateError);
          assert.equal(error.code, "ETEMPLATE");
          assert.equal(error.permanent, true);
          assert.ok(error.cause instanceof ReactAdapterError);
          assert.equal(
            error.cause.code,
            REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND
          );
        } else {
          assert.ok(error instanceof ReactAdapterError);
          assert.equal(
            error.code,
            REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND
          );
        }
        return true;
      }
    );
  });

  test("mail without a template passes through unchanged", async () => {
    const html = await send(mailer, { html: "<p>raw</p>" });
    assert.equal(html.html, "<p>raw</p>");
    // v4 derives a text part from the html; its content is not asserted.
    if (major < 4) assert.equal("text" in html, false);

    const text = await send(mailer, { text: "plain only" });
    assert.equal(text.text, "plain only");
    assert.equal("html" in text, false);
  });

  if (major >= 4) {
    test("render() returns the rendered HTML and no text", async () => {
      const rendered = await mailer.render({
        template: "welcome",
        context: { name: "Ann" },
        subject: "s",
      });
      assertWelcomeHtml(rendered.html);
      assert.equal(rendered.text, undefined);
    });

    // The module is booted without a retry option, so the default retry policy is on; a retry of
    // the permanent template failure would compile again. Counts are before/after differences.
    test("a failing template is compiled once with the default retry policy", async () => {
      const baseline = calls.compile;
      await assert.rejects(
        send(mailer, { template: "nope", context: {} }),
        (error) => error instanceof MailerTemplateError
      );
      assert.equal(calls.compile - baseline, 1);
    });
  }
});

describe("adapter text on", () => {
  let app;
  let mailer;

  before(async () => {
    ({ app, mailer } = await boot({ text: true }));
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

  // The adapter text is upper-cased by html-to-text; the v4 textFromHtml text is not, so the two
  // near-identical texts are told apart by letter case.
  test("text part is the adapter text", async () => {
    const message = await send(mailer, {
      template: "welcome",
      context: { name: "Ann" },
    });
    assert.match(message.text, /^HELLO ANN/);
  });

  if (major >= 4) {
    test("render() returns the rendered HTML and the adapter text", async () => {
      const rendered = await mailer.render({
        template: "welcome",
        context: { name: "Ann" },
        subject: "s",
      });
      assertWelcomeHtml(rendered.html);
      assert.match(rendered.text, /^HELLO ANN/);
    });
  }
});
