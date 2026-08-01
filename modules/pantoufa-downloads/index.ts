import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeDownload = {
  id: number;
  status: number;
  reason: number;
  bytes: number;
  totalBytes: number;
  localUri: string | null;
  validMp4: boolean;
};

type PantoufaDownloadsModule = {
  enqueue(url: string, headers: Record<string, string>, fileName: string, title: string): Promise<number>;
  query(id: number): Promise<NativeDownload | null>;
  find(fileName: string): Promise<NativeDownload | null>;
  remove(id: number): Promise<number>;
};

export default requireOptionalNativeModule<PantoufaDownloadsModule>("PantoufaDownloads");
