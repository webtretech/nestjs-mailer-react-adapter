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

- 🦾 Write your email templates in [React](https://github.com/facebook/react/) and [TypeScript](https://www.typescriptlang.org/)

- 📬 No more template not found / sending blank emails.

- 🔰 No more missing context / variables from template.

- 🧪 Write testable templates intended for email clients.

- 💌 Built on top of [`react-email`](https://github.com/resendlabs/react-email) — the next generation of writing emails.

## Installation

> This library is an adapter for the [`@nestjs-modules/mailer`](https://github.com/nest-modules/mailer) module, so we'll install the dependencies alongside by running the command below.

```sh
npm i @webtre/nestjs-mailer-react-adapter @nestjs-modules/mailer nodemailer
```

### Getting Started

To add support for `React` to your project, modify `tsconfig.json`

```javascript
{
  "compilerOptions": {
    // add this line
    "jsx": "react-jsx"
  }
}
```

### Configuration

```javascript
// src/app.module.ts
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
        dir: __dirname + "/templates",
        // Use the adapter
        adapter: new ReactAdapter(),

        // Or with optional config
        adapter: new ReactAdapter({
          pretty: false,
          plainText: true,
          htmlToTextOptions: {
            wordwrap: 130,
            limits: {
              ellipsis: "...",
            },
          },
        }),
      },
    }),
  ],
})
export class AppModule {}
```

To see more options that can be passed to the `htmlToTextOptions` object, [click here](https://github.com/html-to-text/node-html-to-text/tree/master/packages/html-to-text#options).

### Service Provider

```javascript
import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class ExampleService {
  constructor(private readonly mailerService: MailerService) {}

  async public example(): Promise<void> {
    await this.mailerService
      .sendMail({
        to: 'john@domain.com',
        subject: 'Testing react template',
        template: 'welcome', // The compiled extension is appended automatically.
        context: { // Data to be passed as props to your template.
          code: '123456',
          name: 'John Doe',
        },
      });
  }
}
```

### React Template

```javascript
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
Templates are loaded once per process and cached by Node, so changes to a template file take effect after the application restarts.

## Security

- React escapes ordinary text and attribute values that you pass through `context`, so `<`, `>`, `&` and quotes cannot start a tag or leave an attribute. Text placed inside a `<style>` or `<script>` element is not escaped as HTML text, because React only neutralises the closing-tag sequence there. Never put user input inside those elements.
- That protection stops at the meaning of a value. In `href`, `src`, `action` and `formAction`, React 19 replaces `javascript:` URLs, while `data:` and every other scheme pass through. Do not rely on that replacement: this package also supports React 18 (peer range `^18.0.0 || ^19.0.0`), so validate or allow-list any URL that comes from user input on every React version.
- `dangerouslySetInnerHTML`, `srcDoc` and `style` values are inserted without sanitising; `srcDoc` and `style` get only attribute escaping, so the markup or CSS you pass reaches the page intact. Never pass user input to them.
- Templates are code. They load only from inside `template.dir` and `template.dirs`, with symlinks resolved; names with a NUL byte or a URL scheme never load, and drive-letter and UNC names load only on Windows. `new ReactAdapter({ unsafeAllowOutsideTemplateDir: true })` is the only way to load a template from elsewhere. This guards against template names that try to escape, not against someone who can write into the template directory.

## Examples

You could also check the [examples folder](./examples) in this repo for a working usage example and how to set it up with [SWC](https://docs.nestjs.com/recipes/swc) using [gulp](https://gulpjs.com/).

## Credits

- [`react-email`](https://github.com/resendlabs/react-email) — build and send emails using React
- [`@nestjs-modules/mailer`](https://github.com/nest-modules/mailer) — a mailer module for Nest framework (node.js)

## License

[MIT](./LICENSE) License © 2022 [Webtre Technologies](https://github.com/webtretech)
