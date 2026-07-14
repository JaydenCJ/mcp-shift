import ts from 'typescript';
import type { Rule, RuleContext, TextEdit } from '../core/types.js';
import {
  notificationSchemaToMethod,
  removedTaskSchemaPattern,
  requestSchemaToMethod,
  specResultSchemas,
} from '../mappings/schemaToMethodMap.js';
import { contextPropertyMap } from '../mappings/contextPropertyMap.js';

const SDK_HINT = '@modelcontextprotocol';

function src(ctx: RuleContext, node: ts.Node): string {
  return ctx.text.slice(node.getStart(ctx.sourceFile), node.getEnd());
}

function isFunctionArg(node: ts.Expression): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isIdentifier(node);
}

function wrapShape(ctx: RuleContext, shape: ts.Expression): string {
  // Already a z.object(...) / schema expression? Pass through.
  if (
    ts.isCallExpression(shape) &&
    ts.isPropertyAccessExpression(shape.expression) &&
    shape.expression.name.text === 'object'
  ) {
    return src(ctx, shape);
  }
  if (ts.isObjectLiteralExpression(shape)) {
    return `z.object(${src(ctx, shape)})`;
  }
  return `z.object(${src(ctx, shape)})`;
}

/**
 * v2-variadic-registration — server.tool()/prompt()/resource() variadic
 * overloads become registerTool()/registerPrompt()/registerResource() with a
 * config object; raw Zod shapes are wrapped in z.object() (Standard Schema).
 */
export const variadicRegistrationRule: Rule = {
  meta: {
    id: 'v2-variadic-registration',
    tier: 'v2',
    severity: 'error',
    summary:
      'McpServer.tool/prompt/resource variadic overloads are replaced by registerTool/registerPrompt/registerResource with a config object.',
    fixable: true,
  },
  check(ctx) {
    if (!ctx.text.includes(SDK_HINT)) return;
    const sf = ctx.sourceFile;

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ['tool', 'prompt', 'resource'].includes(node.expression.name.text) &&
        node.arguments.length >= 2 &&
        isFunctionArg(node.arguments[node.arguments.length - 1]!)
      ) {
        const kind = node.expression.name.text as 'tool' | 'prompt' | 'resource';
        const receiver = src(ctx, node.expression.expression);
        const methodStart = node.expression.name.getStart(sf);
        const args = [...node.arguments];
        const cb = args.pop()!;
        const nameArg = args.shift();
        if (!nameArg) {
          node.forEachChild(visit);
          return;
        }

        if (kind === 'resource') {
          // registerResource(name, uriOrTemplate, metadata, cb) — metadata is REQUIRED in v2.
          if (args.length === 1) {
            const uriArg = args[0]!;
            const text = `${receiver}.registerResource(${src(ctx, nameArg)}, ${src(ctx, uriArg)}, {}, ${src(ctx, cb)})`;
            ctx.report({
              node,
              message:
                "server.resource() becomes registerResource() and requires a metadata argument ('{}' if none).",
              fix: [{ start: node.getStart(sf), end: node.getEnd(), text }],
            });
          } else {
            ctx.report({
              node,
              message:
                'server.resource() becomes registerResource(name, uriOrTemplate, metadata, cb) in v2 ' +
                '(metadata is required). This overload could not be rewritten mechanically — migrate manually.',
            });
          }
          node.forEachChild(visit);
          return;
        }

        // tool/prompt: [desc?], [shape?], [annotations?]
        let desc: ts.Expression | undefined;
        let shape: ts.Expression | undefined;
        let annotations: ts.Expression | undefined;
        for (const a of args) {
          if (ts.isStringLiteralLike(a) && !desc && !shape) desc = a;
          else if (!shape) shape = a;
          else if (!annotations) annotations = a;
        }
        const schemaKey = kind === 'tool' ? 'inputSchema' : 'argsSchema';
        const parts: string[] = [];
        if (desc) parts.push(`description: ${src(ctx, desc)}`);
        if (shape) parts.push(`${schemaKey}: ${wrapShape(ctx, shape)}`);
        if (annotations) parts.push(`annotations: ${src(ctx, annotations)}`);
        const config = parts.length > 0 ? `{ ${parts.join(', ')} }` : '{}';
        const register = kind === 'tool' ? 'registerTool' : 'registerPrompt';
        const text = `${receiver}.${register}(${src(ctx, nameArg)}, ${config}, ${src(ctx, cb)})`;
        ctx.report({
          start: methodStart,
          message:
            `server.${kind}() variadic overload is removed in v2 — use ${register}(name, config, cb). ` +
            (shape && ts.isObjectLiteralExpression(shape)
              ? 'Raw Zod shapes must become z.object({...}) (ensure zod ^4.2.0 is imported as z).'
              : ''),
          fix: [{ start: node.getStart(sf), end: node.getEnd(), text }],
        });
      }
      node.forEachChild(visit);
    };
    visit(sf);
  },
};

