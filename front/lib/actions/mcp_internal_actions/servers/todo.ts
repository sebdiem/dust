import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MCPError } from "@app/lib/actions/mcp_errors";
import { makeInternalMCPServer } from "@app/lib/actions/mcp_internal_actions/utils";
import { withToolLogging } from "@app/lib/actions/mcp_internal_actions/wrappers";
import type { AgentLoopContextType } from "@app/lib/actions/types";
import type { Authenticator } from "@app/lib/auth";
import { Err, normalizeError, Ok } from "@app/types";

// Todo status enum
const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;
type TodoStatus = (typeof TODO_STATUSES)[number];

const TODO_STATUS_EMOJIS: Record<TodoStatus, string> = {
  pending: "⏳",
  in_progress: "🔄",
  completed: "✅",
};

// In-memory storage for todos (per user session)
// In a real implementation, this would be persisted to a database
const todoStore = new Map<
  string,
  Array<{
    id: string;
    title: string;
    description?: string;
    status: TodoStatus;
    createdAt: number;
    updatedAt: number;
  }>
>();

function getUserId(auth: Authenticator): string {
  const user = auth.user();
  return user?.id ? user.id.toString() : "anonymous";
}

function createServer(
  auth: Authenticator,
  agentLoopContext?: AgentLoopContextType
): McpServer {
  const server = makeInternalMCPServer("todo");

  server.tool(
    "create_todo",
    "Create a new todo item with a title and optional description.",
    {
      title: z.string().min(1).max(500).describe("The title of the todo item."),
      description: z
        .string()
        .max(2000)
        .optional()
        .describe("Optional detailed description of the todo item."),
      status: z
        .enum(TODO_STATUSES)
        .optional()
        .default("pending")
        .describe("Initial status of the todo item. Defaults to 'pending'."),
    },
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_create_todo",
        agentLoopContext,
      },
      async ({ title, description, status = "pending" }) => {
        try {
          const userId = getUserId(auth);
          const userTodos = todoStore.get(userId) || [];

          const newTodo = {
            id: `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            title,
            description,
            status,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          userTodos.push(newTodo);
          todoStore.set(userId, userTodos);

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: `todo://${newTodo.id}`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: "Todo created successfully!",
                operation: "create_todo",
                todoId: newTodo.id,
                todoTitle: newTodo.title,
                todoStatus: newTodo.status,
                todoDescription: newTodo.description,
              },
            },
          ]);
        } catch (e) {
          const cause = normalizeError(e);
          return new Err(
            new MCPError(`Error creating todo: ${cause.message}`, { cause })
          );
        }
      }
    )
  );

  server.tool(
    "list_todos",
    "List all todo items, optionally filtered by status.",
    {
      status: z
        .enum([...TODO_STATUSES, "all"])
        .optional()
        .default("all")
        .describe(
          "Filter todos by status. Use 'all' to list all todos regardless of status."
        ),
    },
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_list_todos",
        agentLoopContext,
      },
      async ({ status = "all" }) => {
        try {
          const userId = getUserId(auth);
          const userTodos = todoStore.get(userId) || [];

          const filteredTodos =
            status === "all"
              ? userTodos
              : userTodos.filter((todo) => todo.status === status);

          if (filteredTodos.length === 0) {
            return new Ok([
              {
                type: "resource",
                resource: {
                  uri: "todo://list",
                  mimeType: "application/vnd.dust.tool-output.todo-result",
                  text:
                    status === "all"
                      ? "No todos found."
                      : `No todos found with status: ${status}`,
                  operation: "list_todos",
                  todoStatus: status,
                  todoCount: 0,
                  todos: [],
                },
              },
            ]);
          }

          const todoList = filteredTodos
            .map(
              (todo) =>
                `${TODO_STATUS_EMOJIS[todo.status]} ${todo.title}\n  ID: ${todo.id}${
                  todo.description ? `\n  Description: ${todo.description}` : ""
                }`
            )
            .join("\n\n");

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: "todo://list",
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: `${todoList}`,
                operation: "list_todos",
                todoStatus: status,
                todoCount: filteredTodos.length,
                todos: filteredTodos.map((todo) => ({
                  id: todo.id,
                  title: todo.title,
                  status: todo.status,
                  description: todo.description,
                })),
              },
            },
          ]);
        } catch (e) {
          const cause = normalizeError(e);
          return new Err(
            new MCPError(`Error listing todos: ${cause.message}`, { cause })
          );
        }
      }
    )
  );

  server.tool(
    "update_todo",
    "Update a todo item's status, title, or description.",
    {
      id: z.string().describe("The ID of the todo item to update."),
      title: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe("New title for the todo item."),
      description: z
        .string()
        .max(2000)
        .optional()
        .describe("New description for the todo item."),
      status: z
        .enum(TODO_STATUSES)
        .optional()
        .describe("New status for the todo item."),
    },
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_update_todo",
        agentLoopContext,
      },
      async ({ id, title, description, status }) => {
        try {
          const userId = getUserId(auth);
          const userTodos = todoStore.get(userId) || [];
          const todoIndex = userTodos.findIndex((todo) => todo.id === id);

          if (todoIndex === -1) {
            return new Err(
              new MCPError(`Todo with ID "${id}" not found.`, {
                cause: new Error("Todo not found"),
              })
            );
          }

          const todo = userTodos[todoIndex];

          if (title !== undefined) {
            todo.title = title;
          }
          if (description !== undefined) {
            todo.description = description;
          }
          if (status !== undefined) {
            todo.status = status;
          }
          todo.updatedAt = Date.now();

          todoStore.set(userId, userTodos);

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: `todo://${todo.id}`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: "Todo updated successfully!",
                operation: "update_todo",
                todoId: todo.id,
                todoTitle: todo.title,
                todoStatus: todo.status,
                todoDescription: todo.description,
              },
            },
          ]);
        } catch (e) {
          const cause = normalizeError(e);
          return new Err(
            new MCPError(`Error updating todo: ${cause.message}`, { cause })
          );
        }
      }
    )
  );

  server.tool(
    "delete_todo",
    "Delete a todo item by its ID.",
    {
      id: z.string().describe("The ID of the todo item to delete."),
    },
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_delete_todo",
        agentLoopContext,
      },
      async ({ id }) => {
        try {
          const userId = getUserId(auth);
          const userTodos = todoStore.get(userId) || [];
          const todoIndex = userTodos.findIndex((todo) => todo.id === id);

          if (todoIndex === -1) {
            return new Err(
              new MCPError(`Todo with ID "${id}" not found.`, {
                cause: new Error("Todo not found"),
              })
            );
          }

          const deletedTodo = userTodos[todoIndex];
          userTodos.splice(todoIndex, 1);
          todoStore.set(userId, userTodos);

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: `todo://${deletedTodo.id}`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: "Todo deleted successfully!",
                operation: "delete_todo",
                todoId: deletedTodo.id,
                todoTitle: deletedTodo.title,
                todoStatus: deletedTodo.status,
                todoDescription: deletedTodo.description,
              },
            },
          ]);
        } catch (e) {
          const cause = normalizeError(e);
          return new Err(
            new MCPError(`Error deleting todo: ${cause.message}`, { cause })
          );
        }
      }
    )
  );

  server.tool(
    "get_todo",
    "Get detailed information about a specific todo item.",
    {
      id: z.string().describe("The ID of the todo item to retrieve."),
    },
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_get_todo",
        agentLoopContext,
      },
      async ({ id }) => {
        try {
          const userId = getUserId(auth);
          const userTodos = todoStore.get(userId) || [];
          const todo = userTodos.find((t) => t.id === id);

          if (!todo) {
            return new Err(
              new MCPError(`Todo with ID "${id}" not found.`, {
                cause: new Error("Todo not found"),
              })
            );
          }

          const createdDate = new Date(todo.createdAt).toISOString();
          const updatedDate = new Date(todo.updatedAt).toISOString();

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: `todo://${todo.id}`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: `Todo Details:
ID: ${todo.id}
Title: ${todo.title}
Description: ${todo.description || "N/A"}
Status: ${todo.status}
Created: ${createdDate}
Updated: ${updatedDate}`,
                operation: "get_todo",
                todoId: todo.id,
                todoTitle: todo.title,
                todoStatus: todo.status,
                todoDescription: todo.description,
              },
            },
          ]);
        } catch (e) {
          const cause = normalizeError(e);
          return new Err(
            new MCPError(`Error retrieving todo: ${cause.message}`, { cause })
          );
        }
      }
    )
  );

  return server;
}

export default createServer;
