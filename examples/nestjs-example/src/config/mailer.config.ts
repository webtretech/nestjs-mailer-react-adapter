import { MailerOptions } from '@nestjs-modules/mailer';
import { registerAs } from '@nestjs/config';

export default registerAs('mailer', (): MailerOptions => {
  return {
    transport: {
      service: process.env.MAIL_SERVICE,
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT, 10),
      auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
      },
    },
    defaults: {
      from: {
        name: process.env.MAIL_FROM_NAME,
        address: process.env.MAIL_FROM_ADDRESS,
      },
    },
  };
});