/**
 * v2-schema-request-handler — setRequestHandler(XRequestSchema, cb) takes a
 * method string in v2; task schemas are removed outright.
 */
export const schemaRequestHandlerRule: Rule = {
  meta: {
    id: 'v2-schema-request-handler',
    tier: 'v2',
    severity: 'error',
    summary:
      'setRequestHandler/setNotificationHandler take a method string in v2 instead of a Zod schema.',
    fixable: true,
  },
  check(ctx) {
    if (!ctx.text.includes(SDK_HINT)) return;
    const sf = ctx.sourceFile;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === 'setRequestHandler' ||
          node.expression.name.text === 'setNotificationHandler') &&
        node.arguments.length >= 2
      ) {
        const isNotification = node.expression.name.text === 'setNotificationHandler';
        const first = node.arguments[0]!;
        if (ts.isIdentifier(first)) {
          const name = first.text;
          const map = isNotification ? notificationSchemaToMethod : requestSchemaToMethod;
          const method = map[name];
          if (method) {
            ctx.report({
              node: first,
              message: `${node.expression.name.text}(${name}, ...) becomes ${node.expression.name.text}('${method}', ...) in v2.`,
              fix: [{ start: first.getStart(sf), end: first.getEnd(), text: `'${method}'` }],
            });
          } else if (removedTaskSchemaPattern.test(name)) {
            ctx.report({
              node: first,
              message:
                `${name} belongs to the experimental tasks surface removed by SEP-2663; tasks moved to the ` +
                `io.modelcontextprotocol/tasks extension. Remove this registration.`,
            });
          } else if (/(Request|Notification)Schema$/.test(name)) {
            ctx.report({
              node: first,
              message:
                `Unknown schema '${name}': custom methods use the 3-arg form ` +
                `setRequestHandler(method, { params, result? }, handler) in v2 — migrate manually.`,
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  },
};

/**
 * v2-handler-context — handler `extra: RequestHandlerExtra` becomes
 * `ctx: ServerContext`; properties move under ctx.mcpReq / ctx.http.
 */
export const handlerContextRule: Rule = {
  meta: {
    id: 'v2-handler-context',
    tier: 'v2',
    severity: 'error',
    summary:
      'The handler `extra` parameter becomes `ctx` (ServerContext); signal/requestId/sendRequest/... move under ctx.mcpReq, authInfo/requestInfo under ctx.http.',
    fixable: true,
  },
  check(ctx) {
    if (!ctx.text.includes(SDK_HINT)) return;
    const sf = ctx.sourceFile;

    const processFunction = (fn: ts.SignatureDeclaration & { body?: ts.Node }): void => {
      const extraParam = fn.parameters.find(
        (p) => ts.isIdentifier(p.name) && p.name.text === 'extra',
      );
      if (!extraParam) return;
      const paramName = extraParam.name as ts.Identifier;
      ctx.report({
        node: paramName,
        message: "Handler parameter 'extra' becomes 'ctx' (ServerContext) in v2.",
        fix: [{ start: paramName.getStart(sf), end: paramName.getEnd(), text: 'ctx' }],
      });
      if (!fn.body) return;
      const visitBody = (node: ts.Node): void => {
        if (
          ts.isIdentifier(node) &&
          node.text === 'extra' &&
          node !== paramName &&
          !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        ) {
          const parent = node.parent;
          if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
            const prop = parent.name.text;
            const mapping = contextPropertyMap[prop];
            if (mapping?.call && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
              const call = parent.parent;
              ctx.report({
                node: call,
                message: `extra.${prop}() becomes ctx.${mapping.to} in v2.`,
                fix: [{ start: call.getStart(sf), end: call.getEnd(), text: `ctx.${mapping.to}` }],
              });
              return;
            }
            if (mapping && !mapping.call) {
              ctx.report({
                node: parent,
                message:
                  `extra.${prop} becomes ctx.${mapping.to} in v2.` +
                  (mapping.note ? ` ${mapping.note}` : ''),
                fix: [
                  { start: parent.getStart(sf), end: parent.getEnd(), text: `ctx.${mapping.to}` },
                ],
              });
              return;
            }
            // Unknown property: rename the receiver only.
            ctx.report({
              node,
              message: `Handler context renamed: 'extra' becomes 'ctx' — verify the mapping of '.${prop}' manually.`,
              fix: [{ start: node.getStart(sf), end: node.getEnd(), text: 'ctx' }],
            });
            return;
          }
          ctx.report({
            node,
            message: "Handler context renamed: 'extra' becomes 'ctx'.",
            fix: [{ start: node.getStart(sf), end: node.getEnd(), text: 'ctx' }],
          });
        }
        node.forEachChild(visitBody);
      };
      visitBody(fn.body);
    };

    const visit = (node: ts.Node): void => {
      if (
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node)
      ) {
        processFunction(node);
      }
      node.forEachChild(visit);
    };
    visit(sf);
  },
};

/**
 * v2-result-schema-arg — spec-method calls drop the result-schema argument in
 * v2 (resolved via ResultTypeMap). Non-spec schemas must be kept.
 */
export const resultSchemaArgRule: Rule = {
  meta: {
    id: 'v2-result-schema-arg',
    tier: 'v2',
    severity: 'error',
    summary:
      'client.request(req, XResultSchema) / callTool(params, Schema) drop the schema argument for spec methods in v2.',
    fixable: true,
  },
  check(ctx) {
    if (!ctx.text.includes(SDK_HINT)) return;
    const sf = ctx.sourceFile;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ['request', 'callTool', 'sendRequest'].includes(node.expression.name.text) &&
        node.arguments.length === 2
      ) {
        const schemaArg = node.arguments[1]!;
        if (ts.isIdentifier(schemaArg) && specResultSchemas.has(schemaArg.text)) {
          const firstEnd = node.arguments[0]!.getEnd();
          ctx.report({
            node: schemaArg,
            message:
              `Drop '${schemaArg.text}': v2 resolves spec-method result types via ResultTypeMap. ` +
              'Keep schemas only for non-spec methods (a schema-less non-spec call throws TypeError).',
            fix: [{ start: firstEnd, end: schemaArg.getEnd(), text: '' }],
          });
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  },
};

/**
 * v2-completable-order — completable(schema.optional(), cb) becomes
 * completable(schema, cb).optional().
 */
export const completableOrderRule: Rule = {
  meta: {
    id: 'v2-completable-order',
    tier: 'v2',
    severity: 'error',
    summary: 'completable(schema.optional(), cb) becomes completable(schema, cb).optional() in v2.',
    fixable: true,
  },
  check(ctx) {
    if (!ctx.text.includes('completable')) return;
    const sf = ctx.sourceFile;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'completable' &&
        node.arguments.length === 2
      ) {
        const first = node.arguments[0]!;
        if (
          ts.isCallExpression(first) &&
          ts.isPropertyAccessExpression(first.expression) &&
          first.expression.name.text === 'optional' &&
          first.arguments.length === 0
        ) {
          const inner = src(ctx, first.expression.expression);
          const cb = src(ctx, node.arguments[1]!);
          ctx.report({
            node,
            message: 'completable() no longer accepts wrapped optionals — apply .optional() to the completable.',
            fix: [
              {
                start: node.getStart(sf),
                end: node.getEnd(),
                text: `completable(${inner}, ${cb}).optional()`,
              },
            ],
          });
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  },
};
