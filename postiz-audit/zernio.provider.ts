import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import { createHash } from 'crypto';
import { lookup } from 'mime-types';
import { Readable } from 'stream';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { setHeartbeatDetails } from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import {
  BadBody,
  SocialAbstract,
  stripQuery,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  GenerateAuthUrlResponse,
  PendingCheckResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

// Zernio publishes on behalf of the connected accounts, so a channel is backed
// by the organization's Zernio API key + profile id instead of an OAuth token
// of its own. The wrapped provider keeps its identifier, name, editor and
// character limits (the composer reads them straight off the provider), and
// only the connect, publish and analytics paths are replaced below.

type ZernioCredentials = { apiKey: string; profileId: string };

// How long an unexpired channel is left alone: Zernio credentials are valid
// until they are revoked, so the refresh workflow must never start for them.
const CREDENTIALS_LIFETIME = 10 * 365 * 24 * 60 * 60;

const zernioBaseUrl = () =>
  (process.env.ZERNIO_BASE_URL || 'https://zernio.com/api').replace(/\/+$/, '');

// Postiz identifier -> Zernio platform slug. Only X and Google Business are
// named differently; every other Zernio platform uses the Postiz identifier.
const zernioPlatform = (identifier: string) =>
  ((
    {
      x: 'twitter',
      gmb: 'googlebusiness',
    } as { [key: string]: string }
  )[identifier] || identifier);

// Presign rejects anything outside this list, so an unsupported attachment is
// reported before the upload instead of with a platform-side 400.
const ZERNIO_MEDIA_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/mpeg',
  'video/quicktime',
  'video/avi',
  'video/x-msvideo',
  'video/webm',
  'video/x-m4v',
  'application/pdf',
]);

const METRICS: Array<[string, string]> = [
  ['impressions', 'Impressions'],
  ['reach', 'Reach'],
  ['likes', 'Likes'],
  ['comments', 'Comments'],
  ['shares', 'Shares'],
  ['views', 'Views'],
];

const resolveCredentials = (organization?: Organization): ZernioCredentials => {
  // The organization wins so two organizations on the same instance can use
  // different Zernio accounts; the environment is the fallback for
  // self-hosters who configure one key for the whole instance.
  const apiKey = organization?.zernioApiKey
    ? AuthService.fixedDecryption(organization.zernioApiKey)
    : process.env.ZERNIO_API_KEY;
  const profileId =
    organization?.zernioProfileId || process.env.ZERNIO_PROFILE_ID;

  if (!apiKey || !profileId) {
    throw new Error(
      'Zernio is not configured, add the Zernio API key and profile id in Settings first'
    );
  }

  return { apiKey, profileId };
};

// Exported so the Settings screen can rewrite the credentials already stored on
// an organization's channels when its API key or profile id changes.
export const encodeChannelCredentials = (credentials: ZernioCredentials) =>
  AuthService.fixedEncryption(JSON.stringify(credentials));

// Falls back to the environment for channels created before the Settings
// screen existed, so they keep publishing instead of failing on a decode.
const decodeChannelCredentials = (token: string): ZernioCredentials => {
  try {
    const parsed = JSON.parse(AuthService.fixedDecryption(token));
    if (parsed?.apiKey && parsed?.profileId) {
      return parsed;
    }
  } catch (err) {
    // not our blob, resolve from the environment below
  }
  return resolveCredentials(undefined);
};

const zernioErrorMessage = (data: any) =>
  data?.message ||
  (typeof data?.error === 'string' ? data.error : data?.error?.message) ||
  data?.error_description ||
  '';

type ZernioResponse<T> = {
  status: number;
  data: T;
  headers: Headers;
};

