import {
  type AttemptUpdate,
  attemptResponseSchema,
  type TaskInput,
  taskListSchema,
  taskPlayResponseSchema,
  taskResponseSchema,
} from "../../../packages/contract/src/index";
import { request } from "./api";

export const taskApi = {
  list: (signal?: AbortSignal) => request("api/tasks", taskListSchema, { signal }),
  get: (id: string) => request(`api/tasks/${id}`, taskResponseSchema),
  create: (input: TaskInput) =>
    request("api/tasks", taskResponseSchema, { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, revision: number, input: TaskInput) =>
    request(`api/tasks/${id}`, taskResponseSchema, {
      method: "PUT",
      body: JSON.stringify({ ...input, revision }),
    }),
  play: (id: string, signal?: AbortSignal) =>
    request(`api/tasks/${id}/play`, taskPlayResponseSchema, { signal }),
  start: (id: string, onlyHomework: boolean) =>
    request(`api/tasks/${id}/start`, attemptResponseSchema, {
      method: "POST",
      body: JSON.stringify({ onlyHomework }),
    }),
  save: (id: string, { revision, index, phase, results }: AttemptUpdate) =>
    request(`api/attempts/${id}`, attemptResponseSchema, {
      method: "PUT",
      body: JSON.stringify({ revision, index, phase, results }),
    }),
  complete: (id: string, revision: number, confirmRemaining: boolean) =>
    request(`api/attempts/${id}/complete`, attemptResponseSchema, {
      method: "POST",
      body: JSON.stringify({ revision, confirmRemaining }),
    }),
};
