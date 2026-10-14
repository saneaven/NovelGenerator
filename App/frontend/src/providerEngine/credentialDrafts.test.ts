import { describe, expect, it } from 'vitest';

import type { PublicFieldSpec, PublicProviderSpec } from './types';
import { buildCredentialDrafts, normalizeCredentialDraft, validateCredentialDraftJson } from './utils';

function stringField(defaultValue?: string): PublicFieldSpec {
  return {
    kind: 'string',
    expose: true,
    required: true,
    options: [],
    disabled_options: [],
    when: [],
    disabled_when: [],
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ui: { widget: 'text' },
  };
}

const vertexSpec = {
  id: 'vertex',
  credentials: {
    kind: 'object',
    expose: true,
    when: [],
    fields: {
      project_id: stringField(),
      location: stringField('global'),
      service_account_json: {
        ...stringField(),
        kind: 'object',
        ui: { widget: 'json' },
      },
    },
  },
} as unknown as PublicProviderSpec;

describe('service account credential drafts', () => {
  it('preserves multiline private keys while parsing the credential JSON', () => {
    const serviceAccount = {
      type: 'service_account',
      client_email: 'agent@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nexample-key\n-----END PRIVATE KEY-----\n',
    };
    const draft = {
      ...buildCredentialDrafts({ vertex: vertexSpec }).vertex,
      project_id: '  example-project  ',
      service_account_json: `\n${JSON.stringify(serviceAccount, null, 2)}\n`,
    };

    expect(validateCredentialDraftJson(vertexSpec, draft)).toBeNull();
    expect(normalizeCredentialDraft(vertexSpec, draft)).toEqual({
      project_id: 'example-project',
      location: 'global',
      service_account_json: serviceAccount,
    });
  });

  it('lets clearing every field produce the empty config used for credential deletion', () => {
    expect(normalizeCredentialDraft(vertexSpec, {
      project_id: '',
      location: '',
      service_account_json: '',
    })).toEqual({});
  });

  it.each(['[]', 'null', '"example-key"', '{ invalid-json }'])('rejects non-object JSON %s', (json) => {
    const draft = { service_account_json: json };

    expect(validateCredentialDraftJson(vertexSpec, draft)).toBe('service_account_json');
    expect(() => normalizeCredentialDraft(vertexSpec, draft)).toThrow();
  });
});
