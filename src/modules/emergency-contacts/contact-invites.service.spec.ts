import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { createHash } from 'node:crypto';
import { ContactInvitesService } from './contact-invites.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { AppLinksController } from './app-links.controller';

describe('Contact invitations', () => {
  const id = new Types.ObjectId();
  function setup(type = 'device_owner') {
    const contacts = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: id }),
      updateOne: jest.fn(),
    };
    const users = {
      getMe: jest
        .fn()
        .mockResolvedValue({
          _id: id,
          userType: type,
          email: 'relative@example.com',
          emailVerifiedAt: new Date(),
        }),
    };
    const config = new ConfigService({
      APP_INVITE_BASE_URL: 'https://heros.nextteam.site/invite',
      INVITE_TTL_DAYS: '7',
    });
    return {
      contacts,
      users,
      service: new ContactInvitesService(
        contacts as any,
        users as any,
        config,
        new AuthRateLimitService()
      ),
    };
  }
  it('stores only a hash and puts the redeem code in the fragment, never the path', async () => {
    const { service, contacts } = setup();
    const result = await service.issue(
      id.toString(),
      id.toString(),
      'Relative@Example.com'
    );
    expect(result.inviteCode).toMatch(/^[A-F0-9]{32}$/);
    const url = new URL(result.inviteUrl);
    expect(url.pathname).toBe('/invite');
    expect(url.search).toBe('');
    expect(url.hash).toBe(`#code=${result.inviteCode}`);
    const update = contacts.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.inviteTokenHash).toBe(
      createHash('sha256').update(result.inviteCode).digest('hex')
    );
    expect(update.$set.inviteEmail).toBe('relative@example.com');
    expect(update.$unset).toHaveProperty('linkedUserId');
  });
  it('atomically requires matching verified email, pending status and expiry then consumes the secret', async () => {
    const { service, contacts } = setup('emergency_contact');
    await service.accept(id.toString(), 'a'.repeat(32));
    const [query, update] = contacts.findOneAndUpdate.mock.calls[0];
    expect(query.inviteEmail).toBe('relative@example.com');
    expect(query.invitationStatus).toBe('pending');
    expect(query.inviteExpiresAt.$gt).toBeInstanceOf(Date);
    expect(update.$unset).toHaveProperty('inviteTokenHash');
    expect(update.$set.linkedUserId).toEqual(id);
  });
  it('returns the same failure for a consumed, expired or wrong-email invitation', async () => {
    const { service, contacts } = setup('emergency_contact');
    contacts.findOneAndUpdate.mockResolvedValue(null);
    await expect(
      service.accept(id.toString(), 'A'.repeat(32))
    ).rejects.toMatchObject({
      response: { code: 'INVITE_INVALID_OR_EXPIRED' },
    });
  });
  it('rejects unverified accounts before querying invitations', async () => {
    const { service, contacts, users } = setup('emergency_contact');
    users.getMe.mockResolvedValue({
      _id: id,
      userType: 'emergency_contact',
      email: 'relative@example.com',
      emailVerifiedAt: undefined,
    });
    await expect(
      service.accept(id.toString(), 'A'.repeat(32))
    ).rejects.toThrow();
    expect(contacts.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('hides absent or unsafe install URLs and switches the configured channel', () => {
    const controller = new AppLinksController(
      new ConfigService({
        APP_DISTRIBUTION_CHANNEL: 'store',
        IOS_TESTFLIGHT_URL: 'https://testflight.apple.com/join/example',
        IOS_APP_STORE_URL: 'javascript:alert(1)',
      })
    );
    expect(controller.appConfig().data.iosDownloadUrl).toBeNull();
    expect(controller.appConfig().data.distributionChannel).toBe('store');
  });
  it('does not publish a fabricated Apple application identifier', () => {
    const controller = new AppLinksController(
      new ConfigService({ APPLE_APP_IDS: '' })
    );
    const response = { set: jest.fn().mockReturnThis(), json: jest.fn() };
    controller.association(response as any);
    expect(response.json).toHaveBeenCalledWith({
      applinks: { apps: [], details: [] },
    });
  });
});
