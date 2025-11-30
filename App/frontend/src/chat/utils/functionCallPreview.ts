import type {
  FunctionCallOperationFieldPreview,
  FunctionCallOperationPreview,
} from '../../llm_request/types';
import { isIdField } from './objectNameResolver';

const ELLIPSIS = '...';

export const buildOperationPreviewsFromArgs = (
  args: any,
  schema?: any
): FunctionCallOperationPreview[] => {
  if (!args) {
    return [];
  }

  const operationsSchema =
    schema?.properties?.operations?.items ??
    schema?.items ??
    schema;

  if (Array.isArray(args.operations)) {
    return args.operations.map((operation: any, index: number) =>
      buildPreviewFromOperation(operation, index, operationsSchema)
    );
  }

  if (Array.isArray(args)) {
    return args.map((operation: any, index: number) =>
      buildPreviewFromOperation(operation, index, schema?.items)
    );
  }

  return [buildPreviewFromOperation(args, 0, schema)];
};

export const buildPreviewFromOperation = (
  operation: any,
  index: number,
  schema?: any
): FunctionCallOperationPreview => {
  const keySource = operation?.id ?? `${operation?.type ?? 'operation'}-${index}`;
  const data = resolveOperationData(operation);
  const fields = extractFieldPreviews(data);
  const missingFields = computeMissingFields(schema, operation);
  const chapters = Array.isArray(data?.chapters)
    ? data.chapters.map((chapter: any, chapterIndex: number) => ({
        name: chapter?.name ?? `Chapter ${chapterIndex + 1}`,
        description: chapter?.description ?? '',
      }))
    : undefined;

  const targetName =
    operation?.targetName ||
    data?.title ||
    data?.name ||
    data?.logline;

  const summary = data?.description ?? '';

  return {
    key: keySource,
    action: operation?.action,
    type: operation?.type,
    id: operation?.id,
    data,
    targetName,
    summary,
    fields,
    chapters,
    missingFields,
    rawSnippet: stringifySafe(operation),
  };
};

export const resolveOperationData = (operation: any): Record<string, any> | undefined => {
  if (operation && typeof operation === 'object') {
    if (operation.data && typeof operation.data === 'object') {
      return operation.data;
    }
    return operation;
  }
  return undefined;
};

export const extractFieldPreviews = (
  data: Record<string, any> | undefined,
  limit: number = 6
): FunctionCallOperationFieldPreview[] => {
  if (!data || typeof data !== 'object') {
    return [];
  }

  const preferredKeys = ['name', 'description', 'genre', 'logline', 'content', 'order'];
  const seen = new Set<string>();
  const result: FunctionCallOperationFieldPreview[] = [];

  const pushField = (key: string, value: any) => {
    if (result.length >= limit || value === undefined || value === null) {
      return;
    }
    // Skip ID fields - they'll be resolved to names separately
    if (isIdField(key)) {
      return;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      result.push({
        key,
        label: humanizePreviewKey(key),
        value: trimmed,
      });
      seen.add(key);
      return;
    }

    if (typeof value === 'number') {
      result.push({
        key,
        label: humanizePreviewKey(key),
        value: String(value),
      });
      seen.add(key);
    }
  };

  preferredKeys.forEach((key) => pushField(key, data[key]));

  Object.entries(data).forEach(([key, value]) => {
    if (result.length >= limit || seen.has(key)) {
      return;
    }
    pushField(key, value);
  });

  return result;
};

export const computeMissingFields = (schema: any, value: any): string[] => {
  if (!schema || !Array.isArray(schema.required)) {
    return [];
  }

  if (!value || typeof value !== 'object') {
    return schema.required;
  }

  return schema.required.filter((key: string) => !(key in value));
};

export const humanizePreviewKey = (key: string): string => {
  if (!key) {
    return '';
  }

  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .replace(/^\w/g, (char) => char.toUpperCase());
};

export const stringifySafe = (value: any): string => {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized.length > 800 ? `${serialized.slice(0, 800)}${ELLIPSIS}` : serialized;
  } catch {
    return '';
  }
};
