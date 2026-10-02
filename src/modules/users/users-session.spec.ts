import { Types } from 'mongoose';
import { UsersService } from './users.service';

describe('Single active login', () => {
  it('invalidates the old key when another login activates', async () => {
    const id = new Types.ObjectId().toString();
    let activeKey = 'old';
    const model = {
      updateOne: jest.fn(async (_filter, update) => {
        activeKey = update.$set.activeSessionKey;
        return { matchedCount: 1 };
      }),
      exists: jest.fn(async (filter) => filter.activeSessionKey === activeKey),
    };
    const service = new UsersService(model as any);
    await service.assertSession(id, 'old');
    await service.activateSession(id, 'new');
    await expect(service.assertSession(id, 'old')).rejects.toMatchObject({
      response: { code: 'SESSION_REVOKED' },
    });
    await expect(service.assertSession(id, 'new')).resolves.toBeUndefined();
    await expect(service.assertSession(id)).rejects.toMatchObject({
      response: { code: 'SESSION_REVOKED' },
    });
  });
});
