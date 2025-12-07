export enum FeatureId {
  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/extended-thinking#interleaved-thinking
   */
  AnthropicInterleavedThinking = 'anthropic_interleaved-thinking',
  /**
   * @see https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool
   */
  AnthropicWebSearch = 'anthropic_web-search',
  /**
   * @see https://docs.anthropic.com/en/docs/build-with-claude/tool-use/memory-tool
   */
  AnthropicMemoryTool = 'anthropic_memory-tool',
  /**
   * @see https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool#citations
   */
  AnthropicCitations = 'anthropic_citations',
}

export interface Feature {
  /**
   * Supported model familys, use {@link Array.includes} to check if a family is supported.
   */
  supportedFamilys?: string[];

  /**
   * Supported model IDs, use {@link Array.includes} to check if a model is supported.
   */
  supportedModels?: string[];
}

export const FEATURES: Record<FeatureId, Feature> = {
  [FeatureId.AnthropicInterleavedThinking]: {
    supportedFamilys: [
      'claude-sonnet-4-5',
      'claude-sonnet-4',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-opus-4',
    ],
  },
  [FeatureId.AnthropicWebSearch]: {
    supportedFamilys: [
      'claude-sonnet-4-5',
      'claude-sonnet-4',
      'claude-sonnet-3-7',
      'claude-haiku-4-5',
      'claude-haiku-3-5',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-opus-4',
    ],
  },
  [FeatureId.AnthropicMemoryTool]: {
    supportedFamilys: [
      'claude-sonnet-4-5',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-opus-4',
    ],
  },
  [FeatureId.AnthropicCitations]: {
    supportedFamilys: [
      'claude-sonnet-4-5',
      'claude-sonnet-4',
      'claude-sonnet-3-7',
      'claude-haiku-4-5',
      'claude-haiku-3-5',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-opus-4',
    ],
  },
};

/**
 * Check if a feature is supported by a specific model.
 * @param featureId The feature ID to check
 * @param modelId The model ID (e.g., 'claude-sonnet-4-20250514')
 * @param modelFamily The model family (e.g., 'claude-sonnet-4')
 * @returns true if the feature is supported by the model
 */
export function isFeatureSupported(
  featureId: FeatureId,
  modelId?: string,
  modelFamily?: string,
): boolean {
  const feature = FEATURES[featureId];
  if (!feature) {
    return false;
  }

  // Check if model ID is explicitly supported
  if (modelId && feature.supportedModels?.includes(modelId)) {
    return true;
  }

  // Check if model family is supported
  if (modelFamily && feature.supportedFamilys?.includes(modelFamily)) {
    return true;
  }

  return false;
}
