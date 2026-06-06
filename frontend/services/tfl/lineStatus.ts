import { tflFetch } from "./client";
import type { LineStatus, TfLLineStatusResponse } from "./types";

/** Fetch current status for tube, overground, DLR, and Elizabeth line. */
export async function getLineStatuses(): Promise<LineStatus[]> {
  const data = await tflFetch<TfLLineStatusResponse[]>(
    "/Line/Mode/tube,overground,dlr,elizabeth-line/Status",
    { revalidate: 60 }
  );

  return data.map((line) => {
    const status = line.lineStatuses?.[0];
    return {
      line: line.name ?? line.id ?? "Unknown",
      severity: status?.statusSeverity ?? 10,
      description:
        status?.statusSeverityDescription ??
        status?.reason ??
        "Service status unknown",
    };
  });
}
