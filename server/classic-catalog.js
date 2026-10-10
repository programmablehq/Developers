import { CHAIN_ID, CLASSIC_CATALOG_SOURCE, CLASSIC_CATALOG_SOURCE_URL, FINALITY_CONFIRMATIONS, RELEASE_BY_ID, REQUEST_LIMITS } from "./constants.js";
import { readBoundedText } from "./bounded-body.js";
import { canonicalSha256 } from "./canonical.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const MAXIMUM_TOKENS = 10_000;

function boundedInteger(value) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function decimal(value) {
  return typeof value === "string" && value.length <= 78 && DECIMAL.test(value)
    ? value
    : null;
}

function address(value) {
  return typeof value === "string" && ADDRESS.test(value) ? value : null;
}

function hash32(value) {
  return typeof value === "string" && HASH32.test(value) ? value : null;
}

function instant(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? value
    : null;
}

function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function normalizedLinks(value) {
  if (!Array.isArray(value) || value.length > 32) return {};
  const links = {};
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const key = entry.kind === "documentation" ? "documentation" : entry.kind;
    if (!["website", "documentation", "x", "telegram", "github"].includes(key)) {
      continue;
    }
    const url = httpsUrl(entry.url ?? entry.uri);
    if (url && !Object.hasOwn(links, key)) links[key] = url;
  }
  return links;
}

function normalizedClassicToken(token) {
  const release = RELEASE_BY_ID.get(token?.launchModelVersion);
  if (
    !token ||
    token.exploreKind !== "token" ||
    token.launchModel !== "classic" ||
    token.launchCategoryProvenance?.category !== "classic" ||
    token.launchCategoryProvenance?.source !== "canonical-launch-read-model" ||
    address(token.tokenAddress) === null ||
    address(token.hookAddress) === null ||
    hash32(token.poolId) === null ||
    decimal(token.launchBlockNumber) === null ||
    hash32(token.launchTransactionHash) === null ||
    hash32(token.launchHash) === null ||
    boundedInteger(token.launchTransactionIndex) === null ||
    boundedInteger(token.launchLogIndex) === null ||
    instant(token.launchedAt) === null ||
    !release || release.modelId !== "classic" ||
    address(release.hook) === null ||
    token.hookAddress.toLowerCase() !== release.hook.toLowerCase()
  ) {
    throw new Error("Classic catalog token binding is invalid");
  }
  const quoteAsset = address(token.quoteAssetAddress);
  const canonicalQuoteAsset = quoteAsset?.toLowerCase() ===
      "0x0000000000000000000000000000000000000000"
    ? null
    : quoteAsset;
  return {
    chainId: CHAIN_ID,
    address: token.tokenAddress,
    name: token.name,
    symbol: token.symbol,
    decimals: token.tokenDecimals,
    totalSupplyRaw: token.totalSupplyRaw,
    description: token.description ?? null,
    imageUrl: token.imageUrl ?? null,
    links: normalizedLinks(token.links),
    launch: {
      modelId: "classic",
      modelVersion: token.launchModelVersion,
      creatorAddress: token.creatorAddress,
      transactionHash: token.launchTransactionHash,
      blockNumber: token.launchBlockNumber,
      transactionIndex: token.launchTransactionIndex,
      logIndex: token.launchLogIndex,
      blockHash: null,
      launchedAt: token.launchedAt,
    },
    canonicalPool: {
      poolId: token.poolId,
      hookAddress: token.hookAddress,
      quoteAssetAddress: canonicalQuoteAsset,
      quoteAssetSymbol: token.quoteAssetSymbol ?? null,
      quoteAssetName: token.quoteAssetName ?? null,
      quoteIsCurrency0:
        typeof token.quoteIsCurrency0 === "boolean"
          ? token.quoteIsCurrency0
          : null,
      positionRecipient: token.positionRecipient ?? null,
      positionTokenId: token.positionTokenId ?? null,
      tokenLiquidityAmountRaw: token.tokenLiquidityAmountRaw ?? null,
      lockedTokenDustRaw: token.lockedTokenDustRaw ?? null,
    },
    fees: {
      currency: canonicalQuoteAsset === null ? "ETH" : token.quoteAssetSymbol ?? null,
      currencyAddress: canonicalQuoteAsset,
      buyHookFeeBps: token.buyHookFeeBps,
      sellHookFeeBps: token.sellHookFeeBps,
      buyCreatorFeeBps: token.buyCreatorFeeBps ?? null,
      sellCreatorFeeBps: token.sellCreatorFeeBps ?? null,
      creatorFeeBps: token.creatorFeeBps ?? null,
      transferTaxBps: token.transferTaxBps ?? null,
      lpFeePips: token.lpFeePips ?? null,
    },
    release: {
      launchHash: token.launchHash,
      rewardVault: token.rewardVaultAddress ?? null,
    },
  };
}


