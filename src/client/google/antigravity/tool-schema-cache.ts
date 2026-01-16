export type SchemaInfo = {
  type: string;
  items?: SchemaInfo;
  properties?: Record<string, SchemaInfo>;
};

const toolSchemaCache = new Map<string, Map<string, SchemaInfo>>();

const sanitizedToOriginalToolName = new Map<string, string>();

export function sanitizeToolNameForGemini(name: string): string {
  const sanitized = /^[0-9]/.test(name) ? `t_${name}` : name;
  if (sanitized !== name) {
    sanitizedToOriginalToolName.set(sanitized, name);
  }
  return sanitized;
}

export function resolveOriginalToolName(name: string): string {
  return sanitizedToOriginalToolName.get(name) ?? name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function extractSchemaInfo(schema: unknown): SchemaInfo {
  const type = isRecord(schema) && typeof schema.type === 'string' ? schema.type : 'unknown';
  const info: SchemaInfo = { type };

  if (type === 'array' && isRecord(schema) && schema.items) {
    info.items = extractSchemaInfo(schema.items);
  } else if (type === 'object' && isRecord(schema) && isRecord(schema.properties)) {
    const properties: Record<string, SchemaInfo> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      properties[key] = extractSchemaInfo(value);
    }
    info.properties = properties;
  }

  return info;
}

export function cacheToolSchemas(tools: unknown[] | undefined): void {
  if (!Array.isArray(tools)) {
    return;
  }

  for (const tool of tools) {
    if (!isRecord(tool)) {
      continue;
    }

    const funcDecls = tool.functionDeclarations;
    if (!Array.isArray(funcDecls)) {
      continue;
    }

    for (const funcDecl of funcDecls) {
      if (!isRecord(funcDecl)) {
        continue;
      }

      const originalName = funcDecl.name;
      if (typeof originalName !== 'string' || originalName.trim() === '') {
        continue;
      }

      const sanitizedName = sanitizeToolNameForGemini(originalName);

      const schemaCandidate =
        funcDecl.parametersJsonSchema ?? funcDecl.parameters ?? undefined;

      if (!isRecord(schemaCandidate)) {
        continue;
      }

      const properties = schemaCandidate.properties;
      if (!isRecord(properties)) {
        continue;
      }

      const paramMap = new Map<string, SchemaInfo>();
      for (const [paramName, paramSchema] of Object.entries(properties)) {
        paramMap.set(paramName, extractSchemaInfo(paramSchema));
      }

      toolSchemaCache.set(sanitizedName, paramMap);
      if (sanitizedName !== originalName) {
        sanitizedToOriginalToolName.set(sanitizedName, originalName);
        toolSchemaCache.set(originalName, paramMap);
      }
    }
  }
}

export function getParamType(toolName: string, paramName: string): string | undefined {
  return toolSchemaCache.get(toolName)?.get(paramName)?.type;
}

export function clearToolSchemaCache(): void {
  toolSchemaCache.clear();
}
