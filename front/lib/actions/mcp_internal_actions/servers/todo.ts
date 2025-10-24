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

// In-memory storage for todo lists and todos (per user session)
// In a real implementation, this would be persisted to a database
const todoListStore = new Map<
  string, // userId
  Map<
    string, // todolistId
    {
      id: string;
      name: string;
      createdAt: number;
      todos: Array<{
        id: string;
        title: string;
        description?: string;
        status: TodoStatus;
        createdAt: number;
        updatedAt: number;
      }>;
    }
  >
>();

function getUserId(auth: Authenticator): string {
  const user = auth.user();
  return user?.id ? user.id.toString() : "anonymous";
}

function getOrCreateDefaultTodoList(userId: string): string {
  const userLists = todoListStore.get(userId) || new Map();

  // Check if default list exists
  const defaultListId = "default";
  if (!userLists.has(defaultListId)) {
    userLists.set(defaultListId, {
      id: defaultListId,
      name: "My Tasks",
      createdAt: Date.now(),
      todos: [],
    });
    todoListStore.set(userId, userLists);
  }

  return defaultListId;
}

function createServer(
  auth: Authenticator,
  agentLoopContext?: AgentLoopContextType
): McpServer {
  const server = makeInternalMCPServer("todo");

  server.tool(
    "create_todolist",
    "Create a new todo list with a name.",
    {
      name: z.string().min(1).max(200).describe("The name of the todo list."),
    },
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_create_todolist",
        agentLoopContext,
      },
      async ({ name }) => {
        try {
          const userId = getUserId(auth);
          const userLists = todoListStore.get(userId) || new Map();

          const newListId = `list_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const newList = {
            id: newListId,
            name,
            createdAt: Date.now(),
            todos: [],
          };

          userLists.set(newListId, newList);
          todoListStore.set(userId, userLists);

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: `todo://${newListId}`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: `Todo list "${name}" created successfully!`,
                operation: "create_todolist",
                todolistId: newListId,
                todolistName: name,
              },
            },
          ]);
        } catch (e) {
          const cause = normalizeError(e);
          return new Err(
            new MCPError(`Error creating todo list: ${cause.message}`, {
              cause,
            })
          );
        }
      }
    )
  );

  server.tool(
    "list_todolists",
    "List all todo lists.",
    {},
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_list_todolists",
        agentLoopContext,
      },
      async () => {
        try {
          const userId = getUserId(auth);
          const userLists = todoListStore.get(userId) || new Map();

          if (userLists.size === 0) {
            return new Ok([
              {
                type: "resource",
                resource: {
                  uri: "todo://lists",
                  mimeType: "application/vnd.dust.tool-output.todo-result",
                  text: "No todo lists found.",
                  operation: "list_todolists",
                  todolistCount: 0,
                  todolists: [],
                },
              },
            ]);
          }

          const lists = Array.from(userLists.values());
          const listText = lists
            .map(
              (list) =>
                `📋 ${list.name}\n  ID: ${list.id}\n  Todos: ${list.todos.length}`
            )
            .join("\n\n");

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: "todo://lists",
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: listText,
                operation: "list_todolists",
                todolistCount: lists.length,
                todolists: lists.map((list) => ({
                  id: list.id,
                  name: list.name,
                  todoCount: list.todos.length,
                })),
              },
            },
          ]);
        } catch (e) {
          const cause = normalizeError(e);
          return new Err(
            new MCPError(`Error listing todo lists: ${cause.message}`, {
              cause,
            })
          );
        }
      }
    )
  );

  server.tool(
    "delete_todolist",
    "Delete a todo list and all its todos.",
    {
      todolist_id: z
        .string()
        .min(1)
        .describe("The ID of the todo list to delete."),
    },
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_delete_todolist",
        agentLoopContext,
      },
      async ({ todolist_id }) => {
        try {
          const userId = getUserId(auth);
          const userLists = todoListStore.get(userId) || new Map();
          const todoList = userLists.get(todolist_id);

          if (!todoList) {
            return new Err(
              new MCPError(`Todo list with ID "${todolist_id}" not found.`, {
                cause: new Error("Todo list not found"),
              })
            );
          }

          userLists.delete(todolist_id);
          todoListStore.set(userId, userLists);

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: `todo://${todolist_id}`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: `Todo list "${todoList.name}" deleted successfully!`,
                operation: "delete_todolist",
                todolistId: todolist_id,
                todolistName: todoList.name,
              },
            },
          ]);
        } catch (e) {
          const cause = normalizeError(e);
          return new Err(
            new MCPError(`Error deleting todo list: ${cause.message}`, {
              cause,
            })
          );
        }
      }
    )
  );
  server.tool(
    "create_todo",
    "Create a new todo item with a title and optional description.",
    {
      todolist_id: z
        .string()
        .min(1)
        .describe("The ID of the todo list to add this item to."),
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
      async ({ todolist_id, title, description, status = "pending" }) => {
        try {
          const userId = getUserId(auth);
          const userLists = todoListStore.get(userId) || new Map();
          const todoList = userLists.get(todolist_id);

          if (!todoList) {
            return new Err(
              new MCPError(`Todo list with ID "${todolist_id}" not found.`, {
                cause: new Error("Todo list not found"),
              })
            );
          }

          const newTodo = {
            id: `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            title,
            description,
            status,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          todoList.todos.push(newTodo);
          todoListStore.set(userId, userLists);

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: `todo://${todolist_id}/${newTodo.id}`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: "Todo created successfully!",
                operation: "create_todo",
                todoId: newTodo.id,
                todolistId: todolist_id,
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
    "List all todo items in a specific todo list, optionally filtered by status.",
    {
      todolist_id: z
        .string()
        .min(1)
        .describe("The ID of the todo list to list items from."),
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
      async ({ todolist_id, status = "all" }) => {
        try {
          const userId = getUserId(auth);
          const userLists = todoListStore.get(userId) || new Map();
          const todoList = userLists.get(todolist_id);

          if (!todoList) {
            return new Err(
              new MCPError(`Todo list with ID "${todolist_id}" not found.`, {
                cause: new Error("Todo list not found"),
              })
            );
          }

          const filteredTodos =
            status === "all"
              ? todoList.todos
              : todoList.todos.filter((todo) => todo.status === status);

          if (filteredTodos.length === 0) {
            return new Ok([
              {
                type: "resource",
                resource: {
                  uri: `todo://${todolist_id}/list`,
                  mimeType: "application/vnd.dust.tool-output.todo-result",
                  text:
                    status === "all"
                      ? "No todos found."
                      : `No todos found with status: ${status}`,
                  operation: "list_todos",
                  todolistId: todolist_id,
                  todoStatus: status,
                  todoCount: 0,
                  todos: [],
                },
              },
            ]);
          }

          const todoListText = filteredTodos
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
                uri: `todo://${todolist_id}/list`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: `${todoListText}`,
                operation: "list_todos",
                todolistId: todolist_id,
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
      todolist_id: z
        .string()
        .min(1)
        .describe("The ID of the todo list containing the item."),
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
      async ({ todolist_id, id, title, description, status }) => {
        try {
          const userId = getUserId(auth);
          const userLists = todoListStore.get(userId) || new Map();
          const todoList = userLists.get(todolist_id);

          if (!todoList) {
            return new Err(
              new MCPError(`Todo list with ID "${todolist_id}" not found.`, {
                cause: new Error("Todo list not found"),
              })
            );
          }

          const todoIndex = todoList.todos.findIndex((todo) => todo.id === id);

          if (todoIndex === -1) {
            return new Err(
              new MCPError(`Todo with ID "${id}" not found.`, {
                cause: new Error("Todo not found"),
              })
            );
          }

          const todo = todoList.todos[todoIndex];

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

          todoListStore.set(userId, userLists);

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: `todo://${todolist_id}/${todo.id}`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: "Todo updated successfully!",
                operation: "update_todo",
                todoId: todo.id,
                todolistId: todolist_id,
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
      todolist_id: z
        .string()
        .min(1)
        .describe("The ID of the todo list containing the item."),
      id: z.string().describe("The ID of the todo item to delete."),
    },
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_delete_todo",
        agentLoopContext,
      },
      async ({ todolist_id, id }) => {
        try {
          const userId = getUserId(auth);
          const userLists = todoListStore.get(userId) || new Map();
          const todoList = userLists.get(todolist_id);

          if (!todoList) {
            return new Err(
              new MCPError(`Todo list with ID "${todolist_id}" not found.`, {
                cause: new Error("Todo list not found"),
              })
            );
          }

          const todoIndex = todoList.todos.findIndex((todo) => todo.id === id);

          if (todoIndex === -1) {
            return new Err(
              new MCPError(`Todo with ID "${id}" not found.`, {
                cause: new Error("Todo not found"),
              })
            );
          }

          const deletedTodo = todoList.todos[todoIndex];
          todoList.todos.splice(todoIndex, 1);
          todoListStore.set(userId, userLists);

          return new Ok([
            {
              type: "resource",
              resource: {
                uri: `todo://${todolist_id}/${deletedTodo.id}`,
                mimeType: "application/vnd.dust.tool-output.todo-result",
                text: "Todo deleted successfully!",
                operation: "delete_todo",
                todoId: deletedTodo.id,
                todolistId: todolist_id,
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
      todolist_id: z
        .string()
        .min(1)
        .describe("The ID of the todo list containing the item."),
      id: z.string().describe("The ID of the todo item to retrieve."),
    },
    withToolLogging(
      auth,
      {
        toolNameForMonitoring: "todo_get_todo",
        agentLoopContext,
      },
      async ({ todolist_id, id }) => {
        try {
          const userId = getUserId(auth);
          const userLists = todoListStore.get(userId) || new Map();
          const todoList = userLists.get(todolist_id);

          if (!todoList) {
            return new Err(
              new MCPError(`Todo list with ID "${todolist_id}" not found.`, {
                cause: new Error("Todo list not found"),
              })
            );
          }

          const todo = todoList.todos.find((t) => t.id === id);

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
                uri: `todo://${todolist_id}/${todo.id}`,
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
                todolistId: todolist_id,
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
