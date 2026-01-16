export type AntigravityModelFamily = 'claude' | 'gemini-flash' | 'gemini-pro';

export type TransformContext = {
  model: string;
  family: AntigravityModelFamily;
  projectId: string;
  streaming: boolean;
  requestId: string;
  sessionId: string;
};

export type TransformResult = {
  body: string;
  debugInfo?: {
    transformer: 'gemini' | 'claude';
    toolCount?: number;
    toolsTransformed?: boolean;
  };
};

export type RequestPayload = Record<string, unknown>;
