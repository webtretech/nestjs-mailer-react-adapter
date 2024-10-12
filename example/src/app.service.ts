import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  constructor(private readonly mailerService: MailerService) {}

  public async sendWelcomeMail(): Promise<string> {
    await this.mailerService.sendMail({
      to: 'john@domain.com',
      subject: 'Testing react template',
      template: 'welcome', // The compiled extension is appended automatically.
      context: {
        // Data to be passed as props to your template.
        code: '123456',
        name: 'John Doe',
      },
    });

    return 'Mail sent!';
  }
}
