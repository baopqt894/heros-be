import 'reflect-metadata';
import mongoose, { Connection } from 'mongoose';
import { REVIEWER_DEMO_EMAILS } from '../src/modules/auth/reviewer-demo';

export async function seedReviewerAccounts(connection: Connection) {
  const profiles = [
    {
      email: REVIEWER_DEMO_EMAILS[0],
      fullName: 'HEROS Reviewer Owner',
      userType: 'device_owner',
    },
    {
      email: REVIEWER_DEMO_EMAILS[1],
      fullName: 'HEROS Reviewer Contact',
      userType: 'emergency_contact',
    },
  ];
  const users = connection.collection('users');
  const now = new Date();
  for (const profile of profiles) {
    await users.updateOne(
      { email: profile.email },
      {
        $set: {
          ...profile,
          emailVerifiedAt: now,
          status: 'active',
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
          dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
          responderEnabled: false,
          responderRadiusMeters: 5000,
        },
      },
      { upsert: true }
    );
  }
  const owner = await users.findOne({ email: REVIEWER_DEMO_EMAILS[0] });
  const contact = await users.findOne({ email: REVIEWER_DEMO_EMAILS[1] });
  if (!owner || !contact) throw new Error('REVIEWER_ACCOUNT_SEED_FAILED');
  const contacts = connection.collection('emergency_contacts');
  // Reuse a pending/unlinked entry for this exact demo email if one exists.
  const existing = await contacts.findOne({
    ownerId: owner._id,
    $or: [{ linkedUserId: contact._id }, { email: contact.email }],
  });
  await contacts.updateOne(
    existing
      ? { _id: existing._id }
      : { ownerId: owner._id, linkedUserId: contact._id },
    {
      $set: {
        ownerId: owner._id,
        linkedUserId: contact._id,
        name: contact.fullName,
        email: contact.email,
        relationship: 'Người thân demo',
        priority: 0,
        emailEnabled: false,
        pushEnabled: true,
        invitationStatus: 'accepted',
        invitationRespondedAt: now,
        updatedAt: now,
      },
      $unset: { inviteTokenHash: 1, inviteExpiresAt: 1, inviteEmail: 1 },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  return {
    owner: {
      id: owner._id.toString(),
      email: owner.email,
      userType: owner.userType,
    },
    contact: {
      id: contact._id.toString(),
      email: contact.email,
      userType: contact.userType,
    },
    invitationStatus: 'accepted',
  };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    });
    console.log(
      JSON.stringify(await seedReviewerAccounts(mongoose.connection))
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    // Connection errors can contain database hosts; never log connection strings.
    console.error(
      `REVIEWER_SEED_FAILED ${error?.code || error?.name || 'ERROR'}`
    );
    process.exitCode = 1;
  });
}
