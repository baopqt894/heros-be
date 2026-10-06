import { MongoMemoryServer } from 'mongodb-memory-server';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

jest.setTimeout(180000);
describe('Website SQLite migration', () => {
  let mongo: MongoMemoryServer;
  let directory: string;
  let file: string;
  let connection: mongoose.Connection;
  const execute = promisify(execFile);
  async function run(apply = false) {
    return execute(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        'scripts/migrate-web-sqlite.ts',
        `--sqlite=${file}`,
        ...(apply ? ['--apply'] : []),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, MONGODB_URI: mongo.getUri('migration_test') },
      }
    );
  }
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    directory = await mkdtemp(join(tmpdir(), 'heros-migration-'));
    file = join(directory, 'legacy.sqlite');
    const sqlite = new DatabaseSync(file);
    sqlite.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,email TEXT,name TEXT,passwordHash TEXT,createdAt TEXT);
      CREATE TABLE orders(orderCode INTEGER PRIMARY KEY,requestId TEXT,fingerprint TEXT,accessHash TEXT,accountId TEXT,quantity INTEGER,amount INTEGER,method TEXT,status TEXT,customer TEXT,paymentLinkId TEXT,checkoutUrl TEXT,createdAt TEXT,lastChecked INTEGER,paidAt TEXT);
      CREATE TABLE contact_messages(id INTEGER PRIMARY KEY,message TEXT);`);
    sqlite
      .prepare('INSERT INTO accounts VALUES(?,?,?,?,?)')
      .run(
        'legacy-buyer',
        'buyer@example.com',
        'Buyer',
        `${'a'.repeat(32)}:${'b'.repeat(128)}`,
        new Date().toISOString()
      );
    sqlite
      .prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        123,
        'legacy-request',
        'fingerprint',
        'c'.repeat(64),
        'legacy-buyer',
        1,
        590000,
        'cod',
        'COD_CONFIRMED',
        JSON.stringify({
          name: 'Buyer',
          email: 'buyer@example.com',
          phone: '0900000000',
          address: 'Legacy address',
        }),
        null,
        null,
        new Date().toISOString(),
        0,
        null
      );
    sqlite
      .prepare('INSERT INTO contact_messages VALUES(?,?)')
      .run(1, 'Contact stays local');
    sqlite.close();
    connection = await mongoose
      .createConnection(mongo.getUri('migration_test'))
      .asPromise();
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('dry-run does not create collections; import preserves identity/orders and can be re-run', async () => {
    expect((await run()).stdout).toContain('"mode":"dry-run"');
    expect(await connection.db.listCollections().toArray()).toEqual([]);
    await run(true);
    await run(true);
    const users = connection.collection('users');
    const orders = connection.collection('commerce_orders');
    expect(await users.countDocuments()).toBe(1);
    expect(await orders.countDocuments()).toBe(1);
    const user = await users.findOne({ legacyWebAccountId: 'legacy-buyer' });
    const order = await orders.findOne({ orderCode: 123 });
    expect(order.accountId.toString()).toBe(user._id.toString());
    expect(user.passwordHash).toBe(`${'a'.repeat(32)}:${'b'.repeat(128)}`);
    expect(user.emailVerifiedAt).toBeUndefined();
    expect(order.customer.address).toBe('Legacy address');
    expect(
      await connection.collection('commerce_contact_messages').countDocuments()
    ).toBe(0);
    const sqlite = new DatabaseSync(file, { readOnly: true });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM contact_messages').get()
        .count
    ).toBe(1);
    sqlite.close();
  });
  it('stops on an existing mobile identity conflict without overwriting its password', async () => {
    await connection.collection('commerce_orders').deleteMany({});
    await connection.collection('users').deleteMany({});
    await connection
      .collection('users')
      .insertOne({
        email: 'buyer@example.com',
        passwordHash: 'existing-mobile-password',
        status: 'active',
      });
    await expect(run(true)).rejects.toMatchObject({ code: 1 });
    expect(await connection.collection('users').countDocuments()).toBe(1);
    expect(
      (
        await connection
          .collection('users')
          .findOne({ email: 'buyer@example.com' })
      ).passwordHash
    ).toBe('existing-mobile-password');
    expect(
      await connection.collection('commerce_orders').countDocuments()
    ).toBe(0);
  });
});
