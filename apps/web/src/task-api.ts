import {
  type AttemptUpdate,
  attemptResponseSchema,
  auditLogListSchema,
  childListenBatchSchema,
  childOverviewSchema,
  childTokenCreatedSchema,
  childTokenStatusSchema,
  type TaskInput,
  taskListSchema,
  taskPlayResponseSchema,
  taskResponseSchema,
} from "../../../packages/contract/src/index";
import { getDeviceId, request } from "./api";

export const taskApi = {
  preview: (input: TaskInput) =>
    request("api/tasks/preview", taskResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  list: (signal?: AbortSignal) => request("api/tasks", taskListSchema, { signal }),
  get: (id: string) => request(`api/tasks/${id}`, taskResponseSchema),
  create: (input: TaskInput) =>
    request("api/tasks", taskResponseSchema, { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, revision: number, input: TaskInput) =>
    request(`api/tasks/${id}`, taskResponseSchema, {
      method: "PUT",
      body: JSON.stringify({ ...input, revision }),
    }),
  withdraw: (id: string, revision?: number) =>
    request(`api/tasks/${id}/withdraw`, taskResponseSchema, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  reschedule: (id: string) =>
    request(`api/tasks/${id}/reschedule`, taskResponseSchema, {
      method: "POST",
    }),
  play: (id: string, signal?: AbortSignal) =>
    request(`api/tasks/${id}/play`, taskPlayResponseSchema, { signal }),
  start: (id: string, onlyHomework: boolean, forceTakeover = false) =>
    request(`api/tasks/${id}/start`, attemptResponseSchema, {
      method: "POST",
      body: JSON.stringify({ onlyHomework, deviceId: getDeviceId(), forceTakeover }),
    }),
  save: (id: string, { revision, index, phase, results, forceTakeover }: AttemptUpdate) =>
    request(`api/attempts/${id}`, attemptResponseSchema, {
      method: "PUT",
      body: JSON.stringify({
        revision,
        index,
        phase,
        results,
        deviceId: getDeviceId(),
        forceTakeover,
      }),
    }),
  returnForRedo: (id: string, revision: number, resetIndex = false) =>
    request(`api/attempts/${id}/return`, attemptResponseSchema, {
      method: "POST",
      body: JSON.stringify({ revision, resetIndex }),
    }),
  redispatchWrong: (id: string) =>
    request(`api/attempts/${id}/redispatch`, taskResponseSchema, {
      method: "POST",
    }),
  complete: (id: string, revision: number, confirmRemaining: boolean) =>
    request(`api/attempts/${id}/complete`, attemptResponseSchema, {
      method: "POST",
      body: JSON.stringify({ revision, confirmRemaining }),
    }),
  correct: (id: string, revision: number, wordIds: string[]) =>
    request(`api/attempts/${id}/corrections`, attemptResponseSchema, {
      method: "POST",
      body: JSON.stringify({ revision, wordIds }),
    }),
  childOverview: (signal?: AbortSignal) =>
    request("api/child/overview", childOverviewSchema, { signal }),
  childListenBatch: (id: string, signal?: AbortSignal) =>
    request(`api/child/batches/${encodeURIComponent(id)}/listen`, childListenBatchSchema, {
      signal,
    }),
  childTokens: (signal?: AbortSignal) =>
    request("api/child-token", childTokenStatusSchema, { signal }),
  createChildToken: () => request("api/child-token", childTokenCreatedSchema, { method: "POST" }),
  rotateChildToken: () =>
    request("api/child-token/rotate", childTokenCreatedSchema, { method: "POST" }),
  auditLogs: (signal?: AbortSignal) => request("api/audit-logs", auditLogListSchema, { signal }),
};
