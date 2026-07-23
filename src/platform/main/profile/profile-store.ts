/**
 * Window Profile store（主进程）
 *
 * 对齐 proxy-node-store.ts 模式：
 * - JSON 文件落盘（userData/krig-data/profiles.json）
 * - 内存 Map 缓存 + lazy load
 * - atomic 写：.tmp → rename
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { monotonicFactory } from 'ulid';
import type { Profile } from '@shared/types/profile-types';

const ulid = monotonicFactory();

interface ProfileFile {
  version: '1';
  entries: Record<string, Profile>;
}

const PROFILE_DIR = path.join(app.getPath('userData'), 'krig-data');
const PROFILE_FILE = path.join(PROFILE_DIR, 'profiles.json');

class ProfileStore {
  private cache: Map<string, Profile> = new Map();
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      fs.mkdirSync(PROFILE_DIR, { recursive: true });
      if (fs.existsSync(PROFILE_FILE)) {
        const raw = fs.readFileSync(PROFILE_FILE, 'utf-8');
        const data = JSON.parse(raw) as ProfileFile;
        if (data.version === '1' && data.entries && typeof data.entries === 'object') {
          for (const [id, profile] of Object.entries(data.entries)) {
            if (
              profile &&
              typeof profile.id === 'string' &&
              typeof profile.name === 'string' &&
              typeof profile.createdAt === 'number'
            ) {
              this.cache.set(id, profile);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[profile-store] load failed:', err);
    }
  }

  private save(): void {
    const data: ProfileFile = {
      version: '1',
      entries: Object.fromEntries(this.cache),
    };
    const tmp = PROFILE_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, PROFILE_FILE);
    } catch (err) {
      console.warn('[profile-store] save failed:', err);
    }
  }

  async list(): Promise<Profile[]> {
    await this.ensureLoaded();
    return Array.from(this.cache.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  async get(id: string): Promise<Profile | undefined> {
    await this.ensureLoaded();
    return this.cache.get(id);
  }

  async create(input: Omit<Profile, 'id' | 'createdAt'>): Promise<Profile> {
    await this.ensureLoaded();
    const profile: Profile = {
      ...input,
      id: ulid(),
      createdAt: Date.now(),
    };
    this.cache.set(profile.id, profile);
    this.save();
    return profile;
  }

  async update(id: string, patch: Partial<Omit<Profile, 'id' | 'createdAt'>>): Promise<Profile | null> {
    await this.ensureLoaded();
    const existing = this.cache.get(id);
    if (!existing) return null;
    const updated: Profile = { ...existing, ...patch };
    this.cache.set(id, updated);
    this.save();
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    if (this.cache.delete(id)) this.save();
  }
}

export const profileStore = new ProfileStore();
