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

  function createService(modelOverrides: Record<string, unknown> = {}) {
    const model = {
      findOne: jest.fn().mockResolvedValue(event),
      findById: jest.fn().mockResolvedValue(event),
      ...modelOverrides,
    };
    return new SosService(
      model as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockReturnValue(undefined) } as any
    );
  }

  it('does not expose emergency-contact PII to a responder', async () => {
    const result = await createService().getOne(
      recipientId.toString(),
      eventId.toString()
    );

    expect(result).not.toHaveProperty('recipients');
    expect(result).not.toHaveProperty('smsPayload');
    expect(result).not.toHaveProperty('currentLocation');
    expect(result).not.toHaveProperty('recordings');
  });

  it('returns SMS composer payload to the SOS owner', async () => {
    const result = await createService().getOne(
      ownerId.toString(),
      eventId.toString()
    );

    expect(result).toHaveProperty('smsPayload.recipients', ['+84901234567']);
    expect(result).toHaveProperty('recipients');
    expect(result).toHaveProperty('currentLocation');
  });

  it('returns live location and recordings after the recipient accepts', async () => {
    const recordingId = new Types.ObjectId();
    const acceptedEvent = {
      ...event,
      recipients: [
        {
          ...event.recipients[0],
          acknowledgedAt: new Date(),
        },
      ],
      recordings: [
        {
          _id: recordingId,
          mimeType: 'audio/mp4',
          sizeBytes: 1024,
          durationSeconds: 7.5,
          createdAt: new Date(),
        },
      ],
    };
    const result = await createService({
      findOne: jest.fn().mockResolvedValue(acceptedEvent),
    }).getOne(recipientId.toString(), eventId.toString());

    expect(result).toHaveProperty('currentLocation');
    expect(result).toHaveProperty('viewerAcknowledged', true);
    expect(result).toHaveProperty('responderCount', 1);
    expect(result).toHaveProperty(
      'recordings.0.playbackPath',
      `/v1/sos/${eventId.toString()}/recordings/${recordingId.toString()}`
    );
    expect(result).not.toHaveProperty('recipients');
  });

  it('blocks recording playback before the recipient accepts', async () => {
    await expect(
      createService().openRecording(
        recipientId.toString(),
        eventId.toString(),
        new Types.ObjectId().toString()
      )
    ).rejects.toMatchObject({
      response: { code: 'SOS_ACKNOWLEDGEMENT_REQUIRED' },
    });
  });

  it('allows only device-owner accounts to create an SOS', async () => {
    const service = new SosService(
      {} as any,
      {
        getMe: jest.fn().mockResolvedValue({
          userType: 'emergency_contact',
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn().mockReturnValue(undefined) } as any
    );

    await expect(
      service.create(ownerId.toString(), {
        clientRequestId: '125fe329-0bfd-428f-a69f-a9cefe22449e',
        message: 'Help me',
        location: {
          latitude: 10.762622,
          longitude: 106.660172,
          accuracy: 12,
          recordedAt: new Date().toISOString(),
        },
      })
    ).rejects.toMatchObject({
      response: { code: 'SOS_DEVICE_OWNER_REQUIRED' },
    });
  });

  it('rejects an audio MIME type when the file signature does not match', async () => {
    await expect(
      createService().addRecording(
        ownerId.toString(),
        eventId.toString(),
        {
          buffer: Buffer.from('not-an-m4a'),
          mimetype: 'audio/mp4',
          size: 10,
        },
        { durationSeconds: 2 }
      )
    ).rejects.toMatchObject({
      response: { code: 'SOS_AUDIO_TYPE_INVALID' },
    });
  });
});
