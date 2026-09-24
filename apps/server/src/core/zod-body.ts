import { Body, Query } from "@nestjs/common";
import { ApiBody } from "@nestjs/swagger";
import type { ZodSchema } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ZodPipe } from "./http";

const openApi = (schema: ZodSchema) => zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>;

/**
 * `@ZBody(schema)` = validate the body with a shared Zod schema AND document it in Swagger,
 * so request validation and API docs can never drift apart.
 */
export function ZBody(schema: ZodSchema): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodPipe(schema))(target, key, index);
    if (key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
      ApiBody({ schema: openApi(schema) })(target, key, descriptor);
    }
  };
}

/** Same for query strings. */
export function ZQuery(schema: ZodSchema): ParameterDecorator {
  return (target, key, index) => Query(new ZodPipe(schema))(target, key, index);
}
