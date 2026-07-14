import ts from 'typescript';
import type { Rule } from '../core/types.js';
import {
  deprecatedCapabilityApis,
  errorCodeLiterals,
  removedMethods,
  removedTaskIdentifiers,
} from '../mappings/removedMethods.js';

const SDK_HINT = '@modelcontextprotocol';

/** Call-ees whose first string argument is a protocol method name. */
const METHOD_CALLEES = new Set([
  'setRequestHandler',
  'setNotificationHandler',
  'request',
  'send',
  'notify',
  'notification',
  'sendRequest',
  'sendNotification',
]);

function methodStringPosition(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  // { method: 'x' }
  if (
    ts.isPropertyAssignment(parent) &&
    ((ts.isIdentifier(parent.name) && parent.name.text === 'method') ||
      (ts.isStringLiteralLike(parent.name) && parent.name.text === 'method'))
  ) {
    return true;
  }
  // callee('x', ...)
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    const callee = parent.expression;
    if (ts.isPropertyAccessExpression(callee) && METHOD_CALLEES.has(callee.name.text)) return true;
    if (ts.isIdentifier(callee) && METHOD_CALLEES.has(callee.text)) return true;
  }
  return false;
}

/**
 * 2026-removed-method — protocol methods removed or replaced by the
 * 2026-07-28 revision (initialize, ping, logging/setLevel, resources/subscribe, ...).
 */
export const removedMethodRule: Rule = {
  meta: {
    id: '2026-removed-method',
    tier: '2026',
    severity: 'error',
    summary:
      '2026-07-28 removes initialize/ping/logging-setLevel/resources-subscribe and friends (SEP-2567/2575/2322/2663).',
    fixable: false,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node)) {
        const info = removedMethods[node.text];
        if (info && methodStringPosition(node)) {
          ctx.report({ node, message: info.message, severity: info.severity });
        }
      }
      node.forEachChild(visit);
    };
    visit(ctx.sourceFile);
  },
};

/**
 * 2026-session-usage — protocol sessions and Mcp-Session-Id are removed
 * (SEP-2567); cross-call state moves to explicit handles / requestState.
 */
export const sessionUsageRule: Rule = {
  meta: {
    id: '2026-session-usage',
    tier: '2026',
    severity: 'warn',
    summary:
      'Protocol sessions are removed in 2026-07-28 (SEP-2567): no Mcp-Session-Id, no per-connection list state.',
    fixable: false,
  },
  check(ctx) {
    const sf = ctx.sourceFile;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'sessionId') {
        const recv = node.expression.getText(sf);
        if (recv === 'ctx' || recv === 'extra' || recv === 'transport') {
          ctx.report({
            node,
            message:
              `'${recv}.sessionId' is 2025-era only: 2026-07-28 removes protocol sessions (SEP-2567). ` +
              'Move cross-call state to server-minted handles passed as tool arguments, or seal mid-request ' +
              'state into requestState (createRequestStateCodec + ctx.mcpReq.requestState<T>()).',
          });
        }
      }
      if (
        (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'sessionIdGenerator'
      ) {
        ctx.report({
          node: node.name,
          message:
            "'sessionIdGenerator' configures 2025-era sessions. A 2026-only server MUST NOT mint or echo " +
            'session IDs (SEP-2567) — host with createMcpHandler(factory) and adopt stateless handles instead.',
        });
      }
      if (ts.isStringLiteralLike(node) && /^mcp-session-id$/i.test(node.text)) {
        ctx.report({
          node,
          message:
            "The 'Mcp-Session-Id' header is removed from Streamable HTTP in 2026-07-28 (SEP-2567); " +
            'a 2026-only server ignores it and answers DELETE with 405.',
        });
      }
      node.forEachChild(visit);
    };
    visit(sf);
  },
};

/**
 * 2026-deprecated-capability — sampling/roots/logging convenience APIs are
 * deprecated (SEP-2577/2596) and degrade or throw on 2026-era requests.
 */
export const deprecatedCapabilityRule: Rule = {
  meta: {
    id: '2026-deprecated-capability',
    tier: '2026',
    severity: 'warn',
    summary:
      'Sampling, roots and logging are deprecated in 2026-07-28 (SEP-2577/2596); server→client requests become MRTR input_required results.',
    fixable: false,
  },
  check(ctx) {
    if (!ctx.text.includes(SDK_HINT)) return;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        Object.prototype.hasOwnProperty.call(deprecatedCapabilityApis, node.expression.name.text)
      ) {
        ctx.report({
          node: node.expression.name,
          message: deprecatedCapabilityApis[node.expression.name.text]!,
        });
      }
      node.forEachChild(visit);
    };
    visit(ctx.sourceFile);
  },
};

