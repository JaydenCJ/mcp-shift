import ts from 'typescript';
import type { Rule, TextEdit } from '../core/types.js';
import { symbolMap } from '../mappings/symbolMap.js';

const SDK_HINT = '@modelcontextprotocol';

function removeImportSpecifierEdit(
  sf: ts.SourceFile,
  text: string,
  spec: ts.ImportSpecifier,
): TextEdit {
  const bindings = spec.parent; // NamedImports
  const elements = bindings.elements;
  const index = elements.indexOf(spec);
  let start = spec.getStart(sf);
  let end = spec.getEnd();
  if (elements.length === 1) {
    // Sole specifier: leave an empty brace pair; a cleanup pass or formatter can drop the import.
    return { start, end, text: '' };
  }
  if (index < elements.length - 1) {
    // Consume up to the start of the next element (covers comma + whitespace).
    const next = elements[index + 1]!;
    end = next.getStart(sf);
  } else {
    // Last element: consume the preceding comma.
    const prev = elements[index - 1]!;
    start = prev.getEnd();
  }
  return { start, end, text: '' };
}

/**
 * v2-renamed-symbol — renames v1 SDK symbols to their v2 names
 * (McpError→ProtocolError, StreamableHTTPError→SdkHttpError, ...).
 */
export const renamedSymbolRule: Rule = {
  meta: {
    id: 'v2-renamed-symbol',
    tier: 'v2',
    severity: 'error',
    summary: 'SDK v2 renames error classes, JSON-RPC types, transports and handler context types.',
    fixable: true,
  },
  check(ctx) {
    if (!ctx.text.includes(SDK_HINT)) return;
    const sf = ctx.sourceFile;

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const name = node.text;
        const mapping = symbolMap[name];
        if (mapping) {
          const parent = node.parent;
          // Skip the `name` side of property accesses (obj.McpError — namespace access needs manual review).
          if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
            if (parent.expression !== node) {
              ctx.report({
                node,
                message:
                  `Namespace access to renamed symbol '${name}' (now '${mapping.to}') — rewrite manually.`,
              });
              node.forEachChild(visit);
              return;
            }
          }
          // Special case: ErrorCode.RequestTimeout / ErrorCode.ConnectionClosed → SdkErrorCode.*
          if (
            name === 'ErrorCode' &&
            ts.isPropertyAccessExpression(parent) &&
            parent.expression === node &&
            (parent.name.text === 'RequestTimeout' || parent.name.text === 'ConnectionClosed')
          ) {
            ctx.report({
              node: parent,
              message:
                `ErrorCode.${parent.name.text} is an SDK-level condition in v2: use SdkErrorCode.${parent.name.text} ` +
                `(string code) with instanceof SdkError guards. Import SdkErrorCode from @modelcontextprotocol/core.`,
              fix: [
                {
                  start: parent.getStart(sf),
                  end: parent.getEnd(),
                  text: `SdkErrorCode.${parent.name.text}`,
                },
              ],
            });
            return; // do not also emit the generic ErrorCode rename for this occurrence
          }
          if (mapping.global && ts.isImportSpecifier(parent)) {
            ctx.report({
              node,
              message: `'${name}' becomes the global '${mapping.to}' in v2 — drop the import.`,
              fix: [removeImportSpecifierEdit(sf, ctx.text, parent)],
            });
          } else {
            // Type references with type arguments (RequestHandlerExtra<A, B>) lose their arguments.
            if (
              ts.isTypeReferenceNode(parent) &&
              parent.typeName === node &&
              parent.typeArguments &&
              parent.typeArguments.length > 0
            ) {
              ctx.report({
                node: parent,
                message:
                  `'${name}' is renamed to '${mapping.to}' in SDK v2 and no longer takes type parameters.` +
                  (mapping.note ? ` ${mapping.note}` : ''),
                fix: [{ start: parent.getStart(sf), end: parent.getEnd(), text: mapping.to }],
              });
            } else {
              ctx.report({
                node,
                message:
                  `'${name}' is renamed to '${mapping.to}' in SDK v2.` +
                  (mapping.note ? ` ${mapping.note}` : ''),
                fix: [{ start: node.getStart(sf), end: node.getEnd(), text: mapping.to }],
              });
            }
          }
        }
      }
      // Constructor-argument review for StreamableHTTPError → SdkHttpError.
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'StreamableHTTPError'
      ) {
        ctx.report({
          node,
          severity: 'warn',
          message:
            'Constructor signature changed: new SdkHttpError(SdkErrorCode.X, message, { status, statusText }). ' +
            'Review this call site after the rename.',
        });
      }
      node.forEachChild(visit);
    };
    visit(sf);
  },
};
