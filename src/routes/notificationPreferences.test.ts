import assert from 'node:assert/strict';
import test from 'node:test';
import { Response } from 'express';
import {
  createNotificationPreferencesHandlers,
  validateNotificationPreferencesInput,
} from './notificationPreferences';
import {
  NotificationPreferences,
  UpdateNotificationPreferencesInput,
} from '../db/repositories/notificationPreferencesRepository';

/**
 * Minimal mock repository implementing only the methods used by the handlers.
 * Avoids needing to implement unused interface methods.
 */
interface MockNotificationRepo {
  getByUserId: (userId: string) => Promise<NotificationPreferences | null>;
  upsert: (userId: string, input: UpdateNotificationPreferencesInput) => Promise<NotificationPreferences>;
}

function makeReq(user?: { id: string }, body: unknown = {}) {
  return { user, body } as { user?: { id: string }; body: unknown };
}

function makeRes() {
  let statusCode = 200;
  let jsonData: unknown = null;
  return {
    status(code: number) { statusCode = code; return this; },
    json(obj: unknown) { jsonData = obj; return this; },
    _get() { return { statusCode, jsonData }; }
  } as unknown as Response & { _get(): { statusCode: number; jsonData: unknown } };
}

// ─── Unit validation tests ───────────────────────────────────────────────────

test('validateNotificationPreferencesInput: accepts all valid boolean fields', () => {
  const errors = validateNotificationPreferencesInput({
    email_notifications: true,
    push_notifications: false,
    sms_notifications: true,
  });
  assert.equal(errors.length, 0, 'Should accept all valid boolean fields');
});

test('validateNotificationPreferencesInput: accepts empty object', () => {
  const errors = validateNotificationPreferencesInput({});
  assert.equal(errors.length, 0, 'Should accept empty object');
});

test('validateNotificationPreferencesInput: accepts null body', () => {
  const errors = validateNotificationPreferencesInput(null);
  assert.deepEqual(errors, ['body must be a non-null object']);
});

test('validateNotificationPreferencesInput: accepts undefined body', () => {
  const errors = validateNotificationPreferencesInput(undefined);
  assert.deepEqual(errors, ['body must be a non-null object']);
});

test('validateNotificationPreferencesInput: accepts single field update', () => {
  const errors = validateNotificationPreferencesInput({ email_notifications: true });
  assert.equal(errors.length, 0);
});

test('validateNotificationPreferencesInput: rejects non-boolean string', () => {
  const errors = validateNotificationPreferencesInput({
    email_notifications: 'true',
  });
  assert.deepEqual(errors, ['email_notifications must be a boolean']);
});

test('validateNotificationPreferencesInput: rejects non-boolean number', () => {
  const errors = validateNotificationPreferencesInput({
    push_notifications: 1,
  });
  assert.deepEqual(errors, ['push_notifications must be a boolean']);
});

test('validateNotificationPreferencesInput: rejects non-boolean null', () => {
  const errors = validateNotificationPreferencesInput({
    sms_notifications: null,
  });
  assert.deepEqual(errors, ['sms_notifications must be a boolean']);
});

test('validateNotificationPreferencesInput: rejects non-boolean object', () => {
  const errors = validateNotificationPreferencesInput({
    email_notifications: {},
  });
  assert.deepEqual(errors, ['email_notifications must be a boolean']);
});

test('validateNotificationPreferencesInput: rejects unknown field', () => {
  const errors = validateNotificationPreferencesInput({
    unknown_field: true,
  });
  assert.deepEqual(errors, ['Unknown field: unknown_field']);
});

test('validateNotificationPreferencesInput: rejects unknown field alongside valid field', () => {
  const errors = validateNotificationPreferencesInput({
    email_notifications: true,
    invalid_field: false,
  });
  assert.deepEqual(errors, ['Unknown field: invalid_field']);
});

test('validateNotificationPreferencesInput: rejects array body', () => {
  const errors = validateNotificationPreferencesInput([true, false]);
  assert.deepEqual(errors, ['body must be a non-null object']);
});

test('validateNotificationPreferencesInput: rejects string body', () => {
  const errors = validateNotificationPreferencesInput('not an object');
  assert.deepEqual(errors, ['body must be a non-null object']);
});

