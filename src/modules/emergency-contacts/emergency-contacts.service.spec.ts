import { Types } from 'mongoose';
import { EmergencyContactsService } from './emergency-contacts.service';

describe('EmergencyContactsService', () => {
  const ownerId = new Types.ObjectId().toString();

  it('limits a device owner to ten emergency contacts', async () => {
    const model = { countDocuments: jest.fn().mockResolvedValue(10) };
    const service = new EmergencyContactsService(
      model as any,
      {
        getMe: jest.fn().mockResolvedValue({ userType: 'device_owner' }),
      } as any
    );

    await expect(
      service.create(ownerId, { name: 'Mẹ', phone: '+84901234567' })
    ).rejects.toMatchObject({
      response: { code: 'EMERGENCY_CONTACT_LIMIT_REACHED' },
    });
  });

  it('allows the invited account to accept a pending invitation', async () => {
    const invitation = {
      _id: new Types.ObjectId(),
      invitationStatus: 'accepted',
    };
    const model = {
      findOneAndUpdate: jest.fn().mockResolvedValue(invitation),
    };
    const service = new EmergencyContactsService(model as any, {} as any);

    await expect(
      service.respondToInvitation(
        new Types.ObjectId().toString(),
        invitation._id.toString(),
        'accepted'
      )
    ).resolves.toEqual(invitation);
  });
});
