import { ConfigService } from '@nestjs/config';
import { AvatarUploadService } from './avatar-upload.service';

describe('Limgrow avatar upload', () => {
  const originalFetch = global.fetch;
  const file = { buffer: Buffer.from('test-image'), mimetype: 'image/png' };
  const url = 'https://storages.limgrow.com/uploads/test/avatar.png';
  let service: AvatarUploadService;
  beforeEach(() => {
    service = new AvatarUploadService(
      new ConfigService({ LIMGROW_UPLOAD_API_KEY: 'test-only-key' })
    );
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ url }) });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends file and type=image, lets fetch set the boundary, and returns the URL', async () => {
    await expect(service.upload(file)).resolves.toBe(url);
    const [endpoint, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(endpoint).toBe('https://upload-services.limgrow.com/upload');
    expect(options.headers['x-api-key']).toBe('test-only-key');
    expect(options.headers).not.toHaveProperty('Content-Type');
    expect(options.body.get('type')).toBe('image');
    expect(options.body.get('file').type).toBe('image/png');
    expect(options.redirect).toBe('error');
  });

  it.each([
    {},
    { url: 'https://untrusted.example/a.png' },
    { url: 'http://storages.limgrow.com/uploads/a.png' },
  ])('rejects malformed provider response %j', async (body) => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => body,
    });
    await expect(service.upload(file)).rejects.toMatchObject({
      response: { code: 'AVATAR_UPLOAD_FAILED' },
    });
  });

  it('fails closed without a key', async () => {
    service = new AvatarUploadService(new ConfigService({}));
    await expect(service.upload(file)).rejects.toMatchObject({
      response: { code: 'AVATAR_UPLOAD_NOT_CONFIGURED' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not expose upstream error bodies or credentials', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    await expect(service.upload(file)).rejects.toMatchObject({
      response: { code: 'AVATAR_UPLOAD_FAILED' },
    });
  });
});
