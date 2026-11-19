import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { ContactModule } from '../modules/contact/contact.module';
import {
  ContactMessage,
  ContactMessageDocument,
} from '../modules/contact/contact.schema';
import { AuthGuard } from '../common/guards/auth.guard';
import { UsersService } from '../modules/users/users.service';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { ApiResponseInterceptor } from '../common/interceptors/api-response.interceptor';

jest.setTimeout(120000);
describe('Contact API with isolated MongoDB', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let model: Model<ContactMessageDocument>;
  let config: ConfigService;
  let base: string;
  const key = randomBytes(32).toString('hex');
  const body = {
    name: 'Feedback test',
    email: 'test@example.com',
    phone: '',
    message: 'Isolated test feedback',
  };
  const post = (input: unknown) =>
    fetch(base + '/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  const get = (token?: string, after = '0') =>
    fetch(base + '/contact/export?after=' + after, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ HEROS_FEEDBACK_EXPORT_KEY: key })],
        }),
        MongooseModule.forRoot(mongo.getUri()),
        ContactModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn().mockRejectedValue(new Error('No test user')),
          },
        },
        { provide: UsersService, useValue: { assertSession: jest.fn() } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/v1';
    model = app.get(getModelToken(ContactMessage.name));
    config = app.get(ConfigService);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (mongo) await mongo.stop();
  });

  it('validates input and persists a public message before acknowledging it', async () => {
    for (const patch of [
      { name: ' ' },
      { email: 'invalid' },
      { phone: 'abc' },
      { message: 'x' },
      { message: 'x'.repeat(2001) },
      { admin: true },
    ])
      expect((await post({ ...body, ...patch })).status).toBe(400);
    expect(await model.countDocuments()).toBe(0);
    const response = await post({
      ...body,
      name: '  Feedback test  ',
      phone: '0900000000',
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.data.id).toMatch(/^[a-f0-9]{24}$/);
    const saved = await model.findById(result.data.id);
    expect(saved?.name).toBe(body.name);
    expect(saved?.phone).toBe('0900000000');
  });

  it('denies export without the dedicated key, even though the route bypasses user JWT auth', async () => {
    expect((await get()).status).toBe(401);
    expect((await get('wrong')).status).toBe(401);
    for (const cursor of ['-1', '1.5', 'abc', '9007199254740992'])
      expect((await get(key, cursor)).status).toBe(400);
    config.set('HEROS_FEEDBACK_EXPORT_KEY', '');
    expect((await get(key)).status).toBe(503);
    config.set('HEROS_FEEDBACK_EXPORT_KEY', key);
  });

  it('paginates all saved records and exposes only approved export fields', async () => {
    await model.insertMany(Array.from({ length: 200 }, () => ({ ...body })));
    const firstResponse = await get(key);
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('cache-control')).toBe(
      'private, no-store'
    );
    const first = (await firstResponse.json()).data;
    expect(first.messages).toHaveLength(200);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe(200);
    expect(Object.keys(first.messages[0]).sort()).toEqual(
      ['id', 'name', 'email', 'phone', 'message', 'createdAt'].sort()
    );
    const second = (await (await get(key, '200')).json()).data;
    expect(second.messages).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBe(201);
    expect(
      new Set([...first.messages, ...second.messages].map((row) => row.id)).size
    ).toBe(201);
  });

  it('does not report success if MongoDB rejects the write', async () => {
    const spy = jest
      .spyOn(model, 'create')
      .mockRejectedValueOnce(new Error('Database unavailable'));
    try {
      const response = await post(body);
      expect(response.status).toBe(503);
      expect((await response.json()).data.errorCode).toBe(
        'CONTACT_STORAGE_UNAVAILABLE'
      );
    } finally {
      spy.mockRestore();
    }
    expect(await model.countDocuments()).toBe(201);
  });

  it('limits repeated submissions', async () => {
    let status = 201;
    for (let index = 0; index < 31 && status !== 429; index++)
      status = (await post(body)).status;
    expect(status).toBe(429);
  });
});
