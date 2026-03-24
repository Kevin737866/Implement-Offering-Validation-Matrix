import { Pool, QueryResult } from 'pg';

export interface NotificationPreference {
  id: string;
  user_id: string;
  channel: 'email' | 'push';
  type: string; // e.g. 'payout', 'investment', etc.
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateNotificationPreferenceInput {
  user_id: string;
  channel: 'email' | 'push';
  type: string;
  enabled?: boolean;
}

export interface UpdateNotificationPreferenceInput {
  enabled?: boolean;
}

export interface ListNotificationPreferencesOptions {
  user_id: string;
  channel?: 'email' | 'push';
  type?: string;
}

/**
 * User-facing notification preferences aggregated by channel type.
 * Mirrors the API response shape for client consumption.
 */
export interface NotificationPreferences {
  user_id: string;
  email_notifications: boolean;
  push_notifications: boolean;
  sms_notifications: boolean;
  updated_at: Date;
}

/**
 * Input for upserting user-level notification preferences.
 */
export interface UpdateNotificationPreferencesInput {
  email_notifications?: boolean;
  push_notifications?: boolean;
  sms_notifications?: boolean;
}

/**
 * Notification Preferences Repository
 * Handles database operations for user notification preferences
 */
export class NotificationPreferencesRepository {
  constructor(private db: Pool) {}

  /**
   * Get aggregated notification preferences for a user.
   * Returns user-level preferences derived from channel-specific settings.
   * @param user_id User ID
   * @returns Aggregated preferences or null if no preferences exist
   */
  async getByUserId(user_id: string): Promise<NotificationPreferences | null> {
    const query = `
      SELECT
        user_id,
        COALESCE(MAX(CASE WHEN channel = 'email' THEN enabled END), true)  AS email_notifications,
        COALESCE(MAX(CASE WHEN channel = 'push'   THEN enabled END), true)  AS push_notifications,
        COALESCE(MAX(CASE WHEN channel = 'sms'    THEN enabled END), false) AS sms_notifications,
        MAX(updated_at) AS updated_at
      FROM notification_preferences
      WHERE user_id = $1
      GROUP BY user_id
    `;
    const result: QueryResult<NotificationPreferences> = await this.db.query(query, [user_id]);
    return result.rows[0] || null;
  }

  /**
   * Upsert all channel preferences for a user.
   * Handles partial updates where only some channels are provided.
   * @param user_id User ID
   * @param input Channel preference flags
   * @returns Updated aggregated preferences
   */
  async upsert(
    user_id: string,
    input: UpdateNotificationPreferencesInput
  ): Promise<NotificationPreferences> {
    const channels: Array<'email' | 'push' | 'sms'> = ['email', 'push', 'sms'];

    for (const channel of channels) {
      const enabled = input[`${channel}_notifications` as keyof UpdateNotificationPreferencesInput];
      if (enabled !== undefined) {
        const query = `
          INSERT INTO notification_preferences (user_id, channel, type, enabled, created_at, updated_at)
          VALUES ($1, $2, 'default', $3, NOW(), NOW())
          ON CONFLICT (user_id, channel, type)
          DO UPDATE SET enabled = $3, updated_at = NOW()
        `;
        await this.db.query(query, [user_id, channel, enabled]);
      }
    }

    const result = await this.getByUserId(user_id);
    if (!result) {
      throw new Error('Failed to upsert notification preferences');
    }
    return result;
  }

  /**
   * Get a specific notification preference by user_id, channel, and type
   * @param user_id User ID
   * @param channel Notification channel (email or push)
   * @param type Notification type (e.g. payout, investment)
   * @returns Notification preference or null if not found
   */
  async getPreference(
    user_id: string,
    channel: 'email' | 'push',
    type: string
  ): Promise<NotificationPreference | null> {
    const query = `
      SELECT * FROM notification_preferences
      WHERE user_id = $1 AND channel = $2 AND type = $3
      LIMIT 1
    `;
    const result: QueryResult<NotificationPreference> = await this.db.query(query, [
      user_id,
      channel,
      type,
    ]);
    return result.rows[0] || null;
  }

