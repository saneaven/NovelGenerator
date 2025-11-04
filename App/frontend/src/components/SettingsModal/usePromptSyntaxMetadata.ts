import { useEffect, useMemo, useState } from 'react';

import { promptService, type PromptSyntaxMetadata } from '../../api/promptService';

type AsyncState<T> = {
    data: T | null;
    loading: boolean;
    error: Error | null;
};

let cachedMetadata: PromptSyntaxMetadata | null = null;
let inflightRequest: Promise<PromptSyntaxMetadata> | null = null;

function ensureError(value: unknown): Error {
    if (value instanceof Error) {
        return value;
    }
    return new Error(typeof value === 'string' ? value : 'Failed to load template syntax metadata');
}

export function usePromptSyntaxMetadata(): AsyncState<PromptSyntaxMetadata> & { refresh: () => Promise<void> } {
    const [state, setState] = useState<AsyncState<PromptSyntaxMetadata>>({
        data: cachedMetadata,
        loading: !cachedMetadata,
        error: null,
    });

    useEffect(() => {
        if (cachedMetadata) {
            return;
        }

        let cancelled = false;

        if (!inflightRequest) {
            inflightRequest = promptService.getSyntaxMetadata().then((result) => {
                cachedMetadata = result;
                return result;
            });
        }

        inflightRequest
            .then((result) => {
                if (cancelled) return;
                setState({
                    data: result,
                    loading: false,
                    error: null,
                });
            })
            .catch((err) => {
                if (cancelled) return;
                const error = ensureError(err);
                inflightRequest = null;
                setState({
                    data: null,
                    loading: false,
                    error,
                });
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const refresh = useMemo(
        () => async () => {
            setState((prev) => ({
                ...prev,
                loading: true,
                error: null,
            }));
            cachedMetadata = null;
            inflightRequest = null;
            try {
                const result = await promptService.getSyntaxMetadata();
                cachedMetadata = result;
                setState({
                    data: result,
                    loading: false,
                    error: null,
                });
            } catch (err) {
                const error = ensureError(err);
                setState({
                    data: null,
                    loading: false,
                    error,
                });
            }
        },
        []
    );

    return {
        ...state,
        refresh,
    };
}

