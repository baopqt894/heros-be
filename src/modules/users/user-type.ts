export const USER_TYPES = [
  'device_owner',
  'emergency_contact',
  'community_responder',
] as const;

export type UserType = (typeof USER_TYPES)[number];
