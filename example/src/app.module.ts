import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MailerModule } from '@nestjs-modules/mailer';
import { ReactAdapter } from '@webtre/nestjs-mailer-react-adapter';

@Module({
  imports: [
    MailerModule.forRoot({
      transport: {
        host: 'smtp.domain.com',
        port: 2525,
        secure: false,
        auth: {
          user: 'user@domain.com',
          pass: 'password',
        },
      },
      defaults: {
        from: '"Webtre Technologies" <hello@domain.com>',
      },
      template: {
        dir: __dirname + '/templates',
        adapter: new ReactAdapter(),
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
