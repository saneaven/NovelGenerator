import Handlebars from 'handlebars';
import type { PromptData, PromptType } from './schema';
import { validateVariablesAgainstSchema } from './validator';

// Create a new Handlebars instance to avoid polluting global helpers
const handlebars = Handlebars.create();

// ============================================================================
// CUSTOM HELPERS
// ============================================================================

// filterByType(array, type) - Filter objects by type field
handlebars.registerHelper('filterByType', (arr: any[] | undefined, type: string) => {
  if (!arr || !Array.isArray(arr)) return [];
  return arr.filter(obj => obj?.type === type);
});

// filterByIds(array, ids, idField = 'id') - Filter by ID array
handlebars.registerHelper('filterByIds', (arr: any[] | undefined, ids: string | string[] | undefined, idField?: string) => {
  if (!arr || !Array.isArray(arr)) return [];
  if (!ids) return [];
  const field = typeof idField === 'string' ? idField : 'id';
  const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
  return arr.filter(obj => idSet.has(obj?.[field]));
});

// getById(array, id, idField = 'id') - Get single object by ID
handlebars.registerHelper('getById', (arr: any[] | undefined, id: string | undefined, idField?: string) => {
  if (!arr || !Array.isArray(arr) || !id) return undefined;
  const field = typeof idField === 'string' ? idField : 'id';
  return arr.find(obj => obj?.[field] === id);
});

// getManuscript(manuscripts, chapterId) - Shorthand for manuscript lookup
handlebars.registerHelper('getManuscript', (manuscripts: any[] | undefined, chapterId: string | undefined) => {
  if (!manuscripts || !Array.isArray(manuscripts) || !chapterId) return undefined;
  return manuscripts.find(m => m?.chapterId === chapterId);
});

// getObjectsOfLanguage(project, language, ids?) - Get objects for any language
handlebars.registerHelper('getObjectsOfLanguage', (project: any, language: string | undefined, ids?: string | string[]) => {
  if (!project || !language) return [];
  const langObjects = project?.languages?.[language]?.objects || [];
  if (!ids) return langObjects;
  const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
  return langObjects.filter((obj: any) => idSet.has(obj?.id));
});

// getManuscriptsOfLanguage(project, language, ids?) - Get manuscripts for any language
handlebars.registerHelper('getManuscriptsOfLanguage', (project: any, language: string | undefined, ids?: string | string[]) => {
  if (!project || !language) return [];
  const langManuscripts = project?.languages?.[language]?.manuscripts || [];
  if (!ids) return langManuscripts;
  const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
  return langManuscripts.filter((ms: any) => idSet.has(ms?.id));
});

// count(array) - Count array items
handlebars.registerHelper('count', (arr: any[] | undefined) => {
  if (!arr || !Array.isArray(arr)) return 0;
  return arr.length;
});

// hasItems(array) - Check if array has items
handlebars.registerHelper('hasItems', (arr: any[] | undefined) => {
  return arr && Array.isArray(arr) && arr.length > 0;
});

// eq(a, b) - Equality comparison
handlebars.registerHelper('eq', (a: any, b: any) => a === b);

// neq(a, b) - Not equal comparison
handlebars.registerHelper('neq', (a: any, b: any) => a !== b);

// and(a, b) - Logical AND
handlebars.registerHelper('and', (a: any, b: any) => a && b);

// or(a, b) - Logical OR
handlebars.registerHelper('or', (a: any, b: any) => a || b);

// not(a) - Logical NOT
handlebars.registerHelper('not', (a: any) => !a);

// json(obj) - Convert to JSON string (useful for debugging)
handlebars.registerHelper('json', (obj: any) => JSON.stringify(obj, null, 2));

// array(item) - Wrap single item in array (useful for filterByIds with single object)
handlebars.registerHelper('array', (item: any) => item ? [item] : []);

// includes(array, value) - Check if array includes value
handlebars.registerHelper('includes', (arr: any[] | undefined, value: any) => {
  if (!arr || !Array.isArray(arr)) return false;
  return arr.includes(value);
});

// ============================================================================
// FRAGMENT SYSTEM
// ============================================================================

/**
 * Fragment interface for the registry
 */
export interface PromptFragment {
  id: string;
  folderPath: string | null;
  fragmentName: string;
  content: string;
  description: string | null;
  isSystemDefault: boolean;
}

/**
 * Fragment registry - stores fragment content keyed by path
 */
let fragmentRegistry: Map<string, string> = new Map();

/**
 * Register fragments for use in templates.
 * Call this before rendering templates that use {{prompt ...}}.
 * @param fragments Array of fragments to register
 */
