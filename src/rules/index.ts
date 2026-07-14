import type { PackageJsonRule, Rule } from '../core/types.js';
import { importPathRule, unusedSchemaImportRule } from './importRules.js';
import { renamedSymbolRule } from './symbolRules.js';
import {
  completableOrderRule,
  handlerContextRule,
  resultSchemaArgRule,
  schemaRequestHandlerRule,
  variadicRegistrationRule,
} from './apiRules.js';
import {
  deprecatedCapabilityRule,
  errorCodeLiteralRule,
  removedMethodRule,
  resultTypeReadRule,
  sessionUsageRule,
  tasksRemovedRule,
  xMcpHeaderTypeRule,
} from './protocolRules.js';
import { packageJsonRules } from './packageJsonRules.js';

export const astRules: Rule[] = [
  importPathRule,
  unusedSchemaImportRule,
  renamedSymbolRule,
  variadicRegistrationRule,
  schemaRequestHandlerRule,
  handlerContextRule,
  resultSchemaArgRule,
  completableOrderRule,
  removedMethodRule,
  sessionUsageRule,
  deprecatedCapabilityRule,
  errorCodeLiteralRule,
  tasksRemovedRule,
  resultTypeReadRule,
  xMcpHeaderTypeRule,
];

export { packageJsonRules };

export const allRuleMetas = [...astRules, ...packageJsonRules].map((r) => r.meta);
