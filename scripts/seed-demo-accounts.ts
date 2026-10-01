import 'reflect-metadata';
import mongoose from 'mongoose';
import { PasswordService } from '../src/modules/auth/password.service';

const DEMO_USERS = [
  {
    email: 'owner@heros.vn',
    fullName: 'Nguyễn Thị A',
    phone: '+84900000001',
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
    userType: 'device_owner',
  },
  {
    email: 'contact@heros.vn',
    fullName: 'Người thân HEROS',
    phone: '+84900000002',
    dateOfBirth: new Date('1992-01-01T00:00:00.000Z'),
    userType: 'emergency_contact',
  },
] as const;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);
  const passwordHash = await new PasswordService().hash('123456');
  const users = mongoose.connection.db.collection('users');

  for (const user of DEMO_USERS) {
    await users.updateOne(
      { email: user.email },
      {
        $set: {
          ...user,
          emailVerifiedAt: new Date(),
          passwordHash,
          status: 'active',
          updatedAt: new Date(),
        },
        $setOnInsert: {
          responderEnabled: false,
          responderRadiusMeters: 5000,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  const owner = await users.findOne({ email: 'owner@heros.vn' });
  const contact = await users.findOne({ email: 'contact@heros.vn' });
  if (!owner || !contact) throw new Error('Could not create demo users');
  await mongoose.connection.db.collection('emergency_contacts').updateOne(
    { ownerId: owner._id, linkedUserId: contact._id },
    {
      $set: {
        name: contact.fullName,
        phone: contact.phone,
        email: contact.email,
        relationship: 'Người thân',
        priority: 0,
        emailEnabled: true,
        pushEnabled: true,
        invitationStatus: 'accepted',
        invitationRespondedAt: new Date(),
        updatedAt: new Date(),
      },
      $setOnInsert: {
        ownerId: owner._id,
        linkedUserId: contact._id,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  await mongoose.disconnect();
  console.log('Demo accounts are ready: owner@heros.vn, contact@heros.vn');
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
