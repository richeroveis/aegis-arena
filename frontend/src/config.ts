// Live deployment coordinates for AegisArena on GenLayer studionet.

export const CONTRACT_ADDRESS = "0x09a0D07800547074a7D1f7c48B96208ee653d5DA" as const;

export const STUDIONET_RPC = "https://studio.genlayer.com/api";
export const CHAIN_ID = 61999;
export const EXPLORER_BASE = "https://explorer-studio.genlayer.com";

export const explorerAddressUrl = (address: string) =>
  `${EXPLORER_BASE}/address/${address}`;

export const explorerTxUrl = (hash: string) =>
  `${EXPLORER_BASE}/transaction/${hash}`;

// Score bounds mirrored from the contract for pre-flight UI hints.
export const SCORE = {
  detMax: 40,
  aiMax: 60,
  totalMax: 100,
  payloadMin: 10,
  payloadMax: 1500,
  prizeMin: 100,
  prizeMax: 1000000,
} as const;

export const STANCES = ["COMMEND", "CHALLENGE", "ANALYSIS"] as const;
export type Stance = (typeof STANCES)[number];
