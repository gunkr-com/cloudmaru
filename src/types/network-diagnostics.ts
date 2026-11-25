import type { z } from "zod";
import type { networkDiagnosticSchema, networkEngineResultSchema, networkQuerySchema, networkReasonCodeSchema } from "@/lib/completion/schema";

export type NetworkReasonCode = z.infer<typeof networkReasonCodeSchema>;
export type NetworkQuery = z.infer<typeof networkQuerySchema>;
export type NetworkEngineResult = z.infer<typeof networkEngineResultSchema>;
export type NetworkDiagnostic = z.infer<typeof networkDiagnosticSchema>;