export function registerFragments(fragments: PromptFragment[]): void {
  fragmentRegistry.clear();
  for (const fragment of fragments) {
    const path = fragment.folderPath
      ? `${fragment.folderPath}/${fragment.fragmentName}`
      : fragment.fragmentName;
    fragmentRegistry.set(path, fragment.content);
  }
}

/**
 * Clear all registered fragments
 */
export function clearFragments(): void {
  fragmentRegistry.clear();
}

/**
 * Get the current fragment registry (for validation)
 */
export function getFragmentRegistry(): Map<string, string> {
  return new Map(fragmentRegistry);
}

// prompt("path/to/fragment", ...args) - Include a fragment with optional parameters
// Usage: {{prompt "common/projectContext/full"}}
// Usage: {{prompt "common/projectContext/filtered" editAssistant.manuscript.objectIds}}
// Usage: {{prompt "common/format" title="Hello" items=someArray}}
handlebars.registerHelper('prompt', function (this: any, ...args: any[]) {
  // Last argument is always the Handlebars options object
  const options = args.pop() as Handlebars.HelperOptions;
  const path = args[0] as string | undefined;
  const positionalParams = args.slice(1);

  if (!path || typeof path !== 'string') {
    return new Handlebars.SafeString(`[Fragment Error: Missing path]`);
  }

  const fragmentContent = fragmentRegistry.get(path);
  if (!fragmentContent) {
    console.log('[Template Debug] Fragment not found! Available fragments:', [...fragmentRegistry.keys()]);
    return new Handlebars.SafeString(`[Fragment Error: Not found - ${path}]`);
  }

  // Check for circular reference (simple depth check)
  const depth = ((this as any).__fragmentDepth || 0) + 1;
  if (depth > 10) {
    return new Handlebars.SafeString(`[Fragment Error: Max depth exceeded (${depth}) - possible circular reference at ${path}]`);
  }

  // Build context for fragment rendering
  // - Inherit parent context (this)
  // - Add positional params as 'params' array
  // - Add named params (hash) as top-level properties
  const fragmentContext: Record<string, any> = {
    ...this,
    params: positionalParams,
    ...options.hash,
    __fragmentDepth: depth,
  };

  try {
    const compiled = handlebars.compile(fragmentContent, { noEscape: true });
    return new Handlebars.SafeString(compiled(fragmentContext));
  } catch (error) {
    return new Handlebars.SafeString(`[Fragment Error: ${error instanceof Error ? error.message : String(error)}]`);
  }
});

// ============================================================================
// TYPES
// ============================================================================

/**
 * Interface for variable reference with location information
 */
export interface VariableReference {
  path: string[];  // e.g., ['config', 'mainLanguage']
  fullPath: string;  // e.g., 'config.mainLanguage'
  location?: {
    row: number;
    col: number;
  };
}

/**
 * Enhanced validation result with warnings
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
  warnings?: Array<{
    message: string;
    line?: number;
    column?: number;
    severity: 'warning';
  }>;
}

// ============================================================================
// TEMPLATE RENDERING
// ============================================================================

/**
 * Renders a template string with the provided data.
 * @param template The Handlebars template string
 * @param data The data object containing variable groups
 * @returns The rendered string
 */
