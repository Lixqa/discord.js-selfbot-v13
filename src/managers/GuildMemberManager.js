/* eslint-disable newline-per-chained-call */
'use strict';

const { Buffer } = require('node:buffer');
const { setTimeout } = require('node:timers');
const { Collection } = require('@discordjs/collection');
const CachedManager = require('./CachedManager');
const { Error, TypeError, RangeError } = require('../errors');
const BaseGuildVoiceChannel = require('../structures/BaseGuildVoiceChannel');
const { GuildMember } = require('../structures/GuildMember');
const { Role } = require('../structures/Role');
const { Events, Opcodes } = require('../util/Constants');
const { PartialTypes } = require('../util/Constants');
const DataResolver = require('../util/DataResolver');
const GuildMemberFlags = require('../util/GuildMemberFlags');
const SnowflakeUtil = require('../util/SnowflakeUtil');

/**
 * Manages API methods for GuildMembers and stores their cache.
 * @extends {CachedManager}
 */
class GuildMemberManager extends CachedManager {
  constructor(guild, iterable) {
    super(guild.client, GuildMember, iterable);

    /**
     * The guild this manager belongs to
     * @type {Guild}
     */
    this.guild = guild;
  }

  /**
   * The cache of this Manager
   * @type {Collection<Snowflake, GuildMember>}
   * @name GuildMemberManager#cache
   */

  _add(data, cache = true) {
    return super._add(data, cache, { id: data.user.id, extras: [this.guild] });
  }

  /**
   * Data that resolves to give a GuildMember object. This can be:
   * * A GuildMember object
   * * A User resolvable
   * @typedef {GuildMember|UserResolvable} GuildMemberResolvable
   */

  /**
   * Resolves a {@link GuildMemberResolvable} to a {@link GuildMember} object.
   * @param {GuildMemberResolvable} member The user that is part of the guild
   * @returns {?GuildMember}
   */
  resolve(member) {
    const memberResolvable = super.resolve(member);
    if (memberResolvable) return memberResolvable;
    const userId = this.client.users.resolveId(member);
    if (userId) return this.cache.get(userId) ?? null;
    return null;
  }

  /**
   * Resolves a {@link GuildMemberResolvable} to a member id.
   * @param {GuildMemberResolvable} member The user that is part of the guild
   * @returns {?Snowflake}
   */
  resolveId(member) {
    const memberResolvable = super.resolveId(member);
    if (memberResolvable) return memberResolvable;
    const userId = this.client.users.resolveId(member);
    return this.cache.has(userId) ? userId : null;
  }

  /**
   * Options used to add a user to a guild using OAuth2.
   * @typedef {Object} AddGuildMemberOptions
   * @property {string} accessToken An OAuth2 access token for the user with the `guilds.join` scope granted to the
   * bot's application
   * @property {string} [nick] The nickname to give to the member (requires `MANAGE_NICKNAMES`)
   * @property {Collection<Snowflake, Role>|RoleResolvable[]} [roles] The roles to add to the member
   * (requires `MANAGE_ROLES`)
   * @property {boolean} [mute] Whether the member should be muted (requires `MUTE_MEMBERS`)
   * @property {boolean} [deaf] Whether the member should be deafened (requires `DEAFEN_MEMBERS`)
   * @property {boolean} [force] Whether to skip the cache check and call the API directly
   * @property {boolean} [fetchWhenExisting=true] Whether to fetch the user if not cached and already a member
   */

