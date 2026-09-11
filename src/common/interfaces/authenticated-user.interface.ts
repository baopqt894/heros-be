export interface AuthenticatedUser {
  sub: string;
  email: string;
  type: 'access';
  iat?: number;
  exp?: number;
}
