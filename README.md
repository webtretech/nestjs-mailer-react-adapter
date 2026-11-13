<p align="center">
  <a href="http://nestjs.com/" target="blank">
    <img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" />
  </a>
</p>

<p align="center">
  📨 Build and send emails in Nest framework using React.js
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@webtre/nestjs-mailer-react-adapter"><img src="https://img.shields.io/npm/v/@webtre/nestjs-mailer-react-adapter.svg" alt="NPM Version" /></a>
  <a href="https://www.npmjs.com/package/@webtre/nestjs-mailer-react-adapter"><img src="https://img.shields.io/npm/l/@webtre/nestjs-mailer-react-adapter.svg" alt="Package License" /></a>
  <a href="https://www.npmjs.com/package/@webtre/nestjs-mailer-react-adapter"><img src="https://img.shields.io/npm/dm/@webtre/nestjs-mailer-react-adapter.svg" alt="NPM Downloads" /></a>
</p>

## Features

- Write email templates in [React](https://github.com/facebook/react/) and [TypeScript](https://www.typescriptlang.org/)
- Optional plain-text part built from the rendered HTML
- Typed errors with stable `ERR_REACT_ADAPTER_*` codes
- Templates load only from your template directories
- Built on [`@react-email/render`](https://github.com/resend/react-email)

## Install

This library is an adapter for [`@nestjs-modules/mailer`](https://github.com/nest-modules/mailer), so install it alongside the mailer, `nodemailer`, `react` and `react-dom`.

```sh
npm i @webtre/nestjs-mailer-react-adapter @nestjs-modules/mailer nodemailer react react-dom
npm i -D @types/react
```

- Node `>=20.19`
- `@nestjs-modules/mailer` `^2.0.1 || ^3.0.0 || ^4.0.0`
- `react` and `react-dom` `^18.0.0 || ^19.0.0`
- `nodemailer` follows the mailer major's own peer: `>=6.4.6` on v2, `>=8.0.5` on v3 and v4

## Setup

Enable the React JSX transform in `tsconfig.json`.

```jsonc
{
  "compilerOptions": {
    // add this line
    "jsx": "react-jsx"
  }
}
```

Templates must be compiled to JavaScript first. The adapter loads only `.js`, `.cjs` and `.mjs` files and appends those extensions, in that order, to a name without one. With `nest build` (tsc), templates under `src/templates` compile to `dist/templates`. With SWC, compile them in a separate step (the SWC example uses gulp).

Templates are loaded once per process and cached by Node, so changes to a template file take effect after the application restarts.

## Configuration

```ts
// src/app.module.ts
import { join } from "node:path";

import { Module } from "@nestjs/common";
import { MailerModule } from "@nestjs-modules/mailer";
import { ReactAdapter } from "@webtre/nestjs-mailer-react-adapter";

@Module({
  imports: [
    MailerModule.forRoot({
      transport: {
        host: "smtp.domain.com",
        port: 2525,
        secure: false,
        auth: {
          user: "user@domain.com",
          pass: "password",
        },
      },
      defaults: {
        from: '"Webtre Technologies" <hello@domain.com>',
      },
      template: {
        dir: join(__dirname, "templates"),
        adapter: new ReactAdapter({ text: true }),
      },
    }),
  ],
})
export class AppModule {}
```

`template.dirs` adds more template roots, searched after `template.dir`, in order.

Send mail with a template name and a `context`, which becomes the template's props.

```ts
import { Injectable } from "@nestjs/common";
import { MailerService } from "@nestjs-modules/mailer";

@Injectable()
export class ExampleService {
  constructor(private readonly mailerService: MailerService) {}

  public async example(): Promise<void> {
    await this.mailerService.sendMail({
      to: "john@domain.com",
      subject: "Testing react template",
      template: "welcome", // The compiled extension is appended automatically.
      context: {
        // Data passed as props to your template.
        code: "123456",
        name: "John Doe",
      },
    });
  }
}
```

```tsx
// src/templates/welcome.tsx
interface Props {
  code: string;
  name: string;
}

export default function Welcome({ name, code }: Props) {
  return (
    <div>
      Hi {name}, thanks for signing up. Your code is {code}
    </div>
  );
}
```

## Options

Pass options to the `ReactAdapter` constructor.

| Option | Default | Effect |
| --- | --- | --- |
| `pretty` | `false` | Formats the HTML with prettier. The text part is built from the unformatted HTML. |
| `text` | `false` | Fills `mail.data.text` from the rendered HTML when the mail has no text part. |
| `htmlToTextOptions` | none | [html-to-text options](https://github.com/html-to-text/node-html-to-text/tree/master/packages/html-to-text#options) for the text part. Ignored when `unstableTextConversion` is `true`. |
| `unstableTextConversion` | `false` | Builds the text part with render's in-house converter instead of html-to-text. |
| `unsafeAllowOutsideTemplateDir` | `false` | Constructor only, and only the literal `true`. Lets templates load from outside the configured roots. See [Security](#security). |
| `plainText` | none | Deprecated, use `text`. Same effect. Emits warning code `REACT_ADAPTER_DEP0001` once per process when the key is present. `text` wins when both are set. |

Any other key is passed unchanged to `@react-email/render`'s `render()`.

## Text part

Whether a text part exists without `text: true` depends on the mailer major; the contract tests in this repository pin each cell below.

| Mailer | `text` off (default) | `text: true` |
| --- | --- | --- |
| v2 (2.0.1+) | No text part | Adapter text part |
| v3 | No text part | Adapter text part |
| v4 | `sendMail`: the mailer's `textFromHtml` text. `render()`: no `text` | Adapter text part on `sendMail` and `render()` |

- A caller-supplied `text` is never replaced.
- Mail without a template passes through unchanged. v4 still derives a text part from `html`; v2 and v3 add none.
- The adapter's text uses the html-to-text defaults, which upper-cases headings. On v4 it therefore differs from the mailer's `textFromHtml` text, which keeps the original case.

## Errors

Failures reach the mailer callback as a `ReactAdapterError` with `code`, `template`, `path`, `searched`, `roots` and `cause`. On mailer v4 the send rejects with `MailerTemplateError`, whose `cause` is the `ReactAdapterError`; v2 and v3 reject with the adapter error itself. Messages carry no absolute paths, so read the `path`, `searched` and `roots` fields instead.

| Code | When |
| --- | --- |
| `ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING` | Relative template name and no `template.dir` or `template.dirs` |
| `ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND` | No candidate file exists (see `searched` and `roots`) |
| `ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED` | The file exists but cannot be loaded or inspected (see `cause`) |
| `ERR_REACT_ADAPTER_INVALID_EXPORT` | The default export is not a component |
| `ERR_REACT_ADAPTER_RENDER_FAILED` | The component threw, or `pretty` failed |
| `ERR_REACT_ADAPTER_TEXT_FAILED` | Text conversion failed |
| `ERR_REACT_ADAPTER_NO_BODY` | No template, and no `html`, `text` or `raw` |
| `ERR_REACT_ADAPTER_INVALID_MAIL` | `mail`, `mail.data`, `template` or `context` has the wrong type, or `mail.data` is not writable |
| `ERR_REACT_ADAPTER_INVALID_TEMPLATE_NAME` | Name refused on sight (NUL byte, URL scheme, device form; drive-letter and UNC names off Windows) |
| `ERR_REACT_ADAPTER_TEMPLATE_OUTSIDE_ROOT` | Real location outside the roots, or an absolute name with no roots |

`REACT_ADAPTER_ERROR_CODES` is exported for comparisons.

## Validating templates in CI

Load and render every compiled template before you deploy. Run this after your build.

```js
// check-templates.mjs (run after your build: node check-templates.mjs)
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { ReactAdapter } from "@webtre/nestjs-mailer-react-adapter";

const dir = path.resolve("dist/templates"); // the directory you pass as template.dir
const samples = { welcome: { name: "Ada", code: "123456" } }; // sample props by template name

const adapter = new ReactAdapter();
const render = (template) =>
  new Promise((resolve, reject) => {
    const mail = { data: { template, context: samples[template] ?? {} } };
    adapter.compile(mail, (error) => (error ? reject(error) : resolve(mail.data.html)), {
      template: { dir },
    });
  });

const names = readdirSync(dir, { recursive: true })
  .filter((file) => /\.(js|cjs|mjs)$/.test(file))
  .map((file) => file.replace(/\.(js|cjs|mjs)$/, "").split(path.sep).join("/"));

assert.ok(names.length > 0, `no compiled templates in ${dir}`);
for (const name of new Set(names)) {
  assert.ok((await render(name)).length > 0, `${name} rendered empty HTML`);
  console.log(`ok ${name}`);
}
```

A template missing from `samples` renders with an empty object, so a component that needs props fails; that is the signal to add a sample. The script needs Node 20.19+ and ESM. Nothing in it is tied to a test runner, so you can also wrap it in your runner's own test function.

## Security

- React escapes text and attribute values from `context`. It does not escape text inside `<style>` or `<script>`, and it does not sanitise `dangerouslySetInnerHTML`, `srcDoc` or `style`. Keep user input out of all of these.
- Validate or allow-list URLs that come from user input (`href`, `src`, `action`, `formAction`). React 19 replaces `javascript:` URLs, but React 18 is also supported, so do not rely on it. Other schemes such as `data:` pass through.
- Templates are code. They load only from inside `template.dir` and `template.dirs` (symlinks resolved) unless you construct `new ReactAdapter({ unsafeAllowOutsideTemplateDir: true })`. This stops template names from escaping, not someone who can write to the template directory.
- Some names are refused on sight, and the opt-out leaves them refused: a NUL byte, a URL scheme (anything shaped `scheme:`, so `release-2026:q1` counts), and Windows device or verbatim names, on every OS. On Linux and macOS, drive-letter and UNC names are refused too. On Windows they are confined like any absolute name, and a UNC name loads only from the server and share of a configured UNC root.
- `unsafeAllowOutsideTemplateDir` lets templates load from outside the configured roots. Templates are code, so use it only for names you control.

## Examples

Two working apps, one built with tsc and one with SWC, live in the [examples folder](https://github.com/webtretech/nestjs-mailer-react-adapter/tree/main/examples). CI builds them against the packed package.

## Upgrading from 0.2

See the [migration notes](https://github.com/webtretech/nestjs-mailer-react-adapter/blob/main/docs/MIGRATION.md).

## Credits

- [`react-email`](https://github.com/resendlabs/react-email) — build and send emails using React
- [`@nestjs-modules/mailer`](https://github.com/nest-modules/mailer) — a mailer module for Nest framework (node.js)

## License

[MIT](https://github.com/webtretech/nestjs-mailer-react-adapter/blob/main/LICENSE) License © 2022 [Webtre Technologies](https://github.com/webtretech)
