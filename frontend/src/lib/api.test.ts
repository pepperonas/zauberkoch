// @vitest-environment happy-dom
/**
 * API client: error mapping, the CSRF rule, and the export download.
 *
 * Needs a DOM because `exportData` drives a real <a download> click — that
 * mechanism is easy to break silently (a missing revokeObjectURL leaks, a
 * missing appendChild does nothing in some browsers), and nothing else in the
 * suite touches it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiRequestError, getCsrfToken, setCsrfToken } from './api';

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)], { type: 'application/json' }),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setCsrfToken('csrf-abc');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request()', () => {
  it('sends the CSRF header on state-changing calls but not on GET', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ authenticated: false }));
    await api.me();
    expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined();

    fetchMock.mockResolvedValue(jsonResponse({ active: false, hint: '', since: null }));
    await api.removeAnthropicKey();
    expect(fetchMock.mock.calls[1][1].headers['X-CSRF-Token']).toBe('csrf-abc');
  });

  it('exposes the stored token', () => {
    expect(getCsrfToken()).toBe('csrf-abc');
  });

  it('turns an error body into ApiRequestError with code and status', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'daily_limit_user', message: 'Tageslimit erreicht' } }, { status: 429 }),
    );
    await expect(api.me()).rejects.toMatchObject({
      status: 429,
      error: { code: 'daily_limit_user' },
    });
  });

  it('survives a non-JSON error body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    const err = await api.me().catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(502);
    expect(err.error.code).toBe('unknown');
  });

  it('returns undefined for 204 instead of trying to parse a body', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as unknown as Response);
    await expect(api.deleteAccount('pw')).resolves.toBeUndefined();
  });

  it('sends confirm plus the password when deleting an account', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as unknown as Response);
    await api.deleteAccount('geheim');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      confirm: true,
      password: 'geheim',
    });
  });

  it('sends null rather than an empty password for accounts without one', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 } as unknown as Response);
    await api.deleteAccount();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).password).toBeNull();
  });
});

describe('setAnthropicKey', () => {
  it('sends the key once, in the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ active: true, hint: 'WXYZ', since: null }));
    const res = await api.setAnthropicKey('sk-ant-api03-secret-WXYZ');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/me/anthropic-key');
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ key: 'sk-ant-api03-secret-WXYZ' });
    // The response carries status only — never the key back.
    expect(res).toEqual({ active: true, hint: 'WXYZ', since: null });
  });
});

describe('exportData', () => {
  let created: string[];
  let revoked: string[];
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    created = [];
    revoked = [];
    clicked = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:mock-${created.length}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
  });

  it('downloads a dated .json file and cleans up after itself', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ export_version: 1 }));
    await api.exportData();

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toMatch(/^zauberkoch-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(clicked[0].href).toContain('blob:mock-0');
    // Object URLs are a documented leak if never revoked.
    expect(revoked).toEqual(created);
    // The anchor must not stay behind in the document.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('throws instead of downloading an error page', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 } as unknown as Response);
    await expect(api.exportData()).rejects.toBeInstanceOf(ApiRequestError);
    expect(clicked).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('sends the session cookie', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await api.exportData();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' });
  });
});
