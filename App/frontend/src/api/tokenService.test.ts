import { describe, expect, it, vi } from 'vitest';

describe('tokenService object-content counting', () => {
  it('posts selected object ids to the object-content endpoint', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'http://api.test');
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({
        token_count: 17,
        provider: 'openrouter',
        model: 'model-a',
        effective_tokenizer: 'openai',
        is_estimate: true,
        fallback_used: false,
        method: 'tiktoken',
      }),
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { tokenService } = await import('./tokenService');

    await tokenService.countObjectContentTokens({
      project_id: 'project-1',
      language: 'English',
      object_ids: ['outline-1', 'chapter-1'],
      provider: 'openrouter',
      model: 'model-a',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/tokens/count-object-content');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      project_id: 'project-1',
      language: 'English',
      object_ids: ['outline-1', 'chapter-1'],
      provider: 'openrouter',
      model: 'model-a',
    });
  });
});
