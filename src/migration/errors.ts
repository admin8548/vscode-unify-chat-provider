export class ClaudeCodeOAuthDetectedError extends Error {
  constructor(public readonly email?: string) {
    super(
      email
        ? `Claude Code OAuth detected for ${email}. Please re-authenticate.`
        : 'Claude Code OAuth detected. Please re-authenticate.',
    );
    this.name = 'ClaudeCodeOAuthDetectedError';
  }
}

export class CodexOAuthDetectedError extends Error {
  constructor() {
    super('Codex OAuth detected. Please re-authenticate via ChatGPT.');
    this.name = 'CodexOAuthDetectedError';
  }
}

export class GeminiCliOAuthDetectedError extends Error {
  constructor() {
    super('Gemini CLI OAuth detected. Please re-authenticate.');
    this.name = 'GeminiCliOAuthDetectedError';
  }
}
