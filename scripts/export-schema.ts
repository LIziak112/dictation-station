import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { exportSchema } from "../packages/contract/src/index";

mkdirSync("schema", { recursive: true });
writeFileSync(
  "schema/wordlist.schema.json",
  `${JSON.stringify(z.toJSONSchema(exportSchema, { io: "input" }), null, 2)}\n`,
);
