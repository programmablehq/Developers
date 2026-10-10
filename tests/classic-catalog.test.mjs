import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { canonicalSha256 } from "../server/canonical.js";
import { readClassicCatalogFeed } from "../server/classic-catalog.js";
import {
  CLASSIC_CATALOG_SOURCE,
  CLASSIC_CATALOG_SOURCE_URL,
  FINALITY_CONFIRMATIONS,
  RELEASE_BY_ID,
} from "../server/constants.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CATALOG_COMMITMENT = `sha256:${"a".repeat(64)}`;
const AS_OF_BLOCK_HASH = `0x${"b".repeat(64)}`;
const AS_OF_BLOCK = "26158000";

function address(seed) {
  return `0x${BigInt(seed).toString(16).padStart(40, "0")}`;
}

function hash(seed) {
  return `0x${BigInt(seed).toString(16).padStart(64, "0")}`;
}

function classicToken(modelVersion, seed) {
  return {
    exploreKind: "token",
    launchModel: "classic",
    launchModelVersion: modelVersion,
    launchCategoryProvenance: {
      category: "classic",
      source: "canonical-launch-read-model",
    },
    tokenAddress: address(seed),
    name: `Classic ${modelVersion} ${seed}`,
    symbol: `C${seed}`,
    tokenDecimals: 18,
    totalSupplyRaw: "1000000000000000000000000000",
    description: null,
    imageUrl: null,
    links: [{ kind: "website", url: `https://example.com/${seed}` }],
    creatorAddress: address(10_000 + seed),
    launchTransactionHash: hash(20_000 + seed),
    launchBlockNumber: String(25_854_000 + seed),
    launchTransactionIndex: seed,
    launchLogIndex: 1_000 + seed,
    launchedAt: "2026-08-28T14:58:47.000Z",
    launchHash: hash(30_000 + seed),
    poolId: hash(40_000 + seed),
    hookAddress: RELEASE_BY_ID.get(modelVersion)?.hook ?? address(50_000 + seed),
    quoteAssetAddress: ZERO_ADDRESS,
    quoteAssetSymbol: "ETH",
    quoteAssetName: "Ether",
    quoteIsCurrency0: true,
    positionRecipient: address(60_000 + seed),
    positionTokenId: String(70_000 + seed),
    tokenLiquidityAmountRaw: "997000000000000000000000000",
    lockedTokenDustRaw: "3000000000000000000000000",
    buyHookFeeBps: 100,
    sellHookFeeBps: 200,
    buyCreatorFeeBps: 90,
    sellCreatorFeeBps: 190,
    creatorFeeBps: null,
    transferTaxBps: 0,
    lpFeePips: 3_000,
    rewardVaultAddress: address(80_000 + seed),
  };
}


