/**
 * CLI Agents — Protocol Schemas
 *
 * TypeBox schemas for `cliAgents.*` gateway methods.
 */

import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

// ─── CLI Type Union ───

export const CliTypeSchema = Type.Union([
  Type.Literal("claude-code"),
  Type.Literal("opencode"),
  Type.Literal("codebuddy"),
  Type.Literal("qwen"),
  Type.Literal("custom"),
]);

// ─── CLI Agent Entry Schema ───

export const CliAgentEntrySchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    emoji: Type.Optional(Type.String()),
    type: CliTypeSchema,
    command: NonEmptyString,
    args: Type.Optional(Type.Array(Type.String())),
    cwd: Type.Optional(Type.String()),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    timeout: Type.Optional(Type.Integer({ minimum: 1000 })),
    tailTrimMarker: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

// ─── cliAgents.list ───

export const CliAgentsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const CliAgentsListResultSchema = Type.Object(
  {
    agents: Type.Array(CliAgentEntrySchema),
  },
  { additionalProperties: false },
);

// ─── cliAgents.create ───

export const CliAgentsCreateParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: NonEmptyString,
    cliType: CliTypeSchema,
    command: NonEmptyString,
    args: Type.Optional(Type.Array(Type.String())),
    cwd: Type.Optional(Type.String()),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    timeout: Type.Optional(Type.Integer({ minimum: 1000 })),
    emoji: Type.Optional(Type.String()),
    tailTrimMarker: Type.Optional(Type.String()),
    /** Optional personality ID (e.g., "architect", "implementer"). */
    personalityId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const CliAgentsCreateResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
    workspace: NonEmptyString,
  },
  { additionalProperties: false },
);

// ─── cliAgents.update ───

export const CliAgentsUpdateParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: Type.Optional(NonEmptyString),
    command: Type.Optional(NonEmptyString),
    args: Type.Optional(Type.Array(Type.String())),
    cwd: Type.Optional(Type.String()),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    timeout: Type.Optional(Type.Integer({ minimum: 1000 })),
    emoji: Type.Optional(Type.String()),
    tailTrimMarker: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const CliAgentsUpdateResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

// ─── cliAgents.delete ───

export const CliAgentsDeleteParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const CliAgentsDeleteResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

// ─── cliAgents.files.list ───

export const CliAgentsFilesListParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

// ─── cliAgents.files.get ───

export const CliAgentsFilesGetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: NonEmptyString,
  },
  { additionalProperties: false },
);

// ─── cliAgents.files.set ───

export const CliAgentsFilesSetParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: NonEmptyString,
    content: Type.String(),
  },
  { additionalProperties: false },
);

// ─── cliAgents.test ───

export const CliAgentsTestParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const CliAgentsTestStopParamsSchema = Type.Object(
  {
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);