// Zernio answers POST /v1/posts with 200 (idempotent retry), 201 (created) and
// 207 (partial), which this.fetch would treat as failures, so the requests go
// through plain fetch with the same SSRF-safe dispatcher and heartbeat.
async function zernioRequest<T = any>(
  identifier: string,
  apiKey: string,
  path: string,
  init: {
    method?: string;
    body?: any;
    headers?: { [key: string]: string };
  } = {}
): Promise<ZernioResponse<T>> {
  const url = `${zernioBaseUrl()}${path}`;
  setHeartbeatDetails(`fetch ${stripQuery(url)}`);

  let last: ZernioResponse<T> = {
    status: 429,
    data: undefined as T,
    headers: new Headers(),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      method: init.method || 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      dispatcher: getSsrfSafeDispatcher(),
    } as any);

    const text = await response.text().catch(() => '{}');
    let data: T;
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = text as unknown as T;
    }

    last = { status: response.status, data, headers: response.headers };

    if (response.status !== 429) {
      return last;
    }
    await timer(5000);
  }

  return last;
}

async function zernioCall<T = any>(
  identifier: string,
  apiKey: string,
  path: string,
  init?: {
    method?: string;
    body?: any;
    headers?: { [key: string]: string };
  }
): Promise<T> {
  const { status, data } = await zernioRequest<T>(
    identifier,
    apiKey,
    path,
    init
  );

  if (status < 200 || status >= 300) {
    throw new BadBody(
      identifier,
      typeof data === 'string' ? data : JSON.stringify(data || {}),
      JSON.stringify(init?.body || {}),
      zernioErrorMessage(data) || `Zernio request failed with status ${status}`
    );
  }

  return data;
}

// The SSRF-safe media readers live on SocialAbstract; the wrapper is not a
// subclass, so it reaches them through this alias instead of copying them.
type MediaReaders = {
  mediaSize(path: string, identifier?: string): Promise<number>;
  mediaStream(path: string, identifier?: string): Promise<Readable>;
};

const mediaReaders = (provider: SocialProvider & SocialAbstract) => {
  const readers = provider as unknown as MediaReaders;
  return {
    size: readers.mediaSize.bind(readers),
    stream: readers.mediaStream.bind(readers),
  };
};

const uploadMedia = async (
  identifier: string,
  credentials: ZernioCredentials,
  readers: {
    size: (path: string, identifier?: string) => Promise<number>;
    stream: (path: string, identifier?: string) => Promise<Readable>;
  },
  media: PostDetails['media']
) => {
  const items: any[] = [];

  for (const item of media || []) {
    const filename = item.path.split('/').pop() || 'file';
    const contentType = lookup(filename);

    if (!contentType || !ZERNIO_MEDIA_CONTENT_TYPES.has(contentType)) {
      throw new BadBody(
        identifier,
        '{}',
        '{}',
        `Zernio cannot upload ${filename} (${contentType || 'unknown type'})`
      );
    }

    const size = await readers.size(item.path, identifier);
    const { uploadUrl, publicUrl } = await zernioCall(
      identifier,
      credentials.apiKey,
      '/v1/media/presign',
      {
        method: 'POST',
        body: { filename, contentType, size },
      }
    );

    const stream = await readers.stream(item.path, identifier);
    const upload = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
      },
      body: stream,
      // Required by undici when streaming a request body.
      duplex: 'half',
      dispatcher: getSsrfSafeDispatcher(),
    } as any);

    if (!upload.ok) {
      const text = await upload.text().catch(() => '{}');
      throw new BadBody(
        identifier,
        text,
        '{}',
        `Zernio could not store ${filename} for publishing`
      );
    }

    items.push({
      type: contentType.startsWith('image/')
        ? contentType === 'image/gif'
          ? 'gif'
          : 'image'
        : contentType === 'application/pdf'
        ? 'document'
        : 'video',
      url: publicUrl,
      filename,
      size,
      mimeType: contentType,
      ...(item.alt ? { altText: item.alt } : {}),
    });
  }

  return items;
};

const targetOf = (post: any, platform: string) =>
  (post?.platforms || []).find((p: any) => p.platform === platform) ||
  post?.platforms?.[0];

const toPostResponse = (
  identifier: string,
  detail: PostDetails,
  platform: string,
  post: any
): PostResponse => {
  const target = targetOf(post, platform);

  if (target?.status === 'failed' || post?.status === 'failed') {
    throw new BadBody(
      identifier,
      JSON.stringify(post || {}),
      '{}',
      target?.errorMessage || 'Zernio could not publish this post'
    );
  }

  // A published platform entry is the end of the line for this channel: the
  // workflow stores the Zernio post id as the release id, which is what the
  // per-post statistics endpoint is called with.
  if (target?.status === 'published' || post?.status === 'published') {
    return {
      id: detail.id,
      postId: post._id,
      releaseURL: target?.platformPostUrl || '',
      status: 'completed',
    };
  }

  return {
    id: detail.id,
    postId: post._id,
    releaseURL: '',
    status: 'pending',
    pendingData: { postId: post._id },
  };
};

