export function mapNativeDownload(job: {
  status: number;
  bytes: number;
  totalBytes: number;
  localUri: string | null;
  validMp4: boolean;
}) {
  const progress = job.totalBytes > 0 ? Math.min(1, job.bytes / job.totalBytes) : 0;
  if (job.status === 8) {
    return job.localUri && job.validMp4
      ? { status: "completed" as const, progress: 1 }
      : { status: "failed" as const, progress };
  }
  if (job.status === 16) return { status: "failed" as const, progress };
  return { status: "downloading" as const, progress };
}
