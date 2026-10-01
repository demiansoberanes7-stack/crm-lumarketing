'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface ZernioSettings {
  configured: boolean;
  source: 'organization' | 'environment' | 'none';
  profileId: string;
  apiKeyLast4: string;
}

interface ZernioTestResult {
  ok: boolean;
  message: string;
  accounts?: number;
  analytics?: boolean;
}

export const useZernioSettings = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    const response = await fetch('/settings/zernio');
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error?.message || 'Could not load the Zernio settings');
    }
    return response.json();
  }, []);

  return useSWR<ZernioSettings>('zernio-settings', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

const ZernioComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, error, isLoading, mutate } = useZernioSettings();

  const [apiKey, setApiKey] = useState('');
  const [profileId, setProfileId] = useState('');
  const [testResult, setTestResult] = useState<ZernioTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.profileId !== undefined) {
      setProfileId(data.profileId);
    }
  }, [data]);

  const save = useCallback(async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const body: { apiKey?: string; profileId: string } = { profileId };
      if (apiKey) {
        body.apiKey = apiKey;
      }

      const response = await fetch('/settings/zernio', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        toaster.show(
          problem?.message ||
            t('zernio_save_failed', 'Could not save the Zernio settings'),
          'warning'
        );
        return;
      }

      const saved = await response.json();
      setApiKey('');
      setProfileId(saved.profileId);
      await mutate(
        {
          configured: saved.configured,
          source: saved.source,
          profileId: saved.profileId,
          apiKeyLast4: saved.apiKeyLast4,
        },
        { revalidate: false }
      );
      toaster.show(t('settings_updated', 'Settings updated'), 'success');
    } finally {
      setSaving(false);
    }
  }, [apiKey, profileId, fetch, mutate, toaster, t]);

  const test = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const body: { apiKey?: string; profileId?: string } = {};
      if (apiKey) {
        body.apiKey = apiKey;
      }
      if (profileId) {
        body.profileId = profileId;
      }

      const response = await fetch('/settings/zernio/test', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      setTestResult(await response.json());
    } catch (err: any) {
      setTestResult({
        ok: false,
        message:
          err?.message || t('zernio_test_failed', 'Could not reach Zernio'),
      });
    } finally {
      setTesting(false);
    }
  }, [apiKey, profileId, fetch, t]);

  const saveOnEnter = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      }
    },
    [save]
  );

  if (isLoading) {
    return (
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px]">
        <div className="animate-pulse">{t('loading', 'Loading...')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px]">
        <div className="text-red-400 text-[14px]">{error.message}</div>
      </div>
    );
  }

  return (
    <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[24px]">
      <div className="mt-[4px]">{t('zernio_settings', 'Zernio Settings')}</div>

      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">
          {t(
            'zernio_description',
            'Channels connect and publish through Zernio. The API key is stored encrypted for this organization only and is never sent back to the browser.'
          )}
        </div>
        <div className="text-[12px] text-customColor18">
          {!data?.configured
            ? t('zernio_missing', 'No Zernio credentials configured yet')
            : data.source === 'environment'
            ? t(
                'zernio_from_environment',
                'Using the credentials of this instance, ending in {{last4}}',
                { last4: data.apiKeyLast4 }
              )
            : t('zernio_saved_key', 'Saved API key ending in {{last4}}', {
                last4: data.apiKeyLast4,
              })}
        </div>
      </div>

      <div className="flex flex-col gap-[16px]">
        <Input
          name="zernioApiKey"
          label={t('zernio_api_key', 'API key')}
          disableForm={true}
          removeError={true}
          type="password"
          autoComplete="new-password"
          placeholder={
            data?.apiKeyLast4
              ? `••••${data.apiKeyLast4}`
              : t('zernio_api_key_placeholder', 'zrn_...')
          }
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          onKeyDown={saveOnEnter}
        />
        <Input
          name="zernioProfileId"
          label={t('zernio_profile_id', 'Profile ID')}
          disableForm={true}
          removeError={true}
          placeholder={t(
            'zernio_profile_id_placeholder',
            'Profile id from Zernio'
          )}
          value={profileId}
          onChange={(event) => setProfileId(event.target.value)}
          onKeyDown={saveOnEnter}
        />
      </div>

      <div className="flex items-center gap-[12px]">
        <Button loading={saving} disabled={!profileId} onClick={save}>
          {t('save', 'Save')}
        </Button>
        <Button
          secondary={true}
          loading={testing}
          disabled={!profileId && !apiKey}
          onClick={test}
        >
          {t('zernio_test_connection', 'Test connection')}
        </Button>
      </div>

      {!!testResult && (
        <div
          className={`text-[13px] rounded-[4px] border p-[12px] ${
            testResult.ok
              ? 'text-green-400 border-green-400/40'
              : 'text-red-400 border-red-400/40'
          }`}
        >
          {testResult.message}
          {testResult.ok &&
            typeof testResult.analytics !== 'undefined' &&
            (testResult.analytics
              ? ' ' + t('zernio_analytics_on', 'Analytics add-on available.')
              : ' ' +
                t(
                  'zernio_analytics_off',
                  'Analytics add-on not enabled on this profile.'
                ))}
        </div>
      )}
    </div>
  );
};

export default ZernioComponent;
