import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const inspectorTool = defineTool({
  name: "inspector",
  label: "Inspector",
  description: "Inspect mapped abstractions by readable id.",
  parameters: Type.Object({
    ids: Type.Array(Type.String({ description: "Readable symbol id: <path>#<name>" }), {
      description: "Symbol ids to inspect",
    }),
    need: Type.Optional(
      Type.Array(
        Type.Union([Type.Literal("signature"), Type.Literal("body"), Type.Literal("location")]),
        { description: "Fields to return" },
      ),
    ),
    depth: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Body expansion depth. Used only when need includes body. 0 = top-level only.",
      }),
    ),
  }),
  async execute() {
    throw new Error("inspector not implemented yet.");
  },
});

export default inspectorTool;
