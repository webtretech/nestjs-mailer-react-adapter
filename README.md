<p align="center">
  <a href="http://nestjs.com/" target="blank">
    <img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" />
  </a>
</p>

<p align="center">
  📧 Build and send emails in Nest framework using React.js
</p>

<p align="center">
  <a href="https://www.npmjs.com/org/webtre"><img src="https://img.shields.io/npm/v/@webtre/nestjs-mailer-react-adapter.svg" alt="NPM Version" /></a>
  <a href="https://www.npmjs.com/org/webtre"><img src="https://img.shields.io/npm/l/@webtre/nestjs-mailer-react-adapter.svg" alt="Package License" /></a>
  <a href="https://www.npmjs.com/org/webtre"><img src="https://img.shields.io/npm/dm/@webtre/nestjs-mailer-react-adapter.svg" alt="NPM Downloads" /></a>
</p>

## Features

- ⚡️ Write you mail templates in [React](https://github.com/facebook/react/) and [TypeScript](https://www.typescriptlang.org/)

- 🦾 Write testable mail templates intended for mail clients.

- ⛔ No more template not found or sending blank emails.

- ⛔ No more issues of missing context / variables from template.

- 💌 Built on [`react-email`](https://github.com/zenorocha/react-email) - it reduces the pain of coding responsive emails with dark mode support.

## Installation

```sh
npm install --save @webtre/nestjs-mailer-react-adapter @nestjs-modules/mailer react
npm install --save-dev @types/react
```

### Getting Started

1. Add this to your `tsconfig.json` if it's not already

```json
"jsx": "react-jsx"
```

2. Configuration

```javascript
//app.module.ts
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
        adapter: new ReactAdapter(),
      },
    }),
  ],
})
export class AppModule {}
```

3. Service Provider

```javascript
import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class ExampleService {
  constructor(private readonly mailerService: MailerService) {}

  async public example(): void {
    await this.mailerService
      .sendMail({
        to: 'john@domain.com',
        subject: 'Testing react template',
        template: 'welcome', // The compiled extension is appended automatically.
        context: {
          // Data to be passed as props to your template.
          code: '123456',
          name: 'John Doe',
        },
      });
  }
}
```

4. React Template (ensure its always a `default` export)

```javascript
// welcome.tsx
interface WelcomeProps {
  code: string;
  name: string;
}

export default function Welcome({ name, code }: WelcomeProps) {
  return (
    <div>
      Hi {name}, thanks for signing up. Your code is {code}
    </div>
  );
}
```

## Credits

- [`react-email`](https://github.com/zenorocha/react-email) - build and send emails using React
- [`@nestjs-modules/mailer`](https://github.com/nest-modules/mailer) - a mailer module for Nest framework (node.js)

## License

Copyright (c) 2022 <a href="https://github.com/@webtre/nestjs-mailer-react-adapter/blob/master/LICENSE" target="_blank">MIT</a>, <a href="https://github.com/webtretech" target="_blank">Webtre Technologies</a>
