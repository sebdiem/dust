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
  // Extract the tool name from params (if available from context)
  const toolName = "title" in toolParams ? "Todo action" : "Todo action";

  // Extract title from params for display
  const todoTitle =
    toolParams && "title" in toolParams
      ? (toolParams.title as string)
      : null;

  // Build action name with title if available
  const actionName = todoTitle
    ? `${asDisplayName(toolName)}: ${todoTitle}`
    : asDisplayName(toolName);

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