const createPost = async (
  identifier: string,
  credentials: ZernioCredentials,
  accountId: string,
  detail: PostDetails,
  mediaItems: any[]
) => {
  const platform = zernioPlatform(identifier);
  const body = {
    content: detail.message,
    ...(mediaItems.length ? { mediaItems } : {}),
    publishNow: true,
    platforms: [{ platform, accountId }],
  };

  // Keyed on the post and its content so a workflow retry after a timeout
  // returns the original post, while an edited body is a new post.
  const idempotencyKey = `postiz-${detail.id}-${createHash('sha1')
    .update(`${detail.message}|${mediaItems.map((m) => m.url).join(',')}`)
    .digest('hex')
    .slice(0, 16)}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { status, data, headers } = await zernioRequest(
      identifier,
      credentials.apiKey,
      '/v1/posts',
      { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } }
    );

    // The previous attempt with this key is still being saved.
    if (status === 409 && data?.code === 'idempotency_conflict') {
      const retryAfter = Number(headers.get('retry-after'));
      await timer(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 5) * 1000
          : 2000
      );
      continue;
    }

    if (status === 409 && data?.existingPostId) {
      throw new BadBody(
        identifier,
        JSON.stringify(data),
        '{}',
        'This exact post was already published to this account in the last 24 hours, change the text or the media to publish it again'
      );
    }

    if (status < 200 || status >= 300) {
      throw new BadBody(
        identifier,
        JSON.stringify(data || {}),
        JSON.stringify(body),
        zernioErrorMessage(data) ||
          `Zernio rejected the post with status ${status}`
      );
    }

    if (data?.error && !data?.post) {
      throw new BadBody(identifier, JSON.stringify(data), '{}', data.error);
    }

    return data?.post;
  }

  throw new BadBody(
    identifier,
    '{}',
    '{}',
    'Zernio is still publishing a previous attempt of this post, try again shortly'
  );
};

const readPost = async (
  identifier: string,
  credentials: ZernioCredentials,
  postId: string
) => {
  const { post } = await zernioCall(
    identifier,
    credentials.apiKey,
    `/v1/posts/${postId}`
  );

  if (!post) {
    throw new BadBody(
      identifier,
      '{}',
      '{}',
      'Zernio no longer knows about this post'
    );
  }

  return post;
};

const checkPublished = (
  identifier: string,
  platform: string,
  post: any,
  pendingData: any
): PendingCheckResponse => {
  const target = targetOf(post, platform);

  if (
    target?.status === 'failed' ||
    post.status === 'failed' ||
    post.status === 'cancelled'
  ) {
    throw new BadBody(
      identifier,
      JSON.stringify(post || {}),
      '{}',
      target?.errorMessage || 'Zernio could not publish this post'
    );
  }

  if (target?.status === 'published' || post.status === 'published') {
    return {
      status: 'completed',
      postId: post._id,
      releaseURL: target?.platformPostUrl || '',
    };
  }

  return { status: 'pending', pendingData };
};

const dailyMetrics = async (
  identifier: string,
  credentials: ZernioCredentials,
  accountId: string,
  fromDate: string,
  toDate: string
) => {
  const query = new URLSearchParams({
    platform: zernioPlatform(identifier),
    profileId: credentials.profileId,
    accountId,
    fromDate,
    toDate,
  });

  return zernioCall(
    identifier,
    credentials.apiKey,
    `/v1/analytics/daily-metrics?${query.toString()}`
  );
};

const metricTotal = (dailyData: any[], key: string) =>
  (dailyData || []).reduce((acc, day) => acc + (day.metrics?.[key] || 0), 0);

// Providers currently routed through Zernio. The Settings screen uses it to
// know which stored channel credentials have to be rewritten when the API key
// or the profile id of an organization changes.
export const zernioWrappedIdentifiers = new Set<string>();

/**
 * Checks a pair of credentials against Zernio without connecting anything.
 * Used by the Settings "test" button, so the message it shows is Zernio's own.
 */
export const verifyZernioCredentials = async (
  apiKey: string,
  profileId: string
): Promise<{
  ok: boolean;
  message: string;
  accounts?: number;
  analytics?: boolean;
}> => {
  if (!apiKey || !profileId) {
    return {
      ok: false,
      message: 'An API key and a profile id are both required',
    };
  }

  try {
    const data = await zernioCall(
      'zernio',
      apiKey,
      `/v1/accounts?${new URLSearchParams({
        profileId,
        page: '1',
        limit: '100',
      }).toString()}`
    );

    const accounts = data?.accounts?.length || 0;
    return {
      ok: true,
      message: accounts
        ? `Connected, ${accounts} social account${
            accounts === 1 ? '' : 's'
          } on this profile`
        : 'Connected, this profile has no social accounts yet',
      accounts,
      analytics: !!data?.hasAnalyticsAccess,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Zernio rejected these credentials',
    };
  }
};

/**
 * Replaces the connect, publish and analytics paths of a provider with the
 * Zernio implementation. The rest of the provider (composer settings, length
 * limits, media conversion, agent tools, worker registration) is left alone,
 * so a wrapped channel behaves exactly like its native counterpart everywhere
 * Zernio is not involved.
 */
export const wrapProviderWithZernio = (
  provider: SocialProvider & SocialAbstract
): SocialProvider & SocialAbstract => {
  const identifier = provider.identifier;
  const readers = mediaReaders(provider);
  zernioWrappedIdentifiers.add(identifier);

  // Zernio resolves pages, boards and channels on its own connect screen, so
  // the provider must not ask for a second selection step after the redirect.
  provider.isBetweenSteps = false;
  // Credentials live on the organization and never expire on their own.
  provider.refreshCron = undefined;
  // The per-platform settings DTOs are not mapped to Zernio's platformSpecificData yet.
  provider.dto = undefined;
  if (!provider.toolTip) {
    provider.toolTip = 'Published through Zernio';
  }

  // Everything below talks to the platform with the native OAuth token the
  // channel no longer has, so it is switched off instead of failing later.
  provider.postPending = undefined;
  provider.comment = undefined;
  provider.mention = undefined;
  provider.changeNickname = undefined;
  provider.changeProfilePicture = undefined;
  provider.missing = undefined;
  provider.reConnect = undefined;

  provider.generateAuthUrl = async (
    _clientInformation?: ClientInformation,
    organization?: Organization
  ): Promise<GenerateAuthUrlResponse> => {
    const { profileId } = resolveCredentials(organization);
    const state = makeSecureId(16);
    const codeVerifier = makeSecureId(30);
    // Zernio keeps our query string on every redirect and appends its own
    // connected/accountId params, so the state has to travel in the redirect
    // url rather than in a request parameter (the connect endpoint has none).
    const redirectUrl = `${process.env.FRONTEND_URL}/integrations/social/${identifier}?state=${state}`;
    const url =
      `${zernioBaseUrl()}/v1/connect/${zernioPlatform(identifier)}` +
      `?profileId=${encodeURIComponent(profileId)}` +
      `&redirect_url=${encodeURIComponent(redirectUrl)}`;

    return { url, codeVerifier, state };
  };

  provider.authenticate = async (params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
    organization?: Organization;
    error?: string;
  }) => {
    if (params.error) {
      return `Zernio could not connect this account: ${params.error}`;
    }

    const credentials = resolveCredentials(params.organization);

    if (!params.code) {
      return 'Zernio did not return an account for this connection, please try again';
    }

    const { accounts } = await zernioCall(
      identifier,
      credentials.apiKey,
      `/v1/accounts?${new URLSearchParams({
        profileId: credentials.profileId,
      }).toString()}`
    );

    // The connect flow hands back Zernio's account id; a profile holds one
    // account per platform, so the list is resolved to the channel's identity.
    const account = (accounts || []).find((a: any) => a._id === params.code);
    if (!account) {
      return 'The account returned by Zernio is not on this profile, please reconnect it';
    }

    const token = encodeChannelCredentials(credentials);
    return {
      id: account._id,
      name: account.displayName || account.username || account._id,
      accessToken: token,
      refreshToken: token,
      expiresIn: CREDENTIALS_LIFETIME,
      picture: account.profileUrl,
      username: account.username || account._id,
    };
  };

  provider.refreshToken = async (token: string): Promise<AuthTokenDetails> => {
    const encoded = encodeChannelCredentials(decodeChannelCredentials(token));
    return {
      id: '',
      name: '',
      accessToken: encoded,
      refreshToken: encoded,
      expiresIn: CREDENTIALS_LIFETIME,
      username: '',
    };
  };

  provider.post = async (
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> => {
    const credentials = decodeChannelCredentials(accessToken);
    const results: PostResponse[] = [];

    for (const detail of postDetails) {
      const mediaItems = await uploadMedia(
        identifier,
        credentials,
        readers,
        detail.media
      );
      const post = await createPost(
        identifier,
        credentials,
        id,
        detail,
        mediaItems
      );
      results.push(
        toPostResponse(identifier, detail, zernioPlatform(identifier), post)
      );
    }

    return results;
  };

  const checkStatus = async (
    accessToken: string,
    pendingData: any
  ): Promise<PendingCheckResponse> => {
    const postId = pendingData?.postId || pendingData;
    const credentials = decodeChannelCredentials(accessToken);
    const post = await readPost(identifier, credentials, postId);
    return checkPublished(
      identifier,
      zernioPlatform(identifier),
      post,
      pendingData
    );
  };

  provider.checkPostStatus = checkStatus;
  provider.finalizePost = async (accessToken: string, pendingData: any) =>
    checkStatus(accessToken, pendingData);

  provider.analytics = async (
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> => {
    const credentials = decodeChannelCredentials(accessToken);
    const days = Math.max(date || 0, 1);
    const toDate = dayjs().format('YYYY-MM-DD');
    const fromDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
    const previousFrom = dayjs()
      .subtract(days * 2, 'day')
      .format('YYYY-MM-DD');
    const previousTo = dayjs().subtract(days, 'day').format('YYYY-MM-DD');

    const current = await dailyMetrics(
      identifier,
      credentials,
      id,
      fromDate,
      toDate
    );

    // The trend compares against the previous window of the same length; it is
    // an extra call, so a failure there only costs the percentage, not the chart.
    const previous = await dailyMetrics(
      identifier,
      credentials,
      id,
      previousFrom,
      previousTo
    ).catch(() => undefined);

    const currentData = current?.dailyData || [];
    const previousData = previous?.dailyData;

    return METRICS.map(([key, label]) => {
      const currentTotal = metricTotal(currentData, key);
      const previousTotal = previousData ? metricTotal(previousData, key) : 0;
      const change =
        previousTotal > 0
          ? Math.round(
              ((currentTotal - previousTotal) / previousTotal) * 1000
            ) / 10
          : 0;

      return {
        label,
        percentageChange: change,
        data: currentData.map((day: any) => ({
          total: String(day.metrics?.[key] || 0),
          date: day.date,
        })),
      };
    });
  };

  provider.postAnalytics = async (
    _integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> => {
    const credentials = decodeChannelCredentials(accessToken);
    const days = Math.max(date || 0, 1);
    const query = new URLSearchParams({
      postId,
      fromDate: dayjs().subtract(days, 'day').format('YYYY-MM-DD'),
      toDate: dayjs().format('YYYY-MM-DD'),
    });

    const data = await zernioCall(
      identifier,
      credentials.apiKey,
      `/v1/analytics?${query.toString()}`
    );

    // 202 (sync pending) and 424 (no platform returned metrics) arrive as
    // non-2xx and are thrown as BadBody, which checkPostAnalytics reports as
    // an empty chart; a response without metrics means the same thing.
    const metrics = data?.analytics;
    if (!metrics) {
      return [];
    }

    const today = dayjs().format('YYYY-MM-DD');
    return METRICS.map(([key, label]) => ({
      label,
      percentageChange: 0,
      data: [{ total: String(metrics[key] || 0), date: today }],
    }));
  };

  return provider;
};
