import { Network } from "@capacitor/network";

export async function isOnline(): Promise<boolean> {
  const status = await Network.getStatus();
  return status.connected;
}

export function onNetworkChange(
  listener: (online: boolean) => void,
): () => void {
  const handle = Network.addListener("networkStatusChange", (status) => {
    listener(status.connected);
  });
  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
}
