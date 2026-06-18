// Deploy scripts write addresses here (contracts/script/Deploy.s.sol -> deployments/<network>.json).
// Both the indexer and the web app import the right file by network.
export interface Deployment {
  chainId: number;
  network: string; // "anvil" | "baseSepolia"
  wordRegistry: `0x${string}`;
  deedMarketplace: `0x${string}`;
  startBlock: number; // block to begin indexing from
}
