## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Mail transport

Set `MAIL_TRANSPORT=json` to use nodemailer's JSON transport, which builds the message without sending it. Any other value uses the SMTP settings from `.env`; see `.env.example`.

```bash
$ MAIL_TRANSPORT=json npm run start
```

## Run against the local build

`npm install` in this folder installs the published `@webtre/nestjs-mailer-react-adapter`. To try the adapter as it exists in this repository instead, run this from the repository root:

```bash
$ npm run verify:examples -- nestjs-example
```

It packs the adapter from the working tree, installs it into a scratch copy of this app, builds the app and sends the welcome mail through the JSON transport.
