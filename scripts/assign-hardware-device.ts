import 'reflect-metadata';
import mongoose, { Connection, Model } from 'mongoose';
import { createHash } from 'node:crypto';
import {
  HardwareDevice,
  HardwareDeviceDocument,
  HardwareDeviceSchema,
} from '../src/modules/hardware-devices/schemas/hardware-device.schema';

export async function assignHardwareDevice(
  connection: Connection,
  input: {
    email: string;
    hardwareId: string;
    deviceToken?: string;
    label?: string;
  }
) {
  const email = input.email?.trim().toLowerCase();
  const hardwareId = input.hardwareId?.trim().toUpperCase();
  if (!email || !hardwareId || !/^[A-Z0-9][A-Z0-9._:-]{3,99}$/.test(hardwareId))
    throw new Error('INVALID_ASSIGNMENT_INPUT');
  if (input.label !== undefined && input.label.length > 120)
    throw new Error('INVALID_DEVICE_LABEL');
  if (
    input.deviceToken !== undefined &&
    !/^hdv_[A-Za-z0-9_-]{32,200}$/.test(input.deviceToken)
  )
    throw new Error('INVALID_DEVICE_TOKEN');

  const owner = await connection
    .collection('users')
    .findOne({ email, status: 'active', userType: 'device_owner' });
  if (!owner) throw new Error('ACTIVE_DEVICE_OWNER_REQUIRED');
  const devices: Model<HardwareDevice> =
    (connection.models[HardwareDevice.name] as Model<HardwareDevice>) ||
    connection.model<HardwareDevice>(HardwareDevice.name, HardwareDeviceSchema);
  // Build the same unique owner/hardware indexes as the backend before assigning.
  await devices.init();
  const digest = input.deviceToken
    ? createHash('sha256').update(input.deviceToken).digest('hex')
    : undefined;
  const verifyExisting = (existing: HardwareDeviceDocument) => {
    if (existing.ownerId.toString() !== owner._id.toString())
      throw new Error('HARDWARE_DEVICE_ALREADY_PAIRED');
    if (existing.activationPending) throw new Error('DEVICE_ACTIVATION_PENDING');
    if (!existing.enabled) throw new Error('HARDWARE_DEVICE_DISABLED');
    if (digest && existing.secretHash !== digest)
      throw new Error('DEVICE_TOKEN_MISMATCH');
    return {
      id: existing._id.toString(),
      hardwareId: existing.hardwareId,
      assigned: true,
      created: false,
    };
  };
  const existing = await devices.findOne({ hardwareId }).select('+secretHash');
  if (existing) return verifyExisting(existing);
  if (await devices.exists({ ownerId: owner._id }))
    throw new Error('OWNER_ALREADY_HAS_HARDWARE_DEVICE');
  if (!digest) throw new Error('PREINSTALLED_DEVICE_TOKEN_REQUIRED');
  try {
    const device = await devices.create({
      ownerId: owner._id,
      hardwareId,
      secretHash: digest,
      enabled: true,
      label: input.label?.trim(),
    });
    return {
      id: device._id.toString(),
      hardwareId: device.hardwareId,
      assigned: true,
      created: true,
    };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const raced = await devices.findOne({ hardwareId }).select('+secretHash');
    if (raced) return verifyExisting(raced);
    throw new Error('OWNER_ALREADY_HAS_HARDWARE_DEVICE');
  }
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI_REQUIRED');
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    });
    console.log(
      JSON.stringify(
        await assignHardwareDevice(mongoose.connection, {
          email: process.argv[2],
          hardwareId: process.argv[3],
          label: process.argv[4],
          deviceToken: process.env.HEROS_PROVISION_DEVICE_TOKEN,
        })
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    const code =
      typeof error?.message === 'string' && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : 'ASSIGNMENT_FAILED';
    console.error(`DEVICE_ASSIGN_FAILED ${code}`);
    process.exitCode = 1;
  });
}
