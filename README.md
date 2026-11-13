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
        auth: { user: "user@domain.com", pass: "password" },
      },
      defaults: { from: '"Webtre Technologies" <hello@domain.com>' },
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
await this.mailerService.sendMail({
  to: "john@domain.com",
  subject: "Testing react template",
  template: "welcome", // The compiled extension is appended automatically.
  context: { name: "John Doe", code: "123456" }, // Passed as props to the template.
});
```

```tsx
// src/templates/welcome.tsx
export default function Welcome({ name, code }: { name: string; code: string }) {
  return <div>Hi {name}, thanks for signing up. Your code is {code}</div>;
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

Any other key is passed unchanged to `@react-email/render`'s `render()` at runtime, although `ReactAdapterOptions` does not type it.

## Text part

| Mailer | `text` off (default) | `text: true` |
| --- | --- | --- |
| v2, v3 | No text part | Adapter text part |
| v4 | `sendMail`: the mailer's `textFromHtml` text; `render()`: no `text` | Adapter text part on `sendMail` and `render()` |

A `text` you pass yourself is never replaced.

## Errors

Failures are a `ReactAdapterError` with a `code` (`REACT_ADAPTER_ERROR_CODES` is exported); on mailer v4 it is the `cause` of `MailerTemplateError`.
All codes and fields: [docs/ERRORS.md](https://github.com/webtretech/nestjs-mailer-react-adapter/blob/main/docs/ERRORS.md).

## Validating templates in CI

A short script loads and renders every compiled template after the build and fails on a missing or broken template.
Copy it from [docs/VALIDATING-TEMPLATES.md](https://github.com/webtretech/nestjs-mailer-react-adapter/blob/main/docs/VALIDATING-TEMPLATES.md).

## Security

- React escapes text and attribute values from `context`. It does not escape text inside `<style>` or `<script>`, and it does not sanitise `dangerouslySetInnerHTML`, `srcDoc` or `style`. Keep user input out of all of these.
- Validate or allow-list URLs that come from user input (`href`, `src`, `action`, `formAction`). React 19 replaces `javascript:` URLs, but React 18 is also supported, so do not rely on it.
- Templates are code. They load only from inside `template.dir` and `template.dirs` (symlinks resolved) unless you construct `new ReactAdapter({ unsafeAllowOutsideTemplateDir: true })`. The opt-out is constructor-only.

Refused names and the opt-out in detail: [docs/TEMPLATE-SECURITY.md](https://github.com/webtretech/nestjs-mailer-react-adapter/blob/main/docs/TEMPLATE-SECURITY.md).

## Examples

Two working apps, one built with tsc and one with SWC, live in the [examples folder](https://github.com/webtretech/nestjs-mailer-react-adapter/tree/main/examples). CI builds them against the packed package.

## Upgrading from 0.2

See the [migration notes](https://github.com/webtretech/nestjs-mailer-react-adapter/blob/main/docs/MIGRATION.md).

## Credits

- [`react-email`](https://github.com/resendlabs/react-email) — build and send emails using React
- [`@nestjs-modules/mailer`](https://github.com/nest-modules/mailer) — a mailer module for Nest framework (node.js)

## License

[MIT](https://github.com/webtretech/nestjs-mailer-react-adapter/blob/main/LICENSE) License © 2022 [Webtre Technologies](https://github.com/webtretech)