/**
 * 2026-error-code-literal — renumbered error codes: -32002→-32602 (resource
 * not found), draft-era -32001/-32003/-32004 → -32020/-32021/-32022.
 */
export const errorCodeLiteralRule: Rule = {
  meta: {
    id: '2026-error-code-literal',
    tier: '2026',
    severity: 'warn',
    summary:
      '2026-07-28 reserves -32020..-32099 for the spec and renumbers draft-era codes; resource-not-found moves to -32602.',
    fixable: false,
  },
  check(ctx) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isPrefixUnaryExpression(node) &&
        node.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(node.operand)
      ) {
        const value = -Number(node.operand.text);
        const message = errorCodeLiterals[value];
        if (message) {
          ctx.report({ node, message });
        }
      }
      node.forEachChild(visit);
    };
    visit(ctx.sourceFile);
  },
};

/**
 * v2-tasks-removed — the experimental tasks SDK surface is removed
 * (SEP-2663); tasks move to the io.modelcontextprotocol/tasks extension.
 */
export const tasksRemovedRule: Rule = {
  meta: {
    id: 'v2-tasks-removed',
    tier: 'v2',
    severity: 'error',
    summary:
      'The experimental tasks surface (taskStore, callToolStream, registerToolTask, ...) is removed in SDK v2 (SEP-2663).',
    fixable: false,
  },
  check(ctx) {
    if (!ctx.text.includes(SDK_HINT)) return;
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && removedTaskIdentifiers.has(node.text)) {
        ctx.report({
          node,
          message:
            `'${node.text}' belongs to the experimental tasks surface removed by SEP-2663. Tasks are now the ` +
            "official extension 'io.modelcontextprotocol/tasks' (polling tasks/get + tasks/update; tasks/list is gone).",
        });
      }
      node.forEachChild(visit);
    };
    visit(ctx.sourceFile);
  },
};

/**
 * 2026-result-type-read — `resultType` is a wire-only discriminator consumed
 * by the SDK; application code should not read it.
 */
export const resultTypeReadRule: Rule = {
  meta: {
    id: '2026-result-type-read',
    tier: '2026',
    severity: 'warn',
    summary: "All 2026-07-28 results carry resultType ('complete' | 'input_required'), but SDKs consume it — don't read it.",
    fixable: false,
  },
  check(ctx) {
    if (!ctx.text.includes(SDK_HINT)) return;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'resultType') {
        ctx.report({
          node,
          message:
            "Reading '.resultType' from results: the SDK consumes this wire-only member (MRTR retries happen " +
            'inside the SDK). Treat results from pre-2026 servers as complete.',
        });
      }
      node.forEachChild(visit);
    };
    visit(ctx.sourceFile);
  },
};

/**
 * 2026-x-mcp-header-type — the x-mcp-header schema extension only supports
 * primitive types, explicitly excluding `number`.
 */
export const xMcpHeaderTypeRule: Rule = {
  meta: {
    id: '2026-x-mcp-header-type',
    tier: '2026',
    severity: 'error',
    summary:
      "x-mcp-header tool parameters must be primitive and must not be 'number' (SEP-2243); invalid annotations exclude the tool from tools/list.",
    fixable: false,
  },
  check(ctx) {
    if (!ctx.text.includes('x-mcp-header')) return;
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        let hasHeaderAnnotation = false;
        let typeValue: string | undefined;
        let typeNode: ts.Node | undefined;
        for (const prop of node.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = ts.isStringLiteralLike(prop.name)
            ? prop.name.text
            : ts.isIdentifier(prop.name)
              ? prop.name.text
              : undefined;
          if (key === 'x-mcp-header') hasHeaderAnnotation = true;
          if (key === 'type' && ts.isStringLiteralLike(prop.initializer)) {
            typeValue = prop.initializer.text;
            typeNode = prop.initializer;
          }
        }
        if (hasHeaderAnnotation && typeValue && !['string', 'boolean', 'integer'].includes(typeValue)) {
          ctx.report({
            node: typeNode ?? node,
            message:
              `x-mcp-header parameter has type '${typeValue}': only primitive types are supported and 'number' is ` +
              'explicitly excluded (SEP-2243). Clients MUST exclude tools with invalid annotations from tools/list.',
          });
        }
      }
      node.forEachChild(visit);
    };
    visit(ctx.sourceFile);
  },
};