test('validateNotificationPreferencesInput: collects multiple errors', () => {
  const errors = validateNotificationPreferencesInput({
    email_notifications: 'yes',
    push_notifications: 0,
    unknown_field: true,
    another_unknown: false,
  });
  assert.equal(errors.length, 4);
  assert.ok(errors.includes('email_notifications must be a boolean'));
  assert.ok(errors.includes('push_notifications must be a boolean'));
  assert.ok(errors.includes('Unknown field: unknown_field'));
  assert.ok(errors.includes('Unknown field: another_unknown'));
});

test('validateNotificationPreferencesInput: accepts undefined field values (field absence)', () => {
  const errors = validateNotificationPreferencesInput({
    email_notifications: undefined,
  });
  assert.equal(errors.length, 0, 'undefined is treated as field absence');
});

// ─── Route handler tests ──────────────────────────────────────────────────────

test('GET handler returns default preferences when none exist', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' });
  const res = makeRes();

  await handlers.getPreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.jsonData, {
    email_notifications: true,
    push_notifications: true,
    sms_notifications: false,
  });
});

test('GET handler returns existing preferences', async () => {
  const existingPrefs: NotificationPreferences = {
    user_id: 'user-123',
    email_notifications: false,
    push_notifications: true,
    sms_notifications: true,
    updated_at: new Date(),
  };
  const repo: MockNotificationRepo = {
    async getByUserId() { return existingPrefs; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' });
  const res = makeRes();

  await handlers.getPreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 200);
  const prefs = out.jsonData as NotificationPreferences;
  assert.equal(prefs.email_notifications, false);
  assert.equal(prefs.push_notifications, true);
  assert.equal(prefs.sms_notifications, true);
});

test('GET handler returns 401 when not authenticated', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq();
  const res = makeRes();

  await handlers.getPreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 401);
  assert.deepEqual(out.jsonData, { error: 'Unauthorized' });
});

test('GET handler returns 500 on repository error', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { throw new Error('DB connection lost'); },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' });
  const res = makeRes();

  await handlers.getPreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 500);
  assert.deepEqual(out.jsonData, { error: 'Failed to fetch notification preferences' });
});

test('PATCH handler updates preferences', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert(_userId, input) {
      return {
        user_id: _userId,
        email_notifications: input.email_notifications ?? true,
        push_notifications: input.push_notifications ?? true,
        sms_notifications: input.sms_notifications ?? false,
        updated_at: new Date(),
      };
    },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, { email_notifications: false, push_notifications: false });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 200);
  const prefs = out.jsonData as NotificationPreferences;
  assert.equal(prefs.email_notifications, false);
  assert.equal(prefs.push_notifications, false);
});

test('PATCH handler accepts empty body', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() {
      return {
        user_id: 'user-123',
        email_notifications: true,
        push_notifications: true,
        sms_notifications: false,
        updated_at: new Date(),
      };
    },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, {});
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 200);
});

test('PATCH handler returns 401 when not authenticated', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq(undefined, { email_notifications: false });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 401);
  assert.deepEqual(out.jsonData, { error: 'Unauthorized' });
});

test('PATCH handler returns 400 for invalid boolean string', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, { email_notifications: 'true' });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 400);
  const payload = out.jsonData as { error: string; details: string[] };
  assert.equal(payload.error, 'ValidationError');
  assert.ok(payload.details.includes('email_notifications must be a boolean'));
});

test('PATCH handler returns 400 for invalid number', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, { push_notifications: 1 });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 400);
  const payload = out.jsonData as { error: string; details: string[] };
  assert.equal(payload.error, 'ValidationError');
  assert.ok(payload.details.includes('push_notifications must be a boolean'));
});

test('PATCH handler returns 400 for null value', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, { sms_notifications: null });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 400);
  const payload = out.jsonData as { error: string; details: string[] };
  assert.equal(payload.error, 'ValidationError');
  assert.ok(payload.details.includes('sms_notifications must be a boolean'));
});

