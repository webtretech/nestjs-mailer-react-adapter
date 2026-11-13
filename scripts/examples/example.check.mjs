import { createRequire } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";

// Runs inside a scratch copy of an example app (scripts/examples.mjs copies it there and sets
// MAIL_TRANSPORT=json). It boots the built app context, which does not run main.ts, so nothing
// listens on a port and no SMTP setting is read.
const req = createRequire(path.join(process.cwd(), "noop.js"));
req("reflect-metadata");
const { NestFactory } = req("@nestjs/core");
const { MailerService } = req("@nestjs-modules/mailer");
const dist = path.join(process.cwd(), "dist");
const { AppModule } = req(path.join(dist, "app.module"));
const { AppService } = req(path.join(dist, "app.service"));

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
  abortOnError: false,
});
try {
  const mailer = app.get(MailerService);
  let info;
  const send = mailer.sendMail.bind(mailer);
  mailer.sendMail = async (options) => (info = await send(options));

  assert.equal(await app.get(AppService).sendWelcomeMail(), "Mail sent!");

  const message = JSON.parse(info.message);
  // React 19 puts `<!-- -->` between adjacent text nodes, so strip comments before matching.
  const html = message.html.replace(/<!--.*?-->/g, "");
  assert.match(
    html,
    /<div>Hi John Doe, thanks for signing up\. Your code is 123456<\/div>/
  );
  assert.match(message.text, /Hi John Doe/);
} finally {
  await app.close();
}

console.log("example check: ok");
