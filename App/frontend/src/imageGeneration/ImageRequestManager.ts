/**
 * Image Request Manager
 * Manages the lifecycle of a single image generation request
 */

import type { MutableRefObject } from 'react';
import { generateImage } from './imageService';
import { preProcess } from './processors/PreProcessor';
import { postProcess } from './processors/PostProcessor';
import type {
    ImageGenerationRequest,
    ImageGenerationResult,
    ImagePipelineContext,
    ImageRequestManagerCallbacks,
} from './types';

export interface ImageRequestManagerConfig {
    projectId: string;
    apiKey: string;
    context: ImagePipelineContext;
    abortControllerRef: MutableRefObject<AbortController | null>;
}

export class ImageRequestManager {
    private isGenerating = false;
    private readonly config: ImageRequestManagerConfig;
    private readonly callbacks: ImageRequestManagerCallbacks;

    constructor(config: ImageRequestManagerConfig, callbacks: ImageRequestManagerCallbacks) {
        this.config = config;
        this.callbacks = callbacks;
    }

    /**
     * Generate an image
     */
    async generate(request: ImageGenerationRequest): Promise<void> {
        if (this.isGenerating) {
            console.warn('ImageRequestManager: Generation already in progress');
            return;
        }

        this.isGenerating = true;
        this.config.abortControllerRef.current = new AbortController();

        try {
            // Pre-process the request (apply styles, transform to API format)
            const processedRequest = preProcess(request, this.config.context);

            // Consume the async generator with manual iteration to capture return value
            const generator = generateImage(
                this.config.projectId,
                processedRequest,
                this.config.apiKey,
                { signal: this.config.abortControllerRef.current.signal }
            );

            // Manual iteration to properly capture the generator's return value
            // Note: for await...of loses the return value, so we use while + next()
            let result: ImageGenerationResult | undefined;
            while (true) {
                const next = await generator.next();

                if (next.done) {
                    // Capture the return value when generator completes
                    result = next.value;
                    break;
                }

                // Check if aborted
                if (this.config.abortControllerRef.current?.signal.aborted) {
                    break;
                }

                // Emit progress update
                this.callbacks.onProgress?.(next.value);
            }

            // Check for errors
            if (!result || !result.success) {
                throw new Error(result?.error || 'Image generation failed');
            }

            // Post-process: fetch full asset details
            const processedResult = await postProcess(result, this.config);

            // Emit completion
            this.callbacks.onComplete(processedResult);
        } catch (error) {
            // Don't emit error for intentional aborts
            if (error instanceof Error && error.name === 'AbortError') {
                return;
            }

            this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.isGenerating = false;
            this.config.abortControllerRef.current = null;
        }
    }

    /**
     * Abort the current generation
     */
    abort(): void {
        if (this.config.abortControllerRef.current) {
            this.config.abortControllerRef.current.abort();
            this.config.abortControllerRef.current = null;
        }
        this.isGenerating = false;
    }

    /**
     * Check if currently generating
     */
    getIsGenerating(): boolean {
        return this.isGenerating;
    }
}
