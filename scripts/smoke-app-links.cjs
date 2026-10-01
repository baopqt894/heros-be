// Boots only the public-link controller: no MongoDB, cleanup jobs or real notifications.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { Module, RequestMethod } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const {
  AppLinksController,
} = require('../dist/modules/emergency-contacts/app-links.controller');
const {
  ApiResponseInterceptor,
} = require('../dist/common/interceptors/api-response.interceptor');
class SmokeModule {}
Module({
  controllers: [AppLinksController],
  providers: [{ provide: ConfigService, useValue: new ConfigService({}) }],
})(SmokeModule);

(async () => {
  const app = await NestFactory.create(SmokeModule, { logger: false });
  try {
    app.setGlobalPrefix('v1', {
      exclude: [
        { path: 'invite', method: RequestMethod.GET },
        {
          path: '.well-known/apple-app-site-association',
          method: RequestMethod.GET,
        },
      ],
    });
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useStaticAssets(join(process.cwd(), 'public', 'invite-assets'), {
      prefix: '/invite-assets/',
    });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const config = await (await fetch(base + '/v1/app-config')).json();
    assert.equal(config.data.distributionChannel, 'testflight');
    assert.equal(config.data.iosDownloadUrl, null);
    const aasa = await (
      await fetch(base + '/.well-known/apple-app-site-association')
    ).json();
    assert.deepEqual(aasa.applinks.details, []);
    const page = await fetch(base + '/invite');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.match(await page.text(), /invite-assets\/invite.js/);
    assert.equal((await fetch(base + '/invite-assets/invite.js')).status, 200);
    console.log('Public link HTTP smoke passed: ' + base);
    if (process.argv.includes('--serve')) {
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, async () => {
          await app.close();
          process.exit(0);
        });
      return;
    }
  } finally {
    if (!process.argv.includes('--serve')) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
