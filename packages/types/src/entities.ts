/** Foundation entities (design doc §49). Later phases extend this file. */

import type { Role } from './roles.js';

export type UUID = string;
/** ISO-8601 timestamp string as returned by PostgREST. */
export type Timestamp = string;

export interface Organization {
  id: UUID;
  name: string;
  slug: string;
  /** ISO 4217, drives every money field in the org. */
  currency: string;
  timezone: string;
  created_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Profile {
  id: UUID;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export type MemberStatus = 'active' | 'invited' | 'suspended';

export interface OrganizationMember {
  id: UUID;
  organization_id: UUID;
  user_id: UUID;
  role: Role;
  status: MemberStatus;
  invited_by: UUID | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/** A member row joined with the profile, as the Users screen renders it. */
export interface OrganizationMemberWithProfile extends OrganizationMember {
  profile: Pick<Profile, 'id' | 'email' | 'full_name' | 'avatar_url'> | null;
}

export type AuditAction = 'insert' | 'update' | 'delete';

export interface AuditLog {
  id: UUID;
  organization_id: UUID | null;
  actor_id: UUID | null;
  action: AuditAction;
  entity_table: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  created_at: Timestamp;
}
