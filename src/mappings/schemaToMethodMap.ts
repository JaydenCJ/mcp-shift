/**
 * v1 `setRequestHandler(XRequestSchema, cb)` took a Zod schema; v2 takes the
 * method string. This map mirrors the official codemod's schemaToMethodMap.
 */
export const requestSchemaToMethod: Record<string, string> = {
  InitializeRequestSchema: 'initialize',
  PingRequestSchema: 'ping',
  ListToolsRequestSchema: 'tools/list',
  CallToolRequestSchema: 'tools/call',
  ListResourcesRequestSchema: 'resources/list',
  ListResourceTemplatesRequestSchema: 'resources/templates/list',
  ReadResourceRequestSchema: 'resources/read',
  SubscribeRequestSchema: 'resources/subscribe',
  UnsubscribeRequestSchema: 'resources/unsubscribe',
  ListPromptsRequestSchema: 'prompts/list',
  GetPromptRequestSchema: 'prompts/get',
  CompleteRequestSchema: 'completion/complete',
  SetLevelRequestSchema: 'logging/setLevel',
  CreateMessageRequestSchema: 'sampling/createMessage',
  ListRootsRequestSchema: 'roots/list',
  ElicitRequestSchema: 'elicitation/create',
};

export const notificationSchemaToMethod: Record<string, string> = {
  InitializedNotificationSchema: 'notifications/initialized',
  ProgressNotificationSchema: 'notifications/progress',
  CancelledNotificationSchema: 'notifications/cancelled',
  RootsListChangedNotificationSchema: 'notifications/roots/list_changed',
  ToolListChangedNotificationSchema: 'notifications/tools/list_changed',
  ResourceListChangedNotificationSchema: 'notifications/resources/list_changed',
  ResourceUpdatedNotificationSchema: 'notifications/resources/updated',
  PromptListChangedNotificationSchema: 'notifications/prompts/list_changed',
  LoggingMessageNotificationSchema: 'notifications/message',
};

/**
 * Spec result schemas whose second-argument form on `client.request(req, X)` /
 * `client.callTool(params, X)` must be dropped in v2 (results are resolved via
 * ResultTypeMap). Non-spec schemas must be KEPT.
 */
export const specResultSchemas = new Set([
  'EmptyResultSchema',
  'InitializeResultSchema',
  'CallToolResultSchema',
  'ListToolsResultSchema',
  'ListResourcesResultSchema',
  'ListResourceTemplatesResultSchema',
  'ReadResourceResultSchema',
  'ListPromptsResultSchema',
  'GetPromptResultSchema',
  'CompleteResultSchema',
  'CreateMessageResultSchema',
  'ElicitResultSchema',
  'ListRootsResultSchema',
]);

/** Experimental tasks schemas removed by SEP-2663 (no mechanical rewrite). */
export const removedTaskSchemaPattern = /^(Get|List|Cancel|Create)?Task[A-Za-z]*Schema$/;
