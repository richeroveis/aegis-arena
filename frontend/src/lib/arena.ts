import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "../config";
import type {
  ArenaStats,
  LeaderRow,
  Tournament,
  TournamentBundle,
  TxResult,
  TxStage,
  VaultState,
} from "./types";

// A single read client is enough: views need no signature.
const readClient = createClient({ chain: studionet });

const ADDR = CONTRACT_ADDRESS as `0x${string}`;

type AnyArgs = (string | number | bigint)[];

// studionet occasionally drops a request ("Failed to fetch"); a retried write
// gets a fresh transaction, and duplicate submissions are harmless here
// because submit_tactic has no per-player uniqueness guard.
function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /failed to fetch|timeout|network|429|\-32429/i.test(msg);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw lastErr;
}

export function makeBurnerClient(privateKey: `0x${string}`) {
  return createClient({ chain: studionet, account: createAccount(privateKey) });
}

export function makeWalletClient(address: `0x${string}`, provider: unknown) {
  return createClient({
    chain: studionet,
    account: address,
    provider: provider as never,
  });
}

export async function switchWalletToStudionet(client: ReturnType<typeof createClient>) {
  try {
    // Adds/switches the connected wallet to studionet when the SDK exposes it.
    await (client as unknown as { connect?: (n: string) => Promise<void> }).connect?.("studionet");
  } catch {
    /* user can reject; writes will surface a clear error later */
  }
}

// ---- views ----
// Initial page load stays at four RPC calls: stats, tournaments, leaderboard
// and one consolidated bundle for the auto-selected tournament. No hand-typed
// ABI is ever passed; genlayer-js resolves the contract interface itself.
export const readStats = () =>
  readClient.readContract({ address: ADDR, functionName: "get_arena_stats", args: [] }) as unknown as Promise<ArenaStats>;

export const readTournaments = () =>
  readClient.readContract({ address: ADDR, functionName: "get_all_tournaments", args: [] }) as unknown as Promise<Tournament[]>;

export const readLeaderboard = () =>
  readClient.readContract({ address: ADDR, functionName: "get_leaderboard", args: [] }) as unknown as Promise<LeaderRow[]>;

export const readBundle = (id: number) =>
  readClient.readContract({
    address: ADDR,
    functionName: "get_tournament_bundle",
    args: [id] as AnyArgs,
  }) as unknown as Promise<TournamentBundle>;

export const readTokenBalance = (address: string) =>
  readClient.readContract({
    address: ADDR,
    functionName: "get_token_balance",
    args: [address] as AnyArgs,
  }) as unknown as Promise<number | bigint>;

export const readVaultInvariants = () =>
  readClient.readContract({
    address: ADDR,
    functionName: "check_vault_invariants",
    args: [],
  }) as unknown as Promise<VaultState>;

// ---- writes with a live lifecycle stepper ----
export async function runWrite(
  client: ReturnType<typeof createClient>,
  functionName: string,
  args: AnyArgs,
  onStage: (stage: TxStage, hash?: string) => void,
  options?: { leaderOnly?: boolean },
): Promise<TxResult> {
  onStage("signing");
  try {
    const hash = (await withRetry(() =>
      client.writeContract({
        address: ADDR,
        functionName,
        args: args as never,
        value: 0n,
        // Deterministic writes (e.g. submit_tactic) can settle leader-only for
        // a much faster UX; anything using the LLM path must stay on full
        // validator consensus.
        leaderOnly: options?.leaderOnly,
      }),
    )) as unknown as `0x${string}` & { readonly length: 66 };
    onStage("broadcast", hash);

    await withRetry(() =>
      client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED }),
    );
    onStage("consensus", hash);

    const receipt = (await withRetry(() =>
      client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED }),
    )) as {
      status_name?: string;
      result_name?: string;
      consensus_data?: { leader_receipt?: { execution_result?: string }[] };
    };

    onStage("finalized", hash);
    // genlayer-js returns snake_case receipt fields (verified on studionet):
    // status_name: "FINALIZED", result_name: "MAJORITY_AGREE", and the leader
    // execution result inside consensus_data.leader_receipt[0].execution_result.
    const finalized = receipt.status_name === "FINALIZED";
    const errored =
      (receipt.consensus_data?.leader_receipt?.[0]?.execution_result ?? "SUCCESS") !== "SUCCESS";
    return {
      hash,
      status: receipt.status_name,
      executionResult: receipt.result_name,
      ok: finalized && !errored,
      message: errored ? "Transaction finalized but execution reverted." : undefined,
    };
  } catch (err) {
    onStage("error");
    return { hash: "", ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
