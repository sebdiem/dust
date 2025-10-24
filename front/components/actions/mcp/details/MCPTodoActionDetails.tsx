import { ActionDocumentTextIcon, ContentMessage } from "@dust-tt/sparkle";

import { ActionDetailsWrapper } from "@app/components/actions/ActionDetailsWrapper";
import type { ToolExecutionDetailsProps } from "@app/components/actions/mcp/details/types";
import { getOutputText } from "@app/lib/actions/mcp_internal_actions/output_schemas";
import { asDisplayName } from "@app/types";

export function MCPTodoActionDetails({
  toolOutput,
  toolParams,
  viewType,
}: ToolExecutionDetailsProps) {
  // Try to extract structured data from output resource
  const todoResource = toolOutput?.find(
    (o) =>
      o.type === "resource" &&
      "resource" in o &&
      o.resource.mimeType === "application/vnd.dust.tool-output.todo-result"
  );

  const structuredData =
    todoResource && "resource" in todoResource
      ? (todoResource.resource as {
          operation?: string;
          todoTitle?: string;
          todoStatus?: string;
          todoDescription?: string;
        })
      : null;

  const todoTitle =
    structuredData?.todoTitle ||
    (toolParams && "title" in toolParams ? (toolParams.title as string) : null);

  const todoStatus =
    structuredData?.todoStatus ||
    (toolParams && "status" in toolParams ? (toolParams.status as string) : null);

  // Build action name based on operation
  const getActionName = () => {
    const operation = structuredData?.operation || "todo";

    switch (operation) {
      case "create_todo":
        return todoTitle ? `Creating todo: ${todoTitle}` : "Creating todo";
      case "update_todo":
        if (todoTitle && todoStatus) {
          return `Marking "${todoTitle}" as ${asDisplayName(todoStatus)}`;
        }
        if (todoStatus) {
          return `Changing todo status to ${asDisplayName(todoStatus)}`;
        }
        if (todoTitle) {
          return `Updating todo: ${todoTitle}`;
        }
        return "Updating todo";
      case "delete_todo":
        return "Deleting todo";
      case "get_todo":
        return "Getting todo details";
      case "list_todos":
        const statusFilter =
          todoStatus && todoStatus !== "all"
            ? ` (${asDisplayName(todoStatus)})`
            : "";
        return `Listing todos${statusFilter}`;
      default:
        return asDisplayName(operation);
    }
  };

  const actionName = getActionName();

  // Extract output text
  const outputText = toolOutput
    ?.map((o) => getOutputText(o))
    .filter(Boolean)
    .join("\n");

  return (
    <ActionDetailsWrapper
      viewType={viewType}
      actionName={actionName}
      visual={ActionDocumentTextIcon}
    >
      {viewType !== "conversation" && (
        <div className="flex flex-col gap-4 pl-6 pt-4">
          {todoTitle && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground dark:text-foreground-night">
                Title
              </span>
              <span className="text-sm text-muted-foreground dark:text-muted-foreground-night">
                {todoTitle}
              </span>
            </div>
          )}

          {"description" in toolParams && toolParams.description && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground dark:text-foreground-night">
                Description
              </span>
              <span className="text-sm text-muted-foreground dark:text-muted-foreground-night">
                {toolParams.description as string}
              </span>
            </div>
          )}

          {"status" in toolParams && toolParams.status && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground dark:text-foreground-night">
                Status
              </span>
              <span className="text-sm text-muted-foreground dark:text-muted-foreground-night">
                {asDisplayName(toolParams.status as string)}
              </span>
            </div>
          )}

          {outputText && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground dark:text-foreground-night">
                Result
              </span>
              <ContentMessage variant="primary" size="lg">
                <span className="text-sm">{outputText}</span>
              </ContentMessage>
            </div>
          )}
        </div>
      )}
    </ActionDetailsWrapper>
  );
}