export const renderTemplate = (template: string, data: PromptData | Record<string, any>): string => {
  try {
    const compiled = handlebars.compile(template, { noEscape: true });
    return compiled(data);
  } catch (error) {
    console.error("Template rendering error:", error);
    // In case of error, return a formatted error string to make it visible in the UI
    return `[Template Error: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

// ============================================================================
// VARIABLE EXTRACTION (AST PARSING)
// ============================================================================

/**
 * Recursively extracts variable paths from Handlebars AST nodes
 */
function extractPathsFromNode(node: hbs.AST.Node, results: VariableReference[], localVars: Set<string>): void {
  if (!node) return;

  switch (node.type) {
    case 'Program': {
      const program = node as hbs.AST.Program;
      for (const statement of program.body) {
        extractPathsFromNode(statement, results, localVars);
      }
      break;
    }

    case 'MustacheStatement':
    case 'SubExpression': {
      const mustache = node as hbs.AST.MustacheStatement | hbs.AST.SubExpression;
      extractPathsFromExpression(mustache.path, results, localVars, mustache.loc);
      for (const param of mustache.params) {
        extractPathsFromNode(param, results, localVars);
      }
      if (mustache.hash) {
        for (const pair of mustache.hash.pairs) {
          extractPathsFromNode(pair.value, results, localVars);
        }
      }
      break;
    }

    case 'BlockStatement': {
      const block = node as hbs.AST.BlockStatement;
      extractPathsFromExpression(block.path, results, localVars, block.loc);
      for (const param of block.params) {
        extractPathsFromNode(param, results, localVars);
      }
      if (block.hash) {
        for (const pair of block.hash.pairs) {
          extractPathsFromNode(pair.value, results, localVars);
        }
      }

      // Handle #each - introduces local variable
      const helperName = (block.path as hbs.AST.PathExpression).original;
      if (helperName === 'each') {
        const newLocalVars = new Set(localVars);
        // In #each, 'this' and block params become local
        if (block.program.blockParams && block.program.blockParams.length > 0) {
          for (const param of block.program.blockParams) {
            newLocalVars.add(param);
          }
        }
        extractPathsFromNode(block.program, results, newLocalVars);
        if (block.inverse) {
          extractPathsFromNode(block.inverse, results, localVars);
        }
      } else if (helperName === 'with') {
        // #with also introduces context change
        const newLocalVars = new Set(localVars);
        if (block.program.blockParams && block.program.blockParams.length > 0) {
          for (const param of block.program.blockParams) {
            newLocalVars.add(param);
          }
        }
        extractPathsFromNode(block.program, results, newLocalVars);
        if (block.inverse) {
          extractPathsFromNode(block.inverse, results, localVars);
        }
      } else if (helperName === 'let') {
        // #let introduces local variables via hash
        const newLocalVars = new Set(localVars);
        if (block.hash) {
          for (const pair of block.hash.pairs) {
            newLocalVars.add(pair.key);
          }
        }
        extractPathsFromNode(block.program, results, newLocalVars);
        if (block.inverse) {
          extractPathsFromNode(block.inverse, results, localVars);
        }
      } else {
        // Other block helpers
        extractPathsFromNode(block.program, results, localVars);
        if (block.inverse) {
          extractPathsFromNode(block.inverse, results, localVars);
        }
      }
      break;
    }

    case 'PathExpression': {
      const pathExpr = node as hbs.AST.PathExpression;
      extractPathsFromExpression(pathExpr, results, localVars, pathExpr.loc);
      break;
    }

    case 'ContentStatement':
    case 'CommentStatement':
      // No variables in content or comments
      break;

    default:
      // Handle any other node types with children
      const anyNode = node as any;
      if (anyNode.body) {
        for (const child of anyNode.body) {
          extractPathsFromNode(child, results, localVars);
        }
      }
      if (anyNode.program) {
        extractPathsFromNode(anyNode.program, results, localVars);
      }
      if (anyNode.inverse) {
        extractPathsFromNode(anyNode.inverse, results, localVars);
      }
      break;
  }
}

/**
 * Extracts variable path from a path expression if it's a global variable
 */
function extractPathsFromExpression(
  expr: hbs.AST.Expression,
  results: VariableReference[],
  localVars: Set<string>,
  loc?: hbs.AST.SourceLocation
): void {
  if (expr.type !== 'PathExpression') return;

  const pathExpr = expr as hbs.AST.PathExpression;
  const parts = pathExpr.parts;

  if (parts.length === 0) return;

  // Skip if it's a helper (determined by context)
  // Helpers are typically all-lowercase single words like 'if', 'each', 'unless'
  // Our custom helpers: filterByType, filterByIds, getById, etc.
  const builtinHelpers = new Set([
    'if', 'unless', 'each', 'with', 'lookup', 'log',
    'filterByType', 'filterByIds', 'getById', 'getManuscript',
    'getObjectsOfLanguage', 'count', 'hasItems', 'eq', 'neq',
    'and', 'or', 'not', 'json', 'array', 'includes',
    'prompt'  // Fragment inclusion helper
  ]);

  const firstPart = String(parts[0]);

  // Skip helpers
  if (builtinHelpers.has(firstPart)) return;

  // Skip 'this' references (used inside #each) and parent context references (../)
  // Note: Handlebars parses 'this.foo' as parts=['foo'] but original='this.foo'
  // Similarly, '../name' has parts=['name'] but original='../name'
  const original = pathExpr.original;
  if (original === 'this' || original.startsWith('this.') || original.startsWith('../') || pathExpr.data) return;

  // Skip local variables
  if (localVars.has(firstPart)) return;

  // This is a global variable reference
  const stringParts = parts.map(p => String(p));
  results.push({
    path: stringParts,
    fullPath: stringParts.join('.'),
    location: loc ? {
      row: loc.start.line,
      col: loc.start.column
    } : undefined
  });
}

/**
 * Extracts all GLOBAL variable references from a template.
 * Uses Handlebars AST parsing to find global variable uses.
 * Automatically excludes local variables from #each, #with, and #let blocks.
 * @param template The template string to analyze
 * @returns Array of variable references with paths and locations
 */
export const extractVariableReferences = async (template: string): Promise<VariableReference[]> => {
  try {
    const ast = Handlebars.parse(template);
    const results: VariableReference[] = [];
    const localVars = new Set<string>();

    extractPathsFromNode(ast, results, localVars);

    // Remove duplicates based on fullPath
    const uniqueRefs = results.filter((ref, index, self) =>
      index === self.findIndex(r => r.fullPath === ref.fullPath)
    );

    return uniqueRefs;
  } catch (error) {
    // If parsing fails, return empty array (syntax errors will be caught by validateTemplate)
    return [];
  }
};

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates a template string syntax and optionally checks variables against schema.
 * @param template The template string to validate
 * @param schemaType Optional schema type for variable validation
 * @returns Object containing validity, error message, and warnings
 */
export const validateTemplate = async (
  template: string,
  schemaType?: PromptType
): Promise<ValidationResult> => {
  // Step 1: Validate syntax
  try {
    Handlebars.parse(template);
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : String(error),
      warnings: []
    };
  }

  // Step 2: Validate variables if schema type is provided
  const warnings: Array<{
    message: string;
    line?: number;
    column?: number;
    severity: 'warning';
  }> = [];

  if (schemaType) {
    try {
      const references = await extractVariableReferences(template);
      const variableWarnings = validateVariablesAgainstSchema(references, schemaType);
      warnings.push(...variableWarnings);
    } catch (error) {
      // If variable validation fails, log it but don't fail the whole validation
      console.warn('Variable validation failed:', error);
    }
  }

  return {
    isValid: true,
    warnings
  };
};

// ============================================================================
// FRAGMENT VALIDATION
// ============================================================================

/**
 * Result of fragment reference validation
 */
export interface FragmentValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  referencedFragments: string[];
}

/**
 * Extract all fragment references from a template
 * @param template The template content to analyze
 * @returns Array of fragment paths referenced via {{prompt ...}}
 */
export function extractFragmentReferences(template: string): string[] {
  // First, remove Handlebars comments to avoid matching prompt references inside comments
  const withoutComments = template.replace(/\{\{!--[\s\S]*?--\}\}/g, '');

  const regex = /\{\{\s*prompt\s+"([^"]+)"/g;
  const refs: string[] = [];
  let match;
  while ((match = regex.exec(withoutComments)) !== null) {
    refs.push(match[1]);
  }
  return [...new Set(refs)]; // Remove duplicates
}

/**
 * Validate fragment references in content.
 * Checks if referenced fragments exist and detects circular references.
 * @param content The content to validate
 * @param currentPath Optional path of current fragment (for self-reference detection)
 * @returns Validation result with errors, warnings, and referenced fragments
 */
export function validateFragmentReferences(
  content: string,
  currentPath?: string
): FragmentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const referencedFragments = extractFragmentReferences(content);

  // Check if referenced fragments exist
  for (const ref of referencedFragments) {
    if (!fragmentRegistry.has(ref)) {
      warnings.push(`Referenced fragment not found: "${ref}"`);
    }
  }

  // Check for self-reference
  if (currentPath && referencedFragments.includes(currentPath)) {
    errors.push(`Self-reference detected: fragment "${currentPath}" references itself`);
  }

  // Detect circular references using DFS
  if (currentPath) {
    const circularPath = detectCircularReferences(currentPath, new Set());
    if (circularPath) {
      errors.push(`Circular reference detected: ${circularPath.join(' -> ')}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    referencedFragments
  };
}

/**
 * Detect circular references in fragment dependencies
 * @param startPath The fragment path to start from
 * @param visited Set of already visited paths
 * @param path Current path for error message
 * @returns Array representing the circular path, or null if no cycle
 */
function detectCircularReferences(
  startPath: string,
  visited: Set<string>,
  path: string[] = []
): string[] | null {
  if (visited.has(startPath)) {
    return [...path, startPath];
  }

  const content = fragmentRegistry.get(startPath);
  if (!content) {
    return null; // Fragment doesn't exist, no cycle possible
  }

  visited.add(startPath);
  path.push(startPath);

  const refs = extractFragmentReferences(content);
  for (const ref of refs) {
    const cycle = detectCircularReferences(ref, new Set(visited), [...path]);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

export default handlebars;