  /**
   * Adds a user to the guild using OAuth2. Requires the `CREATE_INSTANT_INVITE` permission.
   * @param {UserResolvable} user The user to add to the guild
   * @param {AddGuildMemberOptions} options Options for adding the user to the guild
   * @returns {Promise<GuildMember|null>}
   */
  async add(user, options) {
    const userId = this.client.users.resolveId(user);
    if (!userId) throw new TypeError('INVALID_TYPE', 'user', 'UserResolvable');
    if (!options.force) {
      const cachedUser = this.cache.get(userId);
      if (cachedUser) return cachedUser;
    }
    const resolvedOptions = {
      access_token: options.accessToken,
      nick: options.nick,
      mute: options.mute,
      deaf: options.deaf,
    };
    if (options.roles) {
      if (!Array.isArray(options.roles) && !(options.roles instanceof Collection)) {
        throw new TypeError('INVALID_TYPE', 'options.roles', 'Array or Collection of Roles or Snowflakes', true);
      }
      const resolvedRoles = [];
      for (const role of options.roles.values()) {
        const resolvedRole = this.guild.roles.resolveId(role);
        if (!resolvedRole) throw new TypeError('INVALID_ELEMENT', 'Array or Collection', 'options.roles', role);
        resolvedRoles.push(resolvedRole);
      }
      resolvedOptions.roles = resolvedRoles;
    }
    const data = await this.client.api.guilds(this.guild.id).members(userId).put({ data: resolvedOptions });
    // Data is an empty buffer if the member is already part of the guild.
    return data instanceof Buffer ? (options.fetchWhenExisting === false ? null : this.fetch(userId)) : this._add(data);
  }

  /**
   * The client user as a GuildMember of this guild
   * @type {?GuildMember}
   * @readonly
   */
  get me() {
    return (
      this.cache.get(this.client.user.id) ??
      (this.client.options.partials.includes(PartialTypes.GUILD_MEMBER)
        ? this._add({ user: { id: this.client.user.id } }, true)
        : null)
    );
  }

  /**
   * Options used to fetch a single member from a guild.
   * @typedef {BaseFetchOptions} FetchMemberOptions
   * @property {UserResolvable} user The user to fetch
   */

  /**
   * Options used to fetch multiple members from a guild.
   * @typedef {Object} FetchMembersOptions
   * @property {UserResolvable|UserResolvable[]} user The user(s) to fetch
   * @property {?string} query Limit fetch to members with similar usernames
   * @property {number} [limit=0] Maximum number of members to request
   * @property {boolean} [withPresences=false] Whether or not to include the presences
   * @property {number} [time=120e3] Timeout for receipt of members
   * @property {?string} nonce Nonce for this request (32 characters max - default to base 16 now timestamp)
   * @property {boolean} [force=false] Whether to skip the cache check and request the API
   */

  /**
   * Fetches member(s) from Discord, even if they're offline.
   * @param {UserResolvable|FetchMemberOptions|FetchMembersOptions} [options] If a UserResolvable, the user to fetch.
   * If undefined, fetches all members.
   * If a query, it limits the results to users with similar usernames.
   * @returns {Promise<GuildMember|Collection<Snowflake, GuildMember>>}
   * @example
   * // Fetch all members from a guild
   * guild.members.fetch()
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch a single member
   * guild.members.fetch('66564597481480192')
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch a single member without checking cache
   * guild.members.fetch({ user, force: true })
   *   .then(console.log)
   *   .catch(console.error)
   * @example
   * // Fetch a single member without caching
   * guild.members.fetch({ user, cache: false })
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch by an array of users including their presences
   * guild.members.fetch({ user: ['66564597481480192', '191615925336670208'], withPresences: true })
   *   .then(console.log)
   *   .catch(console.error);
   * @example
   * // Fetch by query
   * guild.members.fetch({ query: 'hydra', limit: 1 })
   *   .then(console.log)
   *   .catch(console.error);
   */
  fetch(options) {
    if (!options) {
      if (
        this.me.permissions.has('KICK_MEMBERS') ||
        this.me.permissions.has('BAN_MEMBERS') ||
        this.me.permissions.has('MANAGE_ROLES')
      ) {
        return this._fetchMany();
      } else {
        return this.fetchByMemberSafety();
      }
    }
    const user = this.client.users.resolveId(options);
    if (user) return this._fetchSingle({ user, cache: true });
    if (options.user) {
      if (Array.isArray(options.user)) {
        options.user = options.user.map(u => this.client.users.resolveId(u));
        return this._fetchMany(options);
      } else {
        options.user = this.client.users.resolveId(options.user);
      }
      if (!options.limit && !options.withPresences) return this._fetchSingle(options);
    }
    return this._fetchMany(options);
  }

