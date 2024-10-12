import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { ReactAdapter } from '@webtre/nestjs-mailer-react-adapter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import mailerConfig from './config/mailer.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [mailerConfig],
      envFilePath: __dirname + '/../.env',
    }),
    MailerModule.forRootAsync({
      inject: [mailerConfig.KEY],
      useFactory: (mailerConf: ConfigType<typeof mailerConfig>) => ({
        ...mailerConf,
        template: {
          adapter: new ReactAdapter(),
          dir: __dirname + '/templates',
        },
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