export async function readClassicCatalogFeed(fetcher = fetch) {
  const response = await fetcher(CLASSIC_CATALOG_SOURCE_URL, {
    headers: { Accept: "application/json", "User-Agent": "programmable-developer-api/2" },
    redirect: "error", signal: AbortSignal.timeout(REQUEST_LIMITS.classicCatalogTimeoutMs),
  });
  if (!response.ok) throw new Error(`Classic catalog returned HTTP ${response.status}`);
  const payload = JSON.parse(await readBoundedText(response, REQUEST_LIMITS.classicCatalogResponseBytes, "Classic catalog response"));
  const blockNumber = boundedInteger(payload?.asOfBlock);
  const entries = payload?.entries;
  const evidence = payload?.evidence;
  if (payload?.schemaVersion !== CLASSIC_CATALOG_SOURCE.schemaVersion || payload.chainId !== CHAIN_ID
    || payload.source !== CLASSIC_CATALOG_SOURCE.catalogSource || !["current", "last-known-good"].includes(payload.status)
    || blockNumber === null || decimal(payload.asOfBlock) === null || hash32(payload.asOfBlockHash) === null
    || instant(payload.generatedAt) === null || payload.finalityConfirmations !== FINALITY_CONFIRMATIONS
    || !Array.isArray(entries) || entries.length === 0 || entries.length > MAXIMUM_TOKENS
    || payload.identityCount !== entries.length || !SHA256.test(payload.identityCommitment ?? "")
    || !SHA256.test(payload.releaseDigest ?? "") || evidence?.provider !== "codex"
    || !SHA256.test(evidence.commitment ?? "") || evidence.releaseDigest !== payload.releaseDigest
    || instant(evidence.observedAt) === null || payload.release?.chainId !== CHAIN_ID
    || payload.release.confirmations !== FINALITY_CONFIRMATIONS || !Array.isArray(payload.release.sources)
    || canonicalSha256("programmable.classic-launch-catalog.v1", payload.release) !== payload.releaseDigest) {
    throw new Error("Classic catalog source binding is invalid");
  }
  const identity = { chainId: payload.chainId, releaseDigest: payload.releaseDigest,
    asOfBlock: payload.asOfBlock, asOfBlockHash: payload.asOfBlockHash, entries };
  if (canonicalSha256(CLASSIC_CATALOG_SOURCE.schemaVersion, identity) !== payload.identityCommitment) {
    throw new Error("Classic catalog identity commitment is invalid");
  }
  for (const id of CLASSIC_CATALOG_SOURCE.activeReleases) {
    const release = RELEASE_BY_ID.get(id);
    const declared = payload.release.sources.filter(item => item.version === id);
    if (declared.length !== 1 || declared[0].launcher?.toLowerCase() !== release.launcher.toLowerCase()
      || declared[0].hook?.toLowerCase() !== release.hook.toLowerCase()
      || String(declared[0].startBlock) !== String(release.startBlock)) {
      throw new Error("Classic catalog release binding is invalid");
    }
  }
  const seen = new Set();
  const tokens = [];
  for (const entry of entries) {
    const key = address(entry?.tokenAddress)?.toLowerCase();
    if (!key || seen.has(key) || entry.launchCategoryProvenance?.category !== "classic"
      || entry.launchCategoryProvenance?.source !== "canonical-launch-read-model"
      || !payload.release.sources.some(source => source.version === entry.launchModelVersion)) {
      throw new Error("Classic catalog identity set is invalid");
    }
    seen.add(key);
    if (!CLASSIC_CATALOG_SOURCE.activeReleases.includes(entry.launchModelVersion)) continue;
    const token = normalizedClassicToken(entry);
    const release = RELEASE_BY_ID.get(entry.launchModelVersion);
    if (Number(token.launch.blockNumber) < release.startBlock || Number(token.launch.blockNumber) > blockNumber) {
      throw new Error("Classic catalog token block is outside source coverage");
    }
    tokens.push(token);
  }
  if (!tokens.some(token => token.launch.modelVersion === "classic-v4")) {
    throw new Error("Classic catalog identity set is incomplete");
  }
  return { reportedStatus: payload.status, schemaVersion: payload.schemaVersion,
    source: { provider: "codex", releaseDigest: payload.releaseDigest, identityCount: entries.length,
      identityCommitment: payload.identityCommitment, evidenceCommitment: evidence.commitment,
      generatedAt: payload.generatedAt, observedAt: evidence.observedAt },
    snapshot: { blockNumber, blockHash: payload.asOfBlockHash, confirmations: FINALITY_CONFIRMATIONS }, tokens };
}