  /**
   * Fetches the client user as a GuildMember of the guild.
   * @param {BaseFetchOptions} [options] The options for fetching the member
   * @returns {Promise<GuildMember>}
   */
  fetchMe(options) {
    return this.fetch({ ...options, user: this.client.user.id });
  }

  /**
   * Options for searching guild members using logical filter queries.
   * @typedef {Object} GuildSearchMembersOptions
   * @property {GuildSearchQueryBlock} [or] Applies a logical OR to any nested filters.
   * @property {GuildSearchQueryBlock} [and] Applies a logical AND to any nested filters.
   * @property {number} [limit=1] The maximum number of members to return.
   * @property {boolean} [cache=true] Whether to cache the results.
   * @property {GuildSearchUsernamesQuery|string} [usernames] Filters by usernames using OR logic only, or a single username string.
   * @property {GuildSearchListQuery|RoleResolvable} [roles] Filters by roles using OR or AND logic, or a single role.
   * @property {GuildSearchRangeQuery<number>} [guildJoinedAt] Filters by guild join timestamp using range queries only.
   * @property {GuildSearchUserQuery|string} [users] Filters by users using OR logic only, or a single user string.
   * @property {GuildSearchSourceInviteCodeQuery|string} [sourceInviteCode] Filters by invite codes using OR logic only, or a single invite code.
   * @property {GuildSearchSafetySignalsQuery} [safetySignals] Internal safety filters.
   */

  /**
   * A block of filters for AND/OR logic.
   * @typedef {Object} GuildSearchQueryBlock
   * @property {GuildSearchUsernamesQuery} [usernames] Filters by usernames using OR logic only.
   * @property {GuildSearchListQuery} [roles] Filters by roles using OR or AND logic.
   * @property {GuildSearchRangeQuery<number>} [guildJoinedAt] Filters by guild join timestamp using range queries only.
   * @property {GuildSearchUserQuery} [users] Filters by users using OR logic only.
   * @property {GuildSearchSourceInviteCodeQuery} [sourceInviteCode] Filters by invite codes using OR logic only.
   * @property {GuildSearchSafetySignalsQuery} [safetySignals] Internal safety filters with restrictions on certain fields.
   */

  /**
   * Represents an OR or AND query with string values.
   * @typedef {Object} GuildSearchListQuery
   * @property {string[]} [or] Matches if any values match.
   * @property {string[]} [and] Matches only if all values match.
   */

  /**
   * Represents an OR-only query for usernames.
   * @typedef {Object} GuildSearchUsernamesQuery
   * @property {string[]} or Matches if any usernames match.
   */

  /**
   * Represents an OR-only query for users.
   * @typedef {Object} GuildSearchUserQuery
   * @property {UserResolvable[]} or Matches if any users match.
   */

  /**
   * Represents an OR-only query for source invite codes.
   * @typedef {Object} GuildSearchSourceInviteCodeQuery
   * @property {string[]} or Matches if any invite codes match.
   */

  /**
   * Range bounds for a range query.
   * @template T
   * @typedef {Object} GuildSearchRangeBounds
   * @property {T} [gte] The lower bound (inclusive)
   * @property {T} [lte] The upper bound (inclusive)
   */

  /**
   * Represents a numeric or string range query.
   * @template T
   * @typedef {Object} GuildSearchRangeQuery
   * @property {GuildSearchRangeBounds<T>} range The range bounds
   */

  /**
   * Internal Discord safety signals used for filtering.
   * Note: unusualDmActivityUntil, communicationDisabledUntil, unusualAccountActivity,
   * and automodQuarantinedUsername only support OR queries, not AND queries.
   * @typedef {Object} GuildSearchSafetySignalsQuery
   * @property {GuildSearchRangeQuery<number>} [unusualDmActivityUntil] Unusual DM activity time window (OR queries only).
   * @property {GuildSearchRangeQuery<number>} [communicationDisabledUntil] Timeout window (OR queries only).
   * @property {boolean} [unusualAccountActivity] Whether the account is flagged as unusual (OR queries only).
   * @property {boolean} [automodQuarantinedUsername] Whether AutoMod quarantined the username (OR queries only).
   */