test('PATCH handler returns 400 for unknown field', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, { unknown_field: true });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 400);
  const payload = out.jsonData as { error: string; details: string[] };
  assert.equal(payload.error, 'ValidationError');
  assert.ok(payload.details.includes('Unknown field: unknown_field'));
});

test('PATCH handler returns 400 with multiple errors', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, {
    email_notifications: 'yes',
    push_notifications: 0,
    unknown_field: true,
  });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 400);
  const payload = out.jsonData as { error: string; details: string[] };
  assert.equal(payload.error, 'ValidationError');
  assert.equal(payload.details.length, 3);
});

test('PATCH handler returns 500 on repository error', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('DB connection lost'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, { email_notifications: true });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 500);
  assert.deepEqual(out.jsonData, { error: 'Failed to update notification preferences' });
});

test('PATCH handler applies partial update', async () => {
  let storedPrefs: NotificationPreferences = {
    user_id: 'user-123',
    email_notifications: true,
    push_notifications: true,
    sms_notifications: true,
    updated_at: new Date(),
  };
  const repo: MockNotificationRepo = {
    async getByUserId() { return storedPrefs; },
    async upsert(_userId, input) {
      storedPrefs = {
        ...storedPrefs,
        email_notifications: input.email_notifications ?? storedPrefs.email_notifications,
        push_notifications: input.push_notifications ?? storedPrefs.push_notifications,
        sms_notifications: input.sms_notifications ?? storedPrefs.sms_notifications,
      };
      return storedPrefs;
    },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, { email_notifications: false });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 200);
  const prefs = out.jsonData as NotificationPreferences;
  assert.equal(prefs.email_notifications, false);
  assert.equal(prefs.push_notifications, true);
  assert.equal(prefs.sms_notifications, true);
});

test('PATCH handler rejects non-object body', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, 'not an object');
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 400);
  const payload = out.jsonData as { error: string; details: string[] };
  assert.equal(payload.error, 'ValidationError');
  assert.ok(payload.details.includes('body must be a non-null object'));
});

test('PATCH handler rejects array body', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert() { throw new Error('should not be called'); },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, [true, false]);
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 400);
  const payload = out.jsonData as { error: string; details: string[] };
  assert.equal(payload.error, 'ValidationError');
  assert.ok(payload.details.includes('body must be a non-null object'));
});

test('PATCH handler allows false as valid value', async () => {
  const repo: MockNotificationRepo = {
    async getByUserId() { return null; },
    async upsert(_userId, input) {
      return {
        user_id: _userId,
        email_notifications: input.email_notifications ?? true,
        push_notifications: input.push_notifications ?? true,
        sms_notifications: input.sms_notifications ?? false,
        updated_at: new Date(),
      };
    },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, {
    email_notifications: false,
    push_notifications: false,
    sms_notifications: false,
  });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 200);
  const prefs = out.jsonData as NotificationPreferences;
  assert.equal(prefs.email_notifications, false);
  assert.equal(prefs.push_notifications, false);
  assert.equal(prefs.sms_notifications, false);
});

test('PATCH handler preserves existing preferences when omitting fields', async () => {
  const existingPrefs: NotificationPreferences = {
    user_id: 'user-123',
    email_notifications: true,
    push_notifications: false,
    sms_notifications: true,
    updated_at: new Date(),
  };
  const repo: MockNotificationRepo = {
    async getByUserId() { return existingPrefs; },
    async upsert(_userId, input) {
      return {
        user_id: _userId,
        email_notifications: input.email_notifications ?? existingPrefs.email_notifications,
        push_notifications: input.push_notifications ?? existingPrefs.push_notifications,
        sms_notifications: input.sms_notifications ?? existingPrefs.sms_notifications,
        updated_at: new Date(),
      };
    },
  };
  const handlers = createNotificationPreferencesHandlers(repo as any);
  const req = makeReq({ id: 'user-123' }, { push_notifications: true });
  const res = makeRes();

  await handlers.updatePreferences(req as any, res);

  const out = res._get();
  assert.equal(out.statusCode, 200);
  const prefs = out.jsonData as NotificationPreferences;
  assert.equal(prefs.email_notifications, true);
  assert.equal(prefs.push_notifications, true);
  assert.equal(prefs.sms_notifications, true);
});
