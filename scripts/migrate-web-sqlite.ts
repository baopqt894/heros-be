import { DatabaseSync } from 'node:sqlite';
import mongoose, { Types } from 'mongoose';
import { resolve } from 'node:path';
import { UserSchema } from '../src/modules/users/schemas/user.schema';
import { CommerceOrderSchema } from '../src/modules/commerce/commerce.schema';

// Run with --apply only after reviewing the dry-run and stopping legacy web writes.
async function main() {
  const file = process.argv
    .find((arg) => arg.startsWith('--sqlite='))
    ?.slice(9);
  if (!file || !process.env.MONGODB_URI)
    throw new Error(
      'Provide --sqlite=/absolute/path/heros.sqlite and MONGODB_URI'
    );
  const sqlite = new DatabaseSync(resolve(file), { readOnly: true });
  const connection = await mongoose
    .createConnection(process.env.MONGODB_URI, {
      autoIndex: false,
      autoCreate: false,
    })
    .asPromise();
  try {
    const users = connection.model('User', UserSchema);
    const orders = connection.model('CommerceOrder', CommerceOrderSchema);
    const accounts = sqlite
      .prepare('SELECT id,email,name,passwordHash,createdAt FROM accounts')
      .all() as unknown as Array<{
      id: string;
      email: string;
      name: string;
      passwordHash: string;
      createdAt: string;
    }>;
    const sourceOrders = sqlite
      .prepare('SELECT * FROM orders')
      .all() as unknown as Array<Record<string, any>>;
    const mapping = new Map<string, Types.ObjectId>();
    let conflicts = 0;
    for (const account of accounts) {
      const email = account.email.trim().toLowerCase();
      const existing = await users.findOne({
        $or: [{ email }, { legacyWebAccountId: account.id }],
      });
      if (
        existing &&
        (existing.legacyWebAccountId !== account.id ||
          existing.email !== email ||
          existing.status !== 'active')
      ) {
        // An unverified legacy email alone must never overwrite an existing mobile identity.
        console.error(`ACCOUNT_CONFLICT legacyId=${account.id}`);
        conflicts++;
      }
      if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(account.passwordHash)) {
        console.error(`PASSWORD_FORMAT_INVALID legacyId=${account.id}`);
        conflicts++;
      }
      mapping.set(account.id, existing?._id || new Types.ObjectId());
    }
    for (const order of sourceOrders) {
      if (order.accountId && !mapping.has(order.accountId)) {
        console.error(`ORDER_ACCOUNT_MISSING code=${order.orderCode}`);
        conflicts++;
      }
      const existing = await orders.findOne({
        $or: [{ orderCode: order.orderCode }, { requestId: order.requestId }],
      });
      if (
        existing &&
        (existing.orderCode !== order.orderCode ||
          existing.requestId !== order.requestId ||
          existing.fingerprint !== order.fingerprint ||
          (existing.accountId?.toString() || null) !==
            (order.accountId ? mapping.get(order.accountId)?.toString() : null))
      ) {
        console.error(`ORDER_CONFLICT code=${order.orderCode}`);
        conflicts++;
      }
      JSON.parse(order.customer);
    }
    console.log(
      JSON.stringify({
        accounts: accounts.length,
        orders: sourceOrders.length,
        conflicts,
        mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
        contactMessages: 'unchanged',
        sessions: 'not imported',
      })
    );
    if (conflicts)
      throw new Error(
        'Resolve identity/order conflicts before migration; nothing was imported'
      );
    if (!process.argv.includes('--apply')) return;
    await Promise.all([users.createIndexes(), orders.createIndexes()]);
    for (const account of accounts) {
      await users.updateOne(
        { legacyWebAccountId: account.id },
        {
          $setOnInsert: {
            _id: mapping.get(account.id),
            legacyWebAccountId: account.id,
            email: account.email.trim().toLowerCase(),
            fullName: account.name,
            passwordHash: account.passwordHash,
            userType: 'device_owner',
            status: 'active',
            createdAt: new Date(account.createdAt),
          },
        },
        { upsert: true, runValidators: true }
      );
    }
    for (const row of sourceOrders) {
      const { accountId, customer, createdAt, paidAt, ...fields } = row;
      await orders.updateOne(
        { orderCode: row.orderCode, requestId: row.requestId },
        {
          $setOnInsert: {
            ...fields,
            accountId: accountId ? mapping.get(accountId) : null,
            customer: JSON.parse(customer),
            createdAt: new Date(createdAt),
            paidAt: paidAt ? new Date(paidAt) : null,
          },
        },
        { upsert: true, runValidators: true }
      );
    }
    console.log(
      'MIGRATION_COMPLETED; legacy SQLite was not changed. Re-running is supported.'
    );
  } finally {
    sqlite.close();
    await connection.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
