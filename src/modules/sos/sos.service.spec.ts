import { Types } from 'mongoose';
import { SosService } from './sos.service';

describe('SosService response privacy', () => {
  const ownerId = new Types.ObjectId();
  const recipientId = new Types.ObjectId();
  const eventId = new Types.ObjectId();
  const event = {
    _id: eventId,
    ownerId,
    code: 'SOS-ABC12345',
    status: 'active',
    message: 'Help me',
    currentLocation: {
      type: 'Point',
      coordinates: [106.660172, 10.762622],
      accuracy: 12,
      recordedAt: new Date(),
    },
    recipients: [
      {
        type: 'emergency_contact',
        userId: recipientId,
        name: 'Private contact',
        phone: '+84901234567',
        email: 'private@example.com',
        channels: ['push', 'email', 'sms_composer'],
      },
    ],
    smsStatus: 'not_opened',
    startedAt: new Date(),
  };

  function createService() {
    const model = { findOne: jest.fn().mockResolvedValue(event) };
    return new SosService(
      model as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
  }

  it('does not expose emergency-contact PII to a responder', async () => {
    const result = await createService().getOne(
      recipientId.toString(),
      eventId.toString()
    );

    expect(result).not.toHaveProperty('recipients');
    expect(result).not.toHaveProperty('smsPayload');
  });

  it('returns SMS composer payload to the SOS owner', async () => {
    const result = await createService().getOne(
      ownerId.toString(),
      eventId.toString()
    );

    expect(result).toHaveProperty('smsPayload.recipients', ['+84901234567']);
    expect(result).toHaveProperty('recipients');
  });
});
