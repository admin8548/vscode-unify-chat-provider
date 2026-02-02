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
