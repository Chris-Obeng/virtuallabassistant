"use client";

import {
  RuntimeAdapterProvider,
  useAui,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { useMemo } from "react";

export const threadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const rows = await fetch("/api/threads").then((r) => r.json());
    return {
      threads: rows.map((t: any) => ({
        status: t.status ?? "regular",
        remoteId: t.id,
        title: t.title ?? undefined,
      })),
    };
  },
  async initialize() {
    const { id } = await fetch("/api/threads", { method: "POST" }).then((r) =>
      r.json(),
    );
    return { remoteId: id, externalId: id };
  },
  async rename(remoteId, title) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  },
  async archive(remoteId) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });
  },
  async unarchive(remoteId) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "regular" }),
    });
  },
  async delete(remoteId) {
    await fetch(`/api/threads/${remoteId}`, { method: "DELETE" });
  },
  async fetch(remoteId) {
    const t = await fetch(`/api/threads/${remoteId}`).then((r) => r.json());
    return { status: t.status ?? "regular", remoteId: t.id, title: t.title ?? undefined };
  },
  async generateTitle(remoteId, messages) {
    return createAssistantStream(async (controller) => {
      const { title } = await fetch(`/api/threads/${remoteId}/title`, {
        method: "POST",
        body: JSON.stringify({ messages }),
      }).then((r) => r.json());
      controller.appendText(title);
    });
  },
  unstable_Provider({ children }) {
    const aui = useAui();
    const history = useMemo<ThreadHistoryAdapter>(
      () => ({
        async load() {
          return { messages: [] };
        },
        async append() { },
        withFormat: (fmt) => ({
          async load() {
            const { remoteId } = aui.threadListItem().getState();
            if (!remoteId) return { messages: [] };
            const res = await fetch(`/api/threads/${remoteId}/messages`);
            if (!res.ok) {
              console.error(
                `Failed to fetch messages for thread ${remoteId}: ${res.statusText}`,
              );
              return { messages: [] };
            }
            const rows = await res.json();
            console.log(
              "FETCHED MESSAGES:",
              JSON.stringify(
                rows.map((row: any) => ({
                  id: row.id,
                  parentId: row.parentId,
                })),
                null,
                2,
              ),
            );
            return {
              messages: rows.map((row: any, index: number) => {
                const assignedParentId =
                  row.parentId ?? (index > 0 ? rows[index - 1].id : null);
                return fmt.decode({
                  id: row.id,
                  parent_id: assignedParentId,
                  format: row.format,
                  content: row.content,
                });
              }),
            };
          },
          async append(item) {
            console.log("append item:", item);
            const { remoteId } = await aui.threadListItem().initialize();
            await fetch(`/api/threads/${remoteId}/messages`, {
              method: "POST",
              body: JSON.stringify({
                id: fmt.getId(item.message),
                parentId: item.parentId,
                format: fmt.format,
                content: fmt.encode(item),
              }),
            });
          },
        }),
      }),
      [aui],
    );
    return (
      <RuntimeAdapterProvider adapters={{ history }}>
        {children}
      </RuntimeAdapterProvider>
    );
  },
};
