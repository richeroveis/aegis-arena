import { useCallback, useMemo, useState } from "react";
import { generatePrivateKey } from "genlayer-js";
import { createAccount } from "genlayer-js";
import { makeBurnerClient, makeWalletClient, switchWalletToStudionet } from "./arena";

const PK_KEY = "aegis_arena_burner_pk";

export type WalletMode = "none" | "burner" | "wallet";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export function useWallet() {
  const [mode, setMode] = useState<WalletMode>("none");
  const [address, setAddress] = useState<string | null>(null);
  const [burnerPk, setBurnerPk] = useState<string | null>(null);

  const writeClient = useMemo(() => {
    if (mode === "burner" && burnerPk) {
      return makeBurnerClient(burnerPk as `0x${string}`);
    }
    return null;
  }, [mode, burnerPk]);

  const activateBurner = useCallback((privateKey?: string) => {
    let pk: string | null = privateKey ?? null;
    if (!pk) {
      try {
        pk = window.localStorage.getItem(PK_KEY);
      } catch {
        pk = null;
      }
    }
    if (!pk) {
      pk = generatePrivateKey();
      try {
        window.localStorage.setItem(PK_KEY, pk);
      } catch {
        /* storage may be blocked; keep the key in memory only */
      }
    }
    const acct = createAccount(pk as `0x${string}`);
    setBurnerPk(pk);
    setAddress(acct.address);
    setMode("burner");
  }, []);

  const newBurnerIdentity = useCallback(() => {
    const pk = generatePrivateKey();
    try {
      window.localStorage.setItem(PK_KEY, pk);
    } catch {
      /* ignore */
    }
    const acct = createAccount(pk as `0x${string}`);
    setBurnerPk(pk);
    setAddress(acct.address);
    setMode("burner");
  }, []);

  const connectMetaMask = useCallback(async () => {
    if (!window.ethereum) {
      return { ok: false, message: "No injected EIP-1193 wallet found." };
    }
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accounts[0];
      if (!addr) return { ok: false, message: "No account returned by wallet." };
      const client = makeWalletClient(addr as `0x${string}`, window.ethereum);
      await switchWalletToStudionet(client);
      setAddress(addr);
      setMode("wallet");
      // stash the live wallet client on the window for the write path
      (window as unknown as { __aegisWalletClient?: unknown }).__aegisWalletClient = client;
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  const disconnect = useCallback(() => {
    setMode("none");
    setAddress(null);
  }, []);

  const getWriteClient = useCallback((): ReturnType<typeof makeBurnerClient> | null => {
    if (mode === "burner") return writeClient;
    if (mode === "wallet") {
      return ((window as unknown as { __aegisWalletClient?: ReturnType<typeof makeWalletClient> })
        .__aegisWalletClient ?? null) as ReturnType<typeof makeBurnerClient> | null;
    }
    return null;
  }, [mode, writeClient]);

  return {
    mode,
    address,
    activateBurner,
    newBurnerIdentity,
    connectMetaMask,
    disconnect,
    getWriteClient,
  };
}