  /**
   * List notification preferences for a user with optional filters
   * @param options Query options including user_id, optional channel and type filters
   * @returns Array of notification preferences
   */
  async listPreferences(
    options: ListNotificationPreferencesOptions
  ): Promise<NotificationPreference[]> {
    const conditions: string[] = ['user_id = $1'];
    const values: any[] = [options.user_id];
    let paramIndex = 2;

    if (options.channel) {
      conditions.push(`channel = $${paramIndex++}`);
      values.push(options.channel);
    }

    if (options.type) {
      conditions.push(`type = $${paramIndex++}`);
      values.push(options.type);
    }

    const query = `
      SELECT * FROM notification_preferences
      WHERE ${conditions.join(' AND ')}
      ORDER BY channel, type
    `;
    const result: QueryResult<NotificationPreference> = await this.db.query(query, values);
    return result.rows;
  }

  /**
   * Create a new notification preference
   * @param input Preference data
   * @returns Created notification preference
   */
  async createPreference(
    input: CreateNotificationPreferenceInput
  ): Promise<NotificationPreference> {
    const query = `
      INSERT INTO notification_preferences (user_id, channel, type, enabled, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING *
    `;
    const values = [
      input.user_id,
      input.channel,
      input.type,
      input.enabled !== undefined ? input.enabled : true,
    ];
    const result: QueryResult<NotificationPreference> = await this.db.query(query, values);
    if (result.rows.length === 0) {
      throw new Error('Failed to create notification preference');
    }
    return result.rows[0];
  }

  /**
   * Update an existing notification preference
   * @param user_id User ID
   * @param channel Notification channel (email or push)
   * @param type Notification type
   * @param input Update data
   * @returns Updated notification preference
   */
  async updatePreference(
    user_id: string,
    channel: 'email' | 'push',
    type: string,
    input: UpdateNotificationPreferenceInput
  ): Promise<NotificationPreference> {
    const sets: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.enabled !== undefined) {
      sets.push(`enabled = $${paramIndex++}`);
      values.push(input.enabled);
    }

    if (sets.length === 0) {
      // Nothing to update; return existing preference
      const existing = await this.getPreference(user_id, channel, type);
      if (!existing) {
        throw new Error('Notification preference not found');
      }
      return existing;
    }

    // Add WHERE clause parameters
    values.push(user_id, channel, type);

    const query = `
      UPDATE notification_preferences
      SET ${sets.join(', ')}, updated_at = NOW()
      WHERE user_id = $${paramIndex++} AND channel = $${paramIndex++} AND type = $${paramIndex++}
      RETURNING *
    `;
    const result: QueryResult<NotificationPreference> = await this.db.query(query, values);
    if (result.rows.length === 0) {
      throw new Error('Notification preference not found or failed to update');
    }
    return result.rows[0];
  }

  /**
   * Upsert a notification preference (create if not exists, update if exists)
   * @param input Preference data
   * @returns Created or updated notification preference
   */
  async upsertPreference(
    input: CreateNotificationPreferenceInput & { enabled?: boolean }
  ): Promise<NotificationPreference> {
    const query = `
      INSERT INTO notification_preferences (user_id, channel, type, enabled, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (user_id, channel, type)
      DO UPDATE SET
        enabled = COALESCE(EXCLUDED.enabled, notification_preferences.enabled),
        updated_at = NOW()
      RETURNING *
    `;
    const values = [
      input.user_id,
      input.channel,
      input.type,
      input.enabled !== undefined ? input.enabled : true,
    ];
    const result: QueryResult<NotificationPreference> = await this.db.query(query, values);
    if (result.rows.length === 0) {
      throw new Error('Failed to upsert notification preference');
    }
    return result.rows[0];
  }

  /**
   * Delete a notification preference
   * @param user_id User ID
   * @param channel Notification channel (email or push)
   * @param type Notification type
   * @returns True if deleted, false if not found
   */
  async deletePreference(
    user_id: string,
    channel: 'email' | 'push',
    type: string
  ): Promise<boolean> {
    const query = `
      DELETE FROM notification_preferences
      WHERE user_id = $1 AND channel = $2 AND type = $3
    `;
    const result: QueryResult = await this.db.query(query, [user_id, channel, type]);
    return (result.rowCount ?? 0) > 0;
  }
}
