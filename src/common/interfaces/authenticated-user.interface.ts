export interface AuthenticatedUser {
  sub: string;
  email: string;
  type: 'access';
  sessionKey: string;
  deviceId: string;
  clientType?: 'mobile' | 'web';
  iat?: number;
  exp?: number;
}
