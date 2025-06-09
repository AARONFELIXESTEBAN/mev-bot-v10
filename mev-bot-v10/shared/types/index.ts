import { ethers, Provider, BigNumberish } from 'ethers';
import { Dict, TokenInfo, DexPair } from '@utils/typeUtils';

export interface TokenAmount {
  token: TokenInfo;
  amount: BigNumberish;
}

export interface SwapDescription {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: BigNumberish;
  amountOut: BigNumberish;
  dexName: string;
  pairAddress: string;
}

export interface PriceData {
  tokenPair: DexPair;
  price: BigNumberish;
  timestamp: number;
  dexName: string;
}

export type MarketData = Dict<PriceData[]>;

export interface PathSegment {
  tokenInAddress: string;
  tokenOutAddress: string;
  dexName: string;
  pairAddress: string;
  amountIn: BigNumberish;
  amountOutMin: BigNumberish;
  tokenInDecimals: number;
  tokenOutDecimals: number;
}

export interface PotentialOpportunity {
  id: string;
  path: PathSegment[];
  entryAmountBase: BigNumberish;
  expectedProfitBase: BigNumberish;
  entryTokenAddress: string;
  exitTokenAddress: string;
  timestamp: number;
}

export interface SimulatedPathSegmentDetails {
  segment: PathSegment;
  expectedAmountOut: BigNumberish;
  estimatedGasUnits: BigNumberish;
}

export interface SimulationResult {
  success: boolean;
  isProfitable: boolean;
  opportunity: PotentialOpportunity;
  simulatedPathDetails: SimulatedPathSegmentDetails[];
  totalExpectedProfitBase: BigNumberish;
  totalEstimatedGasCostWei: BigNumberish;
  netProfitBaseToken: BigNumberish;
  netProfitUsd: number;
  amountInLeg1: BigNumberish;
  amountOutLeg2: BigNumberish;
  estimatedGasCostBaseToken: BigNumberish;
  simulationTimestamp: number;
  pathId: string;
}