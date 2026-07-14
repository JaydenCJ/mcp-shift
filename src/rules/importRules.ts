import ts from 'typescript';
import type { Rule, RuleContext, TextEdit } from '../core/types.js';
import { isSdkSpecifier, lookupImport } from '../mappings/importMap.js';
import {
  notificationSchemaToMethod,
  requestSchemaToMethod,
} from '../mappings/schemaToMethodMap.js';

function quote(original: string, next: string): string {
  const q = original.startsWith("'") ? "'" : '"';
  return `${q}${next}${q}`;
}

function checkSpecifier(ctx: RuleContext, literal: ts.StringLiteralLike): void {
  const spec = literal.text;
  if (!isSdkSpecifier(spec)) return;
  const mapping = lookupImport(spec);
  const start = literal.getStart(ctx.sourceFile);
  const end = literal.getEnd();
  const original = ctx.text.slice(start, end);

  if (mapping?.fixable && mapping.to) {
    ctx.report({
      node: literal,
      message:
        `Import from v1 package '${spec}' — moved to '${mapping.to}' in SDK v2.` +
        (mapping.note ? ` ${mapping.note}` : ''),
      fix: [{ start, end, text: quote(original, mapping.to) }],
    });
  } else if (mapping) {
    ctx.report({
      node: literal,
      message: `Import from removed v1 module '${spec}'. ${mapping.note ?? ''}`.trim(),
    });
  } else {
    ctx.report({
      node: literal,
      message:
        `Import from '${spec}': the monolithic @modelcontextprotocol/sdk package is replaced by the v2 split ` +
        `packages (@modelcontextprotocol/client, /server, /core, plus runtime adapters /node, /express, /hono, ` +
        `/fastify). No mechanical mapping is known for this subpath — migrate manually.`,
    });
  }
}

const MOCK_CALLEES = new Set(['vi.mock', 'jest.mock', 'require']);

/**
 * v2-import-path — rewrites v1 SDK import/require/dynamic-import/mock paths
 * to the v2 split packages; flags removed modules.
 */
export const importPathRule: Rule = {
  meta: {
    id: 'v2-import-path',
    tier: 'v2',
    severity: 'error',
    summary:
      'The monolithic @modelcontextprotocol/sdk is split into @modelcontextprotocol/client|server|core (+ runtime adapters) in v2.',
    fixable: true,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        checkSpecifier(ctx, node.moduleSpecifier);
      } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
        const arg = node.arguments[0];
        if (!arg || !ts.isStringLiteralLike(arg)) {
          node.forEachChild(visit);
          return;
        }
        const calleeText = node.expression.getText(ctx.sourceFile);
        const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        if (isDynamicImport || MOCK_CALLEES.has(calleeText)) {
          checkSpecifier(ctx, arg);
        }
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        checkSpecifier(ctx, node.argument.literal);
      }
      node.forEachChild(visit);
    };
    visit(ctx.sourceFile);
  },
};

function isSchemaName(name: string): boolean {
  return name in requestSchemaToMethod || name in notificationSchemaToMethod;
}

/** Is `name` referenced anywhere outside the given import declaration? */
function isUsedOutsideImport(
  sourceFile: ts.SourceFile,
  importDecl: ts.ImportDeclaration,
  name: string,
): boolean {
  let used = false;
  const visit = (node: ts.Node): void => {
    if (used || node === importDecl) return;
    if (ts.isIdentifier(node) && node.text === name) {
      used = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return used;
}

/**
 * v2-unused-schema-import — once setRequestHandler/setNotificationHandler
 * take method strings (v2-schema-request-handler), the request/notification
 * schema imports they referenced become dead. Remove them so migrated code
 * compiles under `noUnusedLocals`. Runs on the codemod's later passes: the
 * schemas are still referenced until the handler rewrite has been applied.
 */
export const unusedSchemaImportRule: Rule = {
  meta: {
    id: 'v2-unused-schema-import',
    tier: 'v2',
    severity: 'warn',
    summary:
      'Request/notification schema imports left unused by the v2 method-string migration break noUnusedLocals — remove them.',
    fixable: true,
  },
  check(ctx) {
    if (!ctx.text.includes('@modelcontextprotocol')) return;
    const sf = ctx.sourceFile;
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteralLike(stmt.moduleSpecifier)) continue;
      if (!stmt.moduleSpecifier.text.startsWith('@modelcontextprotocol/')) continue;
      const clause = stmt.importClause;
      const named = clause?.namedBindings;
      if (!clause || !named || !ts.isNamedImports(named)) continue;

      const elements = [...named.elements];
      const removable = new Set(
        elements.filter((el) => {
          const importedName = (el.propertyName ?? el.name).text;
          return isSchemaName(importedName) && !isUsedOutsideImport(sf, stmt, el.name.text);
        }),
      );
      if (removable.size === 0) continue;
      const names = [...removable].map((el) => (el.propertyName ?? el.name).text);

      const fix: TextEdit[] = [];
      if (removable.size === elements.length) {
        if (!clause.name) {
          // The whole declaration is dead.
          let end = stmt.getEnd();
          if (ctx.text[end] === '\r') end += 1;
          if (ctx.text[end] === '\n') end += 1;
          fix.push({ start: stmt.getStart(sf), end, text: '' });
        } else {
          // `import Default, { Dead } from ...` → `import Default from ...`
          fix.push({ start: clause.name.getEnd(), end: named.getEnd(), text: '' });
        }
      } else {
        // Remove maximal runs of dead specifiers, keeping separators intact.
        let i = 0;
        while (i < elements.length) {
          if (!removable.has(elements[i]!)) {
            i += 1;
            continue;
          }
          let j = i;
          while (j + 1 < elements.length && removable.has(elements[j + 1]!)) j += 1;
          if (j === elements.length - 1) {
            // Trailing run: cut from the end of the previous kept element.
            fix.push({ start: elements[i - 1]!.getEnd(), end: elements[j]!.getEnd(), text: '' });
          } else {
            fix.push({
              start: elements[i]!.getStart(sf),
              end: elements[j + 1]!.getStart(sf),
              text: '',
            });
          }
          i = j + 1;
        }
      }

      ctx.report({
        node: [...removable][0]!,
        message:
          `Unused schema import${names.length > 1 ? 's' : ''} ${names.map((n) => `'${n}'`).join(', ')} — ` +
          `v2 setRequestHandler/setNotificationHandler take method strings, so the schema import is dead ` +
          `(breaks noUnusedLocals).`,
        fix,
      });
    }
  },
};
