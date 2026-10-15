import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "../config";
import type {
  ArenaComment,
  ArenaStats,
  LeaderRow,
  Submission,
  Tournament,
  TxResult,
  TxStage,
} from "./types";

// A single read client is enough: views need no signature.
const readClient = createClient({ chain: studionet });

const ADDR = CONTRACT_ADDRESS as `0x${string}`;

type AnyArgs = (string | number | bigint)[];

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
export const readStats = () =>
  readClient.readContract({ address: ADDR, functionName: "get_arena_stats", args: [] }) as unknown as Promise<ArenaStats>;

export const readTournaments = () =>
  readClient.readContract({ address: ADDR, functionName: "get_all_tournaments", args: [] }) as unknown as Promise<Tournament[]>;

export const readTournament = (id: number) =>
  readClient.readContract({ address: ADDR, functionName: "get_tournament", args: [id] as AnyArgs }) as unknown as Promise<Tournament>;

export const readSubmissions = (id: number) =>
  readClient.readContract({
    address: ADDR,
    functionName: "get_tournament_submissions",
    args: [id] as AnyArgs,
  }) as unknown as Promise<Submission[]>;

export const readComments = (id: number) =>
  readClient.readContract({
    address: ADDR,
    functionName: "get_tournament_comments",
    args: [id] as AnyArgs,
  }) as unknown as Promise<ArenaComment[]>;

export const readLeaderboard = () =>
  readClient.readContract({ address: ADDR, functionName: "get_leaderboard", args: [] }) as unknown as Promise<LeaderRow[]>;

// ---- writes with a live lifecycle stepper ----
export async function runWrite(
  client: ReturnType<typeof createClient>,
  functionName: string,
  args: AnyArgs,
  onStage: (stage: TxStage, hash?: string) => void,
): Promise<TxResult> {
  onStage("signing");
  try {
    const hash = (await client.writeContract({
      address: ADDR,
      functionName,
      args: args as never,
      value: 0n,
    })) as unknown as `0x${string}` & { readonly length: 66 };
    onStage("broadcast", hash);

    await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED });
    onStage("consensus", hash);

    const receipt = (await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
    })) as { statusName?: string; status?: string; txExecutionResultName?: string };

    onStage("finalized", hash);
    const finalized = (receipt.statusName || receipt.status) === "FINALIZED";
    const errored = receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR;
    return {
      hash,
      status: receipt.statusName || receipt.status,
      executionResult: receipt.txExecutionResultName,
      ok: finalized && !errored,
      message: errored ? "Transaction finalized but execution reverted." : undefined,
    };
  } catch (err) {
    onStage("error");
    return { hash: "", ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
