import { describe, expect, it } from 'vitest';
import type { Me } from '../api/types';
import { en } from '../strings/en';
import { navFor } from './Layout';

const admin: Me = { id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'ADMIN', title: null, regionId: null, regionCode: null, regionName: null, institutionId: null, institutionName: null, skills: [] };

describe('ADMIN navigation', () => {
  it('links the project reviewer journey from the existing app shell', () => {
    expect(navFor(admin, en).map((item) => item.to)).toContain('/admin/project-story');
    expect(navFor(admin, en).map((item) => item.to)).not.toContain('/admin/evidence/overview');
  });
});