function snapshot(entries = [classicToken("classic-v4", 1), classicToken("classic-v3", 2)]) {
  const release = { schemaVersion: 1, chainId: 1, confirmations: FINALITY_CONFIRMATIONS,
    sources: [...RELEASE_BY_ID.values()].map(item => ({version:item.id,launcher:item.launcher,hook:item.hook,startBlock:item.startBlock})) };
  const releaseDigest = canonicalSha256("programmable.classic-launch-catalog.v1", release);
  const payload = {schemaVersion:CLASSIC_CATALOG_SOURCE.schemaVersion,chainId:1,source:CLASSIC_CATALOG_SOURCE.catalogSource,
    status:"current",generatedAt:"2026-10-10T00:00:00.000Z",asOfBlock:AS_OF_BLOCK,asOfBlockHash:AS_OF_BLOCK_HASH,
    finalityConfirmations:FINALITY_CONFIRMATIONS,identityCount:entries.length,releaseDigest,release,entries,
    evidence:{provider:"codex",releaseDigest,commitment:CATALOG_COMMITMENT,observedAt:"2026-10-10T00:00:00.000Z"}};
  return resign(payload);
}
function resign(payload) {
  payload.identityCommitment=canonicalSha256(CLASSIC_CATALOG_SOURCE.schemaVersion,{
    chainId:payload.chainId,releaseDigest:payload.releaseDigest,asOfBlock:payload.asOfBlock,asOfBlockHash:payload.asOfBlockHash,entries:payload.entries});
  return payload;
}
function fetchSnapshot(payload) {
  return async(url,options)=>{
    assert.equal(url,CLASSIC_CATALOG_SOURCE_URL);
    assert.equal(new URL(url).search,"");
    assert.equal(options.redirect,"error");
    return new Response(JSON.stringify(payload),{status:200});
  };
}
describe("Codex-backed canonical Classic snapshot",()=>{
  test("keeps complete V3/V4 identities and their fees without a paginated Envio catalog",async()=>{
    const result=await readClassicCatalogFeed(fetchSnapshot(snapshot()));
    assert.equal(result.tokens.length,2);
    assert.equal(result.source.provider,"codex");
    assert.equal(result.tokens[0].launch.transactionIndex,1);
    assert.equal(result.tokens[0].launch.logIndex,1001);
    assert.equal(result.tokens[0].fees.buyCreatorFeeBps,90);
    assert.equal(result.tokens[0].canonicalPool.quoteAssetAddress,null);
    assert.equal(result.snapshot.blockHash,AS_OF_BLOCK_HASH);
  });
  test("retains a cached source status and missing optional image",async()=>{
    const value=snapshot();value.status="last-known-good";delete value.entries[0].imageUrl;
    const result=await readClassicCatalogFeed(fetchSnapshot(resign(value)));
    assert.equal(result.reportedStatus,"last-known-good");assert.equal(result.tokens[0].imageUrl,null);
  });
  test("rejects tampered token or checkpoint commitments",async()=>{
    for(const mutate of [p=>p.entries[0].tokenAddress=address(987),p=>p.asOfBlockHash=hash(999)]){
      const value=snapshot();mutate(value);await assert.rejects(readClassicCatalogFeed(fetchSnapshot(value)),/commitment/);
    }
  });
  test("rejects wrong chains, providers, schemas, counts and release commitments",async()=>{
    for(const mutate of [p=>p.chainId=4663,p=>p.evidence.provider="envio",p=>p.schemaVersion="unknown",p=>p.identityCount=1,p=>p.releaseDigest=CATALOG_COMMITMENT,p=>p.status="unavailable",p=>p.finalityConfirmations=0]){
      const value=snapshot();mutate(value);await assert.rejects(readClassicCatalogFeed(fetchSnapshot(value)),/binding/);
    }
  });
  test("rejects duplicate identities, foreign hooks, non-Classic entries and impossible blocks",async()=>{
    for(const mutate of [p=>p.entries[1].tokenAddress=p.entries[0].tokenAddress,p=>p.entries[0].hookAddress=address(345),p=>p.entries[0].launchCategoryProvenance.category="custom",p=>p.entries[0].launchBlockNumber="1",p=>p.entries[0].launchBlockNumber="99999999"]){
      const value=snapshot();mutate(value);await assert.rejects(readClassicCatalogFeed(fetchSnapshot(resign(value))),/invalid|outside/);
    }
  });
  test("rejects a changed source launcher even if the supplied hashes match",async()=>{
    const value=snapshot();value.release.sources[0].launcher=address(456);
    value.releaseDigest=canonicalSha256("programmable.classic-launch-catalog.v1",value.release);value.evidence.releaseDigest=value.releaseDigest;
    await assert.rejects(readClassicCatalogFeed(fetchSnapshot(resign(value))),/release binding/);
  });
  test("does not interpret an upstream error or empty catalog as a complete feed",async()=>{
    await assert.rejects(readClassicCatalogFeed(async()=>new Response("unavailable",{status:503})),/HTTP 503/);
    await assert.rejects(readClassicCatalogFeed(fetchSnapshot(snapshot([]))),/binding/);
  });
});
