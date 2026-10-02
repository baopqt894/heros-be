export interface AuthenticatedUser {
  sub: string;
  email: string;
  type: 'access';
  sessionKey: string;
  deviceId: string;
  iat?: number;
  exp?: number;
}
