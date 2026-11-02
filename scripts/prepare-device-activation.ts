import 'reflect-metadata';
import mongoose, { Connection, Model } from 'mongoose';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../src/modules/auth/email.service';
import { HardwareDevice, HardwareDeviceSchema } from '../src/modules/hardware-devices/schemas/hardware-device.schema';
import { deviceActivationHash, generateDeviceActivationCode, normalizeDeviceActivationCode } from '../src/modules/hardware-devices/device-activation-code';

export async function prepareDeviceActivation(connection: Connection, input: {
  orderCode: number; hardwareId: string; activationCode: string; deviceToken?: string;
}) {
  const hardwareId = input.hardwareId?.trim().toUpperCase();
  const normalized = normalizeDeviceActivationCode(input.activationCode);
  if (!Number.isSafeInteger(input.orderCode) || input.orderCode <= 0 ||
      !hardwareId || !/^[A-Z0-9][A-Z0-9._:-]{3,99}$/.test(hardwareId) || !normalized)
    throw new Error('INVALID_ACTIVATION_INPUT');
  const order = await connection.collection('commerce_orders').findOne({
    orderCode: input.orderCode, status: { $in: ['PAID', 'COD_CONFIRMED'] },
  });
  if (!order?.accountId) throw new Error('CONFIRMED_ACCOUNT_ORDER_REQUIRED');
  // Multi-device purchases require an explicit recipient/fulfillment policy.
  if (order.quantity !== 1) throw new Error('MULTI_DEVICE_ORDER_REQUIRES_MANUAL_HANDLING');
  const owner = await connection.collection('users').findOne({ _id: order.accountId, status: 'active', userType: 'device_owner' });
  if (!owner) throw new Error('ACTIVE_DEVICE_OWNER_REQUIRED');
  const devices: Model<HardwareDevice> = (connection.models[HardwareDevice.name] as Model<HardwareDevice>) || connection.model<HardwareDevice>(HardwareDevice.name, HardwareDeviceSchema);
  await devices.init();
  const codeHash = deviceActivationHash(normalized);
  const existing = await devices.findOne({ hardwareId }).select('+secretHash +activationCodeHash');
  if (input.deviceToken !== undefined && !/^hdv_[A-Za-z0-9_-]{32,200}$/.test(input.deviceToken))
    throw new Error('INVALID_DEVICE_TOKEN');
  const secretHash = input.deviceToken ? createHash('sha256').update(input.deviceToken).digest('hex') : undefined;
  if (existing) {
    if (existing.ownerId.toString() !== owner._id.toString()) throw new Error('HARDWARE_DEVICE_ALREADY_PAIRED');
    if (!existing.activationPending || !existing.enabled) throw new Error('DEVICE_NOT_PENDING_ACTIVATION');
    if (existing.activationOrderCode !== input.orderCode || existing.activationCodeHash !== codeHash) throw new Error('ACTIVATION_RESERVATION_CONFLICT');
    if (secretHash && existing.secretHash !== secretHash) throw new Error('DEVICE_TOKEN_MISMATCH');
    return { id: existing._id.toString(), hardwareId, email: owner.email, created: false };
  }
  if (await devices.exists({ ownerId: owner._id })) throw new Error('OWNER_ALREADY_HAS_HARDWARE_DEVICE');
  if (!secretHash) throw new Error('PREINSTALLED_DEVICE_TOKEN_REQUIRED');
  try {
    const device = await devices.create({ ownerId: owner._id, hardwareId, secretHash,
      enabled: true, activationPending: true, activationCodeHash: codeHash, activationOrderCode: input.orderCode });
    return { id: device._id.toString(), hardwareId, email: owner.email, created: true };
  } catch (error) {
    if (error?.code === 11000) throw new Error('DEVICE_ACTIVATION_RESERVATION_CONFLICT');
    throw error;
  }
}

async function main() {
  const orderCode = Number(process.argv[2]);
  const hardwareId = process.argv[3]?.trim().toUpperCase();
  const outputFile = process.argv[4];
  if (!process.env.MONGODB_URI || !hardwareId || !outputFile || !isAbsolute(outputFile)) throw new Error('USAGE_ORDER_HARDWARE_ABSOLUTE_QR_FILE');
  let qr: { v: number; type: string; hardwareId: string; activationCode: string };
  if (existsSync(outputFile)) {
    if ((statSync(outputFile).mode & 0o077) !== 0) throw new Error('QR_FILE_PERMISSIONS_MUST_BE_PRIVATE');
    qr = JSON.parse(readFileSync(outputFile, 'utf8'));
    if (qr.v !== 1 || qr.type !== 'heros-device-activation' || qr.hardwareId !== hardwareId || !normalizeDeviceActivationCode(qr.activationCode)) throw new Error('INVALID_EXISTING_QR_FILE');
  } else {
    qr = { v: 1, type: 'heros-device-activation', hardwareId, activationCode: generateDeviceActivationCode() };
    // Preserve the code for email retries without ever logging it or storing plaintext in MongoDB.
    writeFileSync(outputFile, JSON.stringify(qr), { mode: 0o600, flag: 'wx' });
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    const result = await prepareDeviceActivation(mongoose.connection, { orderCode, hardwareId, activationCode: qr.activationCode, deviceToken: process.env.HEROS_PROVISION_DEVICE_TOKEN });
    try {
      await new EmailService(new ConfigService(process.env)).sendDeviceActivation(result.email, { activationCode: qr.activationCode, hardwareId, orderCode });
    } catch {
      throw new Error('ACTIVATION_EMAIL_FAILED_RETRY_WITH_SAME_QR_FILE');
    }
    await mongoose.connection.collection('hardware_devices').updateOne({ _id: new mongoose.Types.ObjectId(result.id) }, { $set: { activationEmailSentAt: new Date() } });
    console.log(JSON.stringify({ id: result.id, hardwareId, activationPending: true, emailSent: true, created: result.created }));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  void main().catch(error => {
    console.error(`DEVICE_ACTIVATION_PREPARE_FAILED ${typeof error?.message === 'string' && /^[A-Z_]+$/.test(error.message) ? error.message : 'PREPARATION_FAILED'}`);
    process.exitCode = 1;
  });
}
