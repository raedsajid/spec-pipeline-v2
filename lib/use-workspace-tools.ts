"use client";
import { useEffect, useRef } from "react";
import { z } from "zod";

type Actions = {
  signedIn: boolean;
  projects: {
    id: string;
    name: string;
    document_count: number;
    requirement_count: number;
  }[];
  startProject: (name: string) => void;
};
/** Page tools share the exact state and creation dialog used by the UI. */
export function useWorkspaceTools(actions: Actions) {
  const current = useRef(actions);
  current.current = actions;
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: "read_projects",
      description: "List the signed-in user’s saved BuildERP projects.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input: unknown) {
        z.object({}).strict().parse(input);
        if (!current.current.signedIn)
          throw Error("Sign in to read your projects.");
        return {
          projects: current.current.projects.map((p) => ({
            id: p.id,
            name: p.name,
            documents: p.document_count,
            requirements: p.requirement_count,
          })),
        };
      },
    });
    register({
      name: "start_project_creation",
      description:
        "Open the New project dialog with a proposed name. This does not save a project; the user completes the form.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const { name } = z
          .object({ name: z.string().trim().min(1).max(100) })
          .strict()
          .parse(input);
        if (!current.current.signedIn)
          throw Error("Sign in before creating a project.");
        current.current.startProject(name);
        return { stage: "creation_dialog", name };
      },
    });
    return () => lifecycle.abort();
  }, []);
}