  /**
   * Converts the public search options to the internal API format.
   * @param {GuildSearchMembersOptions} options The search options
   * @returns {Object} The formatted request body
   * @private
   */
  makeGuildMemberSearchBody(options) {
    const { limit = 1, or, and, ...topLevelFilters } = options;

    const toSnakeCase = str => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

    const processFilterValue = (key, value) => {
      if (key === 'roles' && value) {
        if (value.or) {
          return { or_query: value.or.map(role => this.guild.roles.resolveId(role)).filter(Boolean) };
        }
        if (value.and) {
          return { and_query: value.and.map(role => this.guild.roles.resolveId(role)).filter(Boolean) };
        }
        if (typeof value === 'string' || typeof value === 'number' || value?.id) {
          const resolvedRole = this.guild.roles.resolveId(value);
          return resolvedRole ? { and_query: [resolvedRole] } : { and_query: [] };
        }
      }

      if (key === 'usernames' && value) {
        if (value.or) {
          return { or_query: value.or };
        }
        if (value.and) {
          throw new TypeError("usernames only supports 'or_query'. 'and_query' is not valid for this field.");
        }
        if (typeof value === 'string') {
          return { or_query: [value] };
        }
      }

      if (key === 'sourceInviteCode' && value) {
        if (value.or) {
          return { or_query: value.or };
        }
        if (value.and) {
          throw new TypeError("'and' is not allowed for 'sourceInviteCode'. Use 'or' instead.");
        }
        if (typeof value === 'string') {
          return { or_query: [value] };
        }
      }

      if (key === 'users' && value) {
        if (value?.range) {
          throw new TypeError("'range' is not allowed for 'users'. Use 'or' instead.");
        }
        if (value.or) {
          return { or_query: value.or.map(user => this.client.users.resolveId(user) || user) };
        }
        if (value.and) {
          throw new TypeError("'and' is not allowed for 'users'. Use 'or' instead.");
        }
        if (typeof value === 'string') {
          const resolvedUser = this.client.users.resolveId(value) || value;
          return { or_query: [resolvedUser] };
        }
      }

      if (key === 'safetySignals' && value) {
        const signals = {};
        const orOnlyFields = [
          'unusualDmActivityUntil',
          'communicationDisabledUntil',
          'unusualAccountActivity',
          'automodQuarantinedUsername',
        ];

        for (const [signalKey, signalValue] of Object.entries(value)) {
          const snakeKey = toSnakeCase(signalKey);

          if (orOnlyFields.includes(signalKey) && signalValue?.and) {
            throw new TypeError(`'and' is not allowed for 'safetySignals.${signalKey}'. Use 'or' instead.`);
          }

          if (signalValue?.range) {
            const range = {};
            if (signalValue.range.gte) {
              range.gte =
                signalValue.range.gte instanceof Date ? signalValue.range.gte.getTime() : signalValue.range.gte;
            }
            if (signalValue.range.lte) {
              range.lte =
                signalValue.range.lte instanceof Date ? signalValue.range.lte.getTime() : signalValue.range.lte;
            }
            signals[snakeKey] = { range };
          } else if (signalValue?.or) {
            signals[snakeKey] = { or_query: signalValue.or };
          } else if (signalValue?.and && !orOnlyFields.includes(signalKey)) {
            signals[snakeKey] = { and_query: signalValue.and };
          } else {
            signals[snakeKey] = signalValue;
          }
        }
        return signals;
      }

      if (key === 'guildJoinedAt' && value) {
        if (value?.range) {
          const range = {};
          if (value.range.gte) {
            range.gte = value.range.gte instanceof Date ? value.range.gte.getTime() : value.range.gte;
          }
          if (value.range.lte) {
            range.lte = value.range.lte instanceof Date ? value.range.lte.getTime() : value.range.lte;
          }
          return { range };
        }
        if (value.or) {
          throw new TypeError("'guildJoinedAt' only supports range queries. Use 'range' instead of 'or'.");
        }
        if (value.and) {
          throw new TypeError("'guildJoinedAt' only supports range queries. Use 'range' instead of 'and'.");
        }
      }

      if (value?.or) {
        return { or_query: value.or };
      }
      if (value?.and) {
        return { and_query: value.and };
      }

      return value;
    };

    const convertFilters = filters => {
      const converted = {};
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) {
          const snakeKey =
            key === 'roles'
              ? 'role_ids'
              : key === 'users'
              ? 'user_id'
              : key === 'safetySignals'
              ? 'safety_signals'
              : toSnakeCase(key);
          converted[snakeKey] = processFilterValue(key, value);
        }
      }
      return converted;
    };

    const body = { limit };

    const hasTopLevelFilters = Object.keys(topLevelFilters).length > 0;

    if (hasTopLevelFilters && !and && !or) {
      body.and_query = convertFilters(topLevelFilters);
    } else if (hasTopLevelFilters && (and || or)) {
      const topLevelConverted = convertFilters(topLevelFilters);
      if (and) {
        body.and_query = { ...convertFilters(and), ...topLevelConverted };
      } else {
        body.and_query = topLevelConverted;
      }
      if (or) {
        body.or_query = convertFilters(or);
      }
    } else {
      if (and) {
        body.and_query = convertFilters(and);
      }
      if (or) {
        body.or_query = convertFilters(or);
      }
    }

    return body;
  }

  /**
   * Searches for members in the guild based on a query.
   *
   * Field Restrictions:
   * - usernames: Only supports 'or' queries
   * - users: Only supports 'or' queries and single string values
   * - guildJoinedAt: Only supports range queries
   * - sourceInviteCode: Only supports 'or' queries
   * - safetySignals.unusualDmActivityUntil: Only supports 'or' queries
   * - safetySignals.communicationDisabledUntil: Only supports 'or' queries
   * - safetySignals.unusualAccountActivity: Only supports 'or' queries
   * - safetySignals.automodQuarantinedUsername: Only supports 'or' queries
   * - roles: Supports both 'and' and 'or' queries
   *
   * @param {GuildSearchMembersOptions} options Options for searching members
   * @returns {Promise<Collection<Snowflake, GuildMember>>}
   */
  async search(options = {}) {
    const { cache = true, ...restOptions } = options;
    const requestBody = this.makeGuildMemberSearchBody(restOptions);

    const data = await this.client.api.guilds(this.guild.id, 'members-search').post({
      data: requestBody,
    });

    return data.members.reduce(
      (col, { member }) => col.set(member.user.id, this._add(member, cache)),
      new Collection(),
    );
  }

  /**
   * The data for editing a guild member.
   * @typedef {Object} GuildMemberEditData
   * @property {?string} [nick] The nickname to set for the member
   * @property {Collection<Snowflake, Role>|RoleResolvable[]} [roles] The roles or role ids to apply
   * @property {boolean} [mute] Whether or not the member should be muted
   * @property {boolean} [deaf] Whether or not the member should be deafened
   * @property {GuildVoiceChannelResolvable|null} [channel] Channel to move the member to
   * (if they are connected to voice), or `null` if you want to disconnect them from voice
   * @property {DateResolvable|null} [communicationDisabledUntil] The date or timestamp
   * for the member's communication to be disabled until. Provide `null` to enable communication again.
   * @property {GuildMemberFlagsResolvable} [flags] The flags to set for the member
   * @property {?(BufferResolvable|Base64Resolvable)} [avatar] The new guild avatar
   * @property {?(BufferResolvable|Base64Resolvable)} [banner] The new guild banner
   * @property {?string} [bio] The new guild about me
   */

  /**
   * Edits a member of the guild.
   * <info>The user must be a member of the guild</info>
   * @param {UserResolvable} user The member to edit
   * @param {GuildMemberEditData} data The data to edit the member with
   * @param {string} [reason] Reason for editing this user
   * @returns {Promise<GuildMember>}
   */
  async edit(user, data, reason) {
    const id = this.client.users.resolveId(user);
    if (!id) throw new TypeError('INVALID_TYPE', 'user', 'UserResolvable');

    // Clone the data object for immutability
    const _data = { ...data };
    if (_data.channel) {
      _data.channel = this.guild.channels.resolve(_data.channel);
      if (!(_data.channel instanceof BaseGuildVoiceChannel)) {
        throw new Error('GUILD_VOICE_CHANNEL_RESOLVE');
      }
      _data.channel_id = _data.channel.id;
      _data.channel = undefined;
    } else if (_data.channel === null) {
      _data.channel_id = null;
      _data.channel = undefined;
    }
    _data.roles &&= _data.roles.map(role => (role instanceof Role ? role.id : role));

    _data.communication_disabled_until =
      _data.communicationDisabledUntil && new Date(_data.communicationDisabledUntil).toISOString();

    _data.flags = _data.flags && GuildMemberFlags.resolve(_data.flags);

    // Avatar, banner, bio
    if (typeof _data.avatar !== 'undefined') {
      _data.avatar = await DataResolver.resolveImage(_data.avatar);
    }
    if (typeof _data.banner !== 'undefined') {
      _data.banner = await DataResolver.resolveImage(_data.banner);
    }

    let endpoint = this.client.api.guilds(this.guild.id);
    if (id === this.client.user.id) {
      const keys = Object.keys(data);
      if (keys.length === 1 && ['nick', 'avatar', 'banner', 'bio'].includes(keys[0])) {
        endpoint = endpoint.members('@me');
      } else {
        endpoint = endpoint.members(id);
      }
    } else {
      endpoint = endpoint.members(id);
    }
    const d = await endpoint.patch({ data: _data, reason });

    const clone = this.cache.get(id)?._clone();
    clone?._patch(d);
    return clone ?? this._add(d, false);
  }

  /**
   * Options used for pruning guild members.
   * <info>It's recommended to set {@link GuildPruneMembersOptions#count options.count}
   * to `false` for large guilds.</info>
   * @typedef {Object} GuildPruneMembersOptions
   * @property {number} [days=7] Number of days of inactivity required to kick
   * @property {boolean} [dry=false] Get the number of users that will be kicked, without actually kicking them
   * @property {boolean} [count=true] Whether or not to return the number of users that have been kicked.
   * @property {RoleResolvable[]} [roles] Array of roles to bypass the "...and no roles" constraint when pruning
   * @property {string} [reason] Reason for this prune
   */

  /**
   * Prunes members from the guild based on how long they have been inactive.
   * @param {GuildPruneMembersOptions} [options] Options for pruning
   * @returns {Promise<number|null>} The number of members that were/will be kicked
   * @example
   * // See how many members will be pruned
   * guild.members.prune({ dry: true })
   *   .then(pruned => console.log(`This will prune ${pruned} people!`))
   *   .catch(console.error);
   * @example
   * // Actually prune the members
   * guild.members.prune({ days: 1, reason: 'too many people!' })
   *   .then(pruned => console.log(`I just pruned ${pruned} people!`))
   *   .catch(console.error);
   * @example
   * // Include members with a specified role
   * guild.members.prune({ days: 7, roles: ['657259391652855808'] })
   *    .then(pruned => console.log(`I just pruned ${pruned} people!`))
   *    .catch(console.error);
   */
  async prune({ days = 7, dry = false, count: compute_prune_count = true, roles = [], reason } = {}) {
    if (typeof days !== 'number') throw new TypeError('PRUNE_DAYS_TYPE');

    const query = { days };
    const resolvedRoles = [];

    for (const role of roles) {
      const resolvedRole = this.guild.roles.resolveId(role);
      if (!resolvedRole) {
        throw new TypeError('INVALID_ELEMENT', 'Array', 'options.roles', role);
      }
      resolvedRoles.push(resolvedRole);
    }

    if (resolvedRoles.length) {
      query.include_roles = dry ? resolvedRoles.join(',') : resolvedRoles;
    }

    const endpoint = this.client.api.guilds(this.guild.id).prune;

    const { pruned } = await (dry
      ? endpoint.get({ query, reason })
      : endpoint.post({ data: { ...query, compute_prune_count }, reason }));

    return pruned;
  }

  /**
   * Kicks a user from the guild.
   * <info>The user must be a member of the guild</info>
   * @param {UserResolvable} user The member to kick
   * @param {string} [reason] Reason for kicking
   * @returns {Promise<GuildMember|User|Snowflake>} Result object will be resolved as specifically as possible.
   * If the GuildMember cannot be resolved, the User will instead be attempted to be resolved. If that also cannot
   * be resolved, the user's id will be the result.
   * @example
   * // Kick a user by id (or with a user/guild member object)
   * guild.members.kick('84484653687267328')
   *   .then(kickInfo => console.log(`Kicked ${kickInfo.user?.tag ?? kickInfo.tag ?? kickInfo}`))
   *   .catch(console.error);
   */
  async kick(user, reason) {
    const id = this.client.users.resolveId(user);
    if (!id) throw new TypeError('INVALID_TYPE', 'user', 'UserResolvable');

    await this.client.api.guilds(this.guild.id).members(id).delete({ reason });

    return this.resolve(user) ?? this.client.users.resolve(user) ?? id;
  }

  /**
   * Bans a user from the guild.
   * @param {UserResolvable} user The user to ban
   * @param {BanOptions} [options] Options for the ban
   * @returns {Promise<GuildMember|User|Snowflake>} Result object will be resolved as specifically as possible.
   * If the GuildMember cannot be resolved, the User will instead be attempted to be resolved. If that also cannot
   * be resolved, the user id will be the result.
   * Internally calls the GuildBanManager#create method.
   * @example
   * // Ban a user by id (or with a user/guild member object)
   * guild.members.ban('84484653687267328')
   *   .then(banInfo => console.log(`Banned ${banInfo.user?.tag ?? banInfo.tag ?? banInfo}`))
   *   .catch(console.error);
   */
  ban(user, options) {
    return this.guild.bans.create(user, options);
  }

  /**
   * Unbans a user from the guild. Internally calls the {@link GuildBanManager#remove} method.
   * @param {UserResolvable} user The user to unban
   * @param {string} [reason] Reason for unbanning user
   * @returns {Promise<?User>} The user that was unbanned
   * @example
   * // Unban a user by id (or with a user/guild member object)
   * guild.members.unban('84484653687267328')
   *   .then(user => console.log(`Unbanned ${user.username} from ${guild.name}`))
   *   .catch(console.error);
   */
  unban(user, reason) {
    return this.guild.bans.remove(user, reason);
  }

  async _fetchSingle({ user, cache, force = false }) {
    if (!force) {
      const existing = this.cache.get(user);
      if (existing && !existing.partial) return existing;
    }

    const data = await this.client.api.guilds(this.guild.id).members(user).get();
    return this._add(data, cache);
  }

  /**
   * Adds a role to a member.
   * @param {GuildMemberResolvable} user The user to add the role from
   * @param {RoleResolvable} role The role to add
   * @param {string} [reason] Reason for adding the role
   * @returns {Promise<GuildMember|User|Snowflake>}
   */
  async addRole(user, role, reason) {
    const userId = this.resolveId(user);
    const roleId = this.guild.roles.resolveId(role);

    await this.client.api.guilds(this.guild.id).members(userId).roles(roleId).put({ reason });

    return this.resolve(user) ?? this.client.users.resolve(user) ?? userId;
  }

  /**
   * Removes a role from a member.
   * @param {UserResolvable} user The user to remove the role from
   * @param {RoleResolvable} role The role to remove
   * @param {string} [reason] Reason for removing the role
   * @returns {Promise<GuildMember|User|Snowflake>}
   */
  async removeRole(user, role, reason) {
    const userId = this.resolveId(user);
    const roleId = this.guild.roles.resolveId(role);

    await this.client.api.guilds(this.guild.id).members(userId).roles(roleId).delete({ reason });

    return this.resolve(user) ?? this.client.users.resolve(user) ?? userId;
  }

  /**
   * Experimental method to fetch members from the guild.
   * <info>Lists up to 10000 members of the guild.</info>
   * @param {number} [timeout=15_000] Timeout for receipt of members in ms
   * @returns {Promise<Collection<Snowflake, GuildMember>>}
   */
  fetchByMemberSafety(timeout = 15_000) {
    return new Promise(resolve => {
      const nonce = SnowflakeUtil.generate();
      const fetchedMembers = new Collection();
      let timeout_ = setTimeout(() => {
        this.client.removeListener(Events.GUILD_MEMBERS_CHUNK, handler);
        resolve(fetchedMembers);
      }, timeout).unref();
      const handler = (members, guild, chunk) => {
        if (guild.id == this.guild.id && chunk.nonce == nonce) {
          if (members.size > 0) {
            for (const member of members.values()) {
              fetchedMembers.set(member.id, member);
            }
            this.client.ws.broadcast({
              op: Opcodes.SEARCH_RECENT_MEMBERS,
              d: {
                guild_id: this.guild.id,
                query: '',
                continuation_token: members.first()?.id,
                nonce,
              },
            });
          } else {
            clearTimeout(timeout_);
            this.client.removeListener(Events.GUILD_MEMBERS_CHUNK, handler);
            resolve(fetchedMembers);
          }
        }
      };
      this.client.on(Events.GUILD_MEMBERS_CHUNK, handler);
      this.client.ws.broadcast({
        op: Opcodes.SEARCH_RECENT_MEMBERS,
        d: {
          guild_id: this.guild.id,
          query: '',
          continuation_token: null,
          nonce,
        },
      });
    });
  }

  _fetchMany({
    limit = 0,
    withPresences: presences = true,
    user: user_ids,
    query,
    time = 120e3,
    nonce = SnowflakeUtil.generate(),
  } = {}) {
    return new Promise((resolve, reject) => {
      if (!query && !user_ids) query = '';
      if (nonce.length > 32) throw new RangeError('MEMBER_FETCH_NONCE_LENGTH');
      this.guild.shard.send({
        op: Opcodes.REQUEST_GUILD_MEMBERS,
        d: {
          guild_id: this.guild.id,
          presences,
          user_ids,
          query,
          nonce,
          limit,
        },
      });
      const fetchedMembers = new Collection();
      let i = 0;
      const handler = (members, _, chunk) => {
        timeout.refresh();
        if (chunk.nonce !== nonce) return;
        i++;
        for (const member of members.values()) {
          fetchedMembers.set(member.id, member);
        }
        if (members.size < 1_000 || (limit && fetchedMembers.size >= limit) || i === chunk.count) {
          clearTimeout(timeout);
          this.client.removeListener(Events.GUILD_MEMBERS_CHUNK, handler);
          this.client.decrementMaxListeners();
          let fetched = fetchedMembers;
          if (user_ids && !Array.isArray(user_ids) && fetched.size) fetched = fetched.first();
          resolve(fetched);
        }
      };
      const timeout = setTimeout(() => {
        this.client.removeListener(Events.GUILD_MEMBERS_CHUNK, handler);
        this.client.decrementMaxListeners();
        reject(new Error('GUILD_MEMBERS_TIMEOUT'));
      }, time).unref();
      this.client.incrementMaxListeners();
      this.client.on(Events.GUILD_MEMBERS_CHUNK, handler);
    });
  }

  /**
   * Bulk ban users from a guild, and optionally delete previous messages sent by them.
   * @param {Collection<Snowflake, UserResolvable>|UserResolvable[]} users The users to ban
   * @param {BulkBanOptions} [options] The options for bulk banning users
   * @returns {Promise<BulkBanResult>} Returns an object with `bannedUsers` key containing the IDs of the banned users
   * and the key `failedUsers` with the IDs that could not be banned or were already banned.
   * Internally calls the GuildBanManager#bulkCreate method.
   * @example
   * // Bulk ban users by ids (or with user/guild member objects) and delete all their messages from the past 7 days
   * guild.members.bulkBan(['84484653687267328'], { deleteMessageSeconds: 7 * 24 * 60 * 60 })
   *   .then(result => {
   *     console.log(`Banned ${result.bannedUsers.length} users, failed to ban ${result.failedUsers.length} users.`)
   *   })
   *   .catch(console.error);
   * @deprecated This method will not be usable until an effective MFA implementation is in place.
   */
  bulkBan(users, options = {}) {
    return this.guild.bans.bulkCreate(users, options);
  }
}

module.exports = GuildMemberManager;
